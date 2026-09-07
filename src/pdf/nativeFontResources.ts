import {
  isPdfName,
  isPdfRef,
  pdfRefKey,
  type PdfDictionary,
  type PdfValue
} from "./nativeCos";
import type { NativePdfDocument } from "./nativeDocument";
import {
  parseNativePdfFont,
  type NativeMissingFontResolver
} from "./nativeFont";
import type { NativeTextFontResource } from "./nativeText";
import {
  NativePdfType3Registry,
  type NativePdfPreparedType3Font
} from "./nativeType3";
import { PdfError, type PdfDiagnostic } from "./nativeTypes";

export interface NativeFontScopeOptions {
  readonly label: string;
  readonly allowType3: boolean;
}

/**
 * One page-owned font namespace. Resource names remain scope-local while the
 * underlying parsed font and its page ABI index are deduplicated safely.
 *
 * This registry intentionally does not own the source document or close it.
 * Callers may load several resource scopes before building the final page
 * text stores.
 *
 * @internal
 */
export class NativePageFontRegistry {
  readonly resources: NativeTextFontResource[] = [];

  private readonly document: NativePdfDocument;
  private readonly pageIndex: number;
  private readonly missingFontResolver: NativeMissingFontResolver | undefined;
  private readonly type3Registry: NativePdfType3Registry;
  private readonly cache = new Map<string, Promise<NativeTextFontResource>>();
  private readonly directIds = new WeakMap<PdfDictionary, number>();
  private readonly scopeIds = new WeakMap<PdfDictionary, number>();
  private nextDirectId = 1;
  private nextScopeId = 1;

  constructor(
    document: NativePdfDocument,
    pageIndex: number,
    missingFontResolver?: NativeMissingFontResolver,
    type3Registry = new NativePdfType3Registry(document)
  ) {
    if (!Number.isSafeInteger(pageIndex) || pageIndex < 0) {
      throw new RangeError("Native page font registry requires a non-negative page index.");
    }
    this.document = document;
    this.pageIndex = pageIndex;
    this.missingFontResolver = missingFontResolver;
    this.type3Registry = type3Registry;
  }

  async loadScope(
    resources: PdfDictionary,
    resourceNames: readonly string[],
    signal: AbortSignal,
    options: NativeFontScopeOptions
  ): Promise<Array<readonly [string, NativeTextFontResource]>> {
    signal.throwIfAborted();
    if (resourceNames.length === 0) return [];
    const rawFonts = resources.get("Font");
    if (rawFonts === undefined || rawFonts === null) {
      throw new PdfError(
        "unsupported-font",
        `${options.label} content references fonts but /Font resources are missing.`,
        {
          pageIndex: this.pageIndex,
          details: { reason: "font-resources-missing", resourceName: resourceNames[0] }
        }
      );
    }
    const fonts = await this.document.resolveDictionary(rawFonts, signal);
    const result: Array<readonly [string, NativeTextFontResource]> = [];
    for (const resourceName of resourceNames) {
      signal.throwIfAborted();
      const value = fonts.get(resourceName);
      if (value === undefined || value === null) {
        throw new PdfError(
          "unsupported-font",
          `${options.label} font resource /${resourceName} is missing.`,
          {
            pageIndex: this.pageIndex,
            details: { reason: "font-resource-missing", resourceName }
          }
        );
      }
      result.push([
        resourceName,
        await this.loadFont(value, resources, resourceName, signal, options)
      ]);
    }
    return result;
  }

  getDiagnostics(): readonly PdfDiagnostic[] {
    return Object.freeze(this.resources.flatMap(({ font }) => font.diagnostics));
  }

  private async loadFont(
    value: PdfValue,
    resources: PdfDictionary,
    resourceName: string,
    signal: AbortSignal,
    options: NativeFontScopeOptions
  ): Promise<NativeTextFontResource> {
    const dictionary = await this.document.resolveDictionary(value, signal);
    const subtype = await this.document.resolveValue(dictionary.get("Subtype"), signal);
    const type3 = isPdfName(subtype, "Type3");
    if (type3 && !options.allowType3) {
      throw new PdfError(
        "unsupported-font",
        `${options.label} font /${resourceName} is Type3; reusable-program Type3 text is not integrated.`,
        {
          pageIndex: this.pageIndex,
          details: { reason: "program-type3-text-not-integrated", resourceName }
        }
      );
    }
    const identity = isPdfRef(value)
      ? pdfRefKey(value)
      : `direct:${this.directId(dictionary)}`;
    // Type3 CharProcs may inherit the active resource scope. Ordinary font
    // dictionaries are context-free and safely share one page-local record.
    const key = type3
      ? `${identity}@scope:${this.scopeId(resources)}`
      : identity;
    const cached = this.cache.get(key);
    if (cached) return await cached;
    const pending = this.parseFont(
      value,
      dictionary,
      resources,
      signal,
      type3
    ).catch((error) => {
      this.cache.delete(key);
      throw error;
    });
    this.cache.set(key, pending);
    return await pending;
  }

  private async parseFont(
    value: PdfValue,
    dictionary: PdfDictionary,
    resources: PdfDictionary,
    signal: AbortSignal,
    type3: boolean
  ): Promise<NativeTextFontResource> {
    const font = await parseNativePdfFont(value, this.document, {
      signal,
      missingFontResolver: this.missingFontResolver
    });
    let prepared: NativePdfPreparedType3Font | undefined;
    if (type3) {
      prepared = await this.type3Registry.prepareFont(dictionary, {
        inheritedResources: resources,
        ...(isPdfRef(value) ? { fontRef: value } : {}),
        signal
      });
    }
    if (this.resources.length >= this.document.limits.maxCachedObjects) {
      throw new PdfError("resource-limit", "Page font resources exceed the object-cache limit.", {
        pageIndex: this.pageIndex,
        details: {
          reason: "page-font-count",
          maxFonts: this.document.limits.maxCachedObjects
        }
      });
    }
    const resource = Object.freeze({
      font,
      fontIndex: this.resources.length,
      ...(prepared ? { type3: prepared } : {})
    });
    this.resources.push(resource);
    return resource;
  }

  private directId(dictionary: PdfDictionary): number {
    const existing = this.directIds.get(dictionary);
    if (existing !== undefined) return existing;
    const id = this.nextDirectId++;
    this.directIds.set(dictionary, id);
    return id;
  }

  private scopeId(resources: PdfDictionary): number {
    const existing = this.scopeIds.get(resources);
    if (existing !== undefined) return existing;
    const id = this.nextScopeId++;
    this.scopeIds.set(resources, id);
    return id;
  }
}
