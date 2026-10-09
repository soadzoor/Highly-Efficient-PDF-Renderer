import type { NativeIccTransformRequest, NativeIccTransformResult } from "./nativeIcc";
import { PdfError, throwIfAborted } from "./nativeTypes";
import {
  createIccModuleLoader, ICC_WASM_MAX_BYTES, IccEngineError, iccMemoryError, yieldIccConversion
} from "./nativeIccWasm";

const loadModule = createIccModuleLoader(
  new URL("../assets/color/icc/lcms.wasm?no-inline", import.meta.url), 315909
);

interface LcmsExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  __indirect_function_table: WebAssembly.Table;
  __wasm_call_ctors(): void;
  emscripten_stack_init(): void;
  malloc(bytes: number): number;
  free(pointer: number): void;
  cmsOpenProfileFromMem(pointer: number, length: number): number;
  cmsCloseProfile(profile: number): void;
  cmsCreate_sRGBProfile(): number;
  cmsFormatterForColorspaceOfProfile(profile: number, bytes: number, float: number): number;
  cmsCreateTransform(input: number, inputFormat: number, output: number, outputFormat: number, intent: number, flags: number): number;
  cmsDeleteTransform(transform: number): void;
  cmsDoTransform(transform: number, input: number, output: number, count: number): void;
}

/** Minimal host ABI for the pinned, filesystem-free Little CMS C build. */
function instantiate(module: WebAssembly.Module): LcmsExports {
  let wasm: LcmsExports;
  const unsupported = () => { throw new IccEngineError("profile-unsupported"); };
  const invoke = (index: number, ...args: number[]) => wasm.__indirect_function_table.get(index)(...args);
  const imports = {
    abort: unsupported,
    __assert_fail: unsupported,
    __cxa_begin_catch: unsupported,
    __cxa_find_matching_catch_2: unsupported,
    __cxa_find_matching_catch_3: unsupported,
    __resumeException: unsupported,
    __syscall_openat: () => -52,
    __syscall_fcntl64: () => -52,
    __syscall_ioctl: () => -52,
    __syscall_unlinkat: () => -52,
    __syscall_rmdir: () => -52,
    fd_close: () => 52,
    fd_read: () => 52,
    fd_seek: () => 70,
    fd_write: () => 52,
    emscripten_date_now: () => Date.now(),
    emscripten_memcpy_js: (destination: number, source: number, count: number) => {
      destination >>>= 0; source >>>= 0; count >>>= 0;
      new Uint8Array(wasm.memory.buffer).copyWithin(destination, source, source + count);
      return destination;
    },
    emscripten_resize_heap: (size: number) => {
      const target = Math.ceil((size >>> 0) / 65536) * 65536;
      if (target > ICC_WASM_MAX_BYTES) throw iccMemoryError();
      try { wasm.memory.grow((target - wasm.memory.buffer.byteLength) / 65536); }
      catch (cause) { throw iccMemoryError(cause); }
      return 1;
    },
    _tzset_js: (timezone: number, daylight: number, standard: number, summer: number) => {
      const view = new DataView(wasm.memory.buffer);
      view.setInt32(timezone, 0, true);
      view.setInt32(daylight, 0, true);
      new Uint8Array(wasm.memory.buffer).set([85, 84, 67, 0], standard);
      new Uint8Array(wasm.memory.buffer).set([85, 84, 67, 0], summer);
    },
    _gmtime_js: (seconds: number, pointer: number) => {
      const date = new Date(seconds * 1000);
      const values = [date.getUTCSeconds(), date.getUTCMinutes(), date.getUTCHours(),
        date.getUTCDate(), date.getUTCMonth(), date.getUTCFullYear() - 1900,
        date.getUTCDay(), Math.floor((date.getTime() - Date.UTC(date.getUTCFullYear(), 0, 1)) / 86400000), 0];
      new Int32Array(wasm.memory.buffer, pointer, values.length).set(values);
    },
    invoke_ii: invoke, invoke_iii: invoke, invoke_v: invoke, invoke_vi: invoke,
    invoke_vii: invoke, invoke_viii: invoke, invoke_viiii: invoke
  };
  wasm = new WebAssembly.Instance(module, { env: imports, wasi_snapshot_preview1: imports }).exports as LcmsExports;
  wasm.emscripten_stack_init();
  wasm.__wasm_call_ctors();
  return wasm;
}

export async function resolveLcmsTransform(
  request: Readonly<NativeIccTransformRequest>, signal?: AbortSignal
): Promise<NativeIccTransformResult> {
  const module = await loadModule(signal);
  throwIfAborted(signal);
  let wasm: LcmsExports;
  try { wasm = instantiate(module); } catch (cause) {
    if (cause instanceof PdfError) throw cause;
    if (cause instanceof RangeError) throw iccMemoryError(cause);
    throw new IccEngineError("engine-load-failed", cause);
  }
  let profilePointer = 0, inputProfile = 0, outputProfile = 0, transform = 0;
  let inputPointer = 0, outputPointer = 0;
  const allocate = (size: number) => {
    const pointer = wasm.malloc(size) >>> 0;
    if (!pointer) throw iccMemoryError();
    return pointer;
  };
  try {
    profilePointer = allocate(request.profile.length);
    new Uint8Array(wasm.memory.buffer, profilePointer, request.profile.length).set(request.profile);
    inputProfile = wasm.cmsOpenProfileFromMem(profilePointer, request.profile.length);
    if (!inputProfile) throw new IccEngineError("profile-unsupported");
    outputProfile = wasm.cmsCreate_sRGBProfile();
    if (!outputProfile) throw iccMemoryError();
    const format = wasm.cmsFormatterForColorspaceOfProfile(inputProfile, 1, 0);
    const outputFormat = wasm.cmsFormatterForColorspaceOfProfile(outputProfile, 1, 0);
    // Relative colorimetric, no black-point compensation; matches the public bridge.
    transform = wasm.cmsCreateTransform(inputProfile, format, outputProfile, outputFormat, 1, 0);
    if (!transform) throw new IccEngineError("profile-unsupported");
    const chunkSize = 4096;
    inputPointer = allocate(chunkSize * request.inputComponents);
    outputPointer = allocate(chunkSize * 3);
    const samples = new Uint8Array(request.sampleCount * 3);
    for (let first = 0; first < request.sampleCount; first += chunkSize) {
      await yieldIccConversion(signal);
      const count = Math.min(chunkSize, request.sampleCount - first);
      new Uint8Array(wasm.memory.buffer, inputPointer, count * request.inputComponents).set(
        request.inputSamples.subarray(first * request.inputComponents, (first + count) * request.inputComponents)
      );
      wasm.cmsDoTransform(transform, inputPointer, outputPointer, count);
      samples.set(new Uint8Array(wasm.memory.buffer, outputPointer, count * 3), first * 3);
    }
    return { samples, sampleCount: request.sampleCount, outputComponents: 3, bitsPerComponent: 8 };
  } catch (cause) {
    if (cause instanceof WebAssembly.RuntimeError || cause instanceof RangeError) throw iccMemoryError(cause);
    throw cause;
  } finally {
    if (transform) wasm.cmsDeleteTransform(transform);
    if (inputProfile) wasm.cmsCloseProfile(inputProfile);
    if (outputProfile) wasm.cmsCloseProfile(outputProfile);
    if (profilePointer) wasm.free(profilePointer);
    if (inputPointer) wasm.free(inputPointer);
    if (outputPointer) wasm.free(outputPointer);
  }
}
