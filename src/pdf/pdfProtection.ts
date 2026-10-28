import { isPdfDictionary, isPdfName, isPdfStream, isPdfString, type PdfDictionary, type PdfRef, type PdfValue } from "./nativeCos";
import { preparePdfPassword } from "./pdfPasswordPrep";

/** Password handling for a newly saved PDF. The source password remains an input-only option. */
export type PdfOutputProtection =
  | { readonly mode: "preserve" }
  | { readonly mode: "remove" }
  | { readonly mode: "password"; readonly password: string; readonly ownerPassword?: string };

/** Validate and copy caller input before an asynchronous save starts. */
export function validatePdfOutputProtection(policy?: unknown): PdfOutputProtection {
  if (policy === undefined) return { mode: "preserve" };
  if (policy === null || typeof policy !== "object" || Array.isArray(policy)) throw new TypeError("PDF output protection must be an object.");
  const value = policy as { mode?: unknown; password?: unknown; ownerPassword?: unknown };
  if (value.mode === "preserve" || value.mode === "remove") return { mode: value.mode };
  if (value.mode !== "password") throw new TypeError("Unknown PDF output protection mode.");
  const validatePassword = (password: unknown, label: string): string => {
    if (typeof password !== "string") throw new TypeError(`The PDF ${label} must be a string.`);
    const length = new TextEncoder().encode(preparePdfPassword(password)).length;
    if (!length) throw new RangeError(`The PDF ${label} cannot be empty.`);
    if (length > 127) throw new RangeError(`The PDF ${label} cannot exceed 127 UTF-8 bytes after Unicode normalization.`);
    return password;
  };
  const password = validatePassword(value.password, "opening password");
  return value.ownerPassword === undefined ? { mode: "password", password }
    : { mode: "password", password, ownerPassword: validatePassword(value.ownerPassword, "owner password") };
}

interface PdfPasswordProtection {
  readonly dictionary: PdfDictionary;
  readonly fileIds: PdfValue[];
  encryptObject(value: PdfValue, ref: PdfRef): Promise<PdfValue>;
}

const bytesValue = (bytes: Uint8Array): PdfValue => ({ kind: "string", hex: true, bytes });
const nameValue = (value: string): PdfValue => ({ kind: "name", value });
const inputBytes = (bytes: Uint8Array): Uint8Array<ArrayBuffer> => bytes as Uint8Array<ArrayBuffer>;
function join(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; } return bytes;
}

/** ISO 32000-2's SASLprep/UTF-8/127-byte representation. */
function passwordBytes(password: string): Uint8Array<ArrayBuffer> {
  if (typeof password !== "string") throw new TypeError("A PDF password must be a string.");
  return new TextEncoder().encode(preparePdfPassword(password)).subarray(0, 127);
}

/**
 * ISO 32000-2 Algorithms 2.B, 8, 9 and 10. Output protection uses platform
 * cryptography and non-extractable AES keys; the parser's portable decryption
 * primitives are deliberately not used to protect newly written secrets.
 */
export async function createPdfPasswordProtection(password: string, ownerPassword?: string, signal?: AbortSignal): Promise<PdfPasswordProtection> {
  signal?.throwIfAborted();
  const policy = validatePdfOutputProtection({ mode: "password", password, ownerPassword });
  if (policy.mode !== "password") throw new TypeError("A password protection policy is required.");
  const platform = globalThis.crypto, subtle = platform?.subtle;
  if (!subtle || !platform.getRandomValues) throw new Error("Saving a password-protected PDF requires WebCrypto (HTTPS or localhost).");
  const random = (length: number): Uint8Array<ArrayBuffer> => platform.getRandomValues(new Uint8Array(length));
  const aesKey = (key: Uint8Array) => subtle.importKey("raw", inputBytes(key), "AES-CBC", false, ["encrypt"]);
  const aes = async (key: CryptoKey, data: Uint8Array, iv: Uint8Array, padding: boolean): Promise<Uint8Array<ArrayBuffer>> => {
    signal?.throwIfAborted();
    const output = new Uint8Array(await subtle.encrypt({ name: "AES-CBC", iv: inputBytes(iv) }, key, inputBytes(data)));
    // WebCrypto supplies PKCS#7 padding. For ISO's whole-block unpadded
    // operations the preceding ciphertext blocks are identical; omit only the
    // extra encrypted padding block. A single zero-IV CBC block is ECB.
    return padding ? output : output.subarray(0, data.length);
  };
  const hash = async (password: Uint8Array, salt: Uint8Array, user: Uint8Array): Promise<Uint8Array<ArrayBuffer>> => {
    let key = new Uint8Array(await subtle.digest("SHA-256", join([password, salt, user])));
    for (let round = 0; ; round++) {
      signal?.throwIfAborted();
      const sequence = join([password, key, user]), repeated = new Uint8Array(sequence.length * 64);
      for (let index = 0; index < 64; index++) repeated.set(sequence, index * sequence.length);
      const encrypted = await aes(await aesKey(key.subarray(0, 16)), repeated, key.subarray(16, 32), false);
      let selector = 0; for (let index = 0; index < 16; index++) selector += encrypted[index];
      key = new Uint8Array(await subtle.digest(["SHA-256", "SHA-384", "SHA-512"][selector % 3], encrypted));
      if (round >= 63 && encrypted[encrypted.length - 1] <= round - 31) return key.subarray(0, 32);
    }
  };
  const userPassword = passwordBytes(policy.password), owner = passwordBytes(policy.ownerPassword ?? policy.password), empty = new Uint8Array(0), zeroIv = new Uint8Array(16);
  const fileKey = random(32), userSalts = random(16), ownerSalts = random(16);
  const user = join([await hash(userPassword, userSalts.subarray(0, 8), empty), userSalts]);
  const userEncrypted = await aes(await aesKey(await hash(userPassword, userSalts.subarray(8), empty)), fileKey, zeroIv, false);
  const ownerEntry = join([await hash(owner, ownerSalts.subarray(0, 8), user), ownerSalts]);
  const ownerEncrypted = await aes(await aesKey(await hash(owner, ownerSalts.subarray(8), user)), fileKey, zeroIv, false);
  const permissions = -4, permissionBytes = random(16);
  const permissionView = new DataView(permissionBytes.buffer);
  permissionView.setInt32(0, permissions, true); permissionBytes.fill(255, 4, 8);
  permissionBytes.set([0x54, 0x61, 0x64, 0x62], 8); // EncryptMetadata=true, followed by "adb".
  const key = await aesKey(fileKey), perms = await aes(key, permissionBytes, zeroIv, false);
  fileKey.fill(0); userPassword.fill(0); owner.fill(0);
  const dictionary: PdfDictionary = new Map([
    ["Filter", nameValue("Standard")], ["V", 5], ["R", 6], ["Length", 256], ["P", permissions], ["EncryptMetadata", true],
    ["U", bytesValue(user)], ["UE", bytesValue(userEncrypted)], ["O", bytesValue(ownerEntry)], ["OE", bytesValue(ownerEncrypted)], ["Perms", bytesValue(perms)],
    ["CF", new Map([["StdCF", new Map<string, PdfValue>([["CFM", nameValue("AESV3")], ["AuthEvent", nameValue("DocOpen")], ["Length", 32]])]])],
    ["StmF", nameValue("StdCF")], ["StrF", nameValue("StdCF")], ["EFF", nameValue("StdCF")]
  ]);
  const encryptBytes = async (plain: Uint8Array) => { const iv = random(16); return join([iv, await aes(key, plain, iv, true)]); };
  const encryptValue = async (value: PdfValue): Promise<PdfValue> => {
    signal?.throwIfAborted();
    if (isPdfString(value)) return { ...value, bytes: await encryptBytes(value.bytes) };
    if (Array.isArray(value)) {
      const values: PdfValue[] = []; for (const entry of value) values.push(await encryptValue(entry)); return values;
    }
    if (isPdfStream(value)) {
      if (isPdfName(value.dictionary.get("Type"), "XRef")) return value;
      return { kind: "stream", dictionary: await encryptValue(value.dictionary) as PdfDictionary, bytes: await encryptBytes(value.bytes) };
    }
    if (isPdfDictionary(value)) {
      const dictionary: PdfDictionary = new Map();
      for (const [name, entry] of value) dictionary.set(name, await encryptValue(entry));
      return dictionary;
    }
    return value;
  };
  return { dictionary, fileIds: [bytesValue(random(16)), bytesValue(random(16))], encryptObject: value => encryptValue(value) };
}
