import {
  isPdfDictionary,
  isPdfName,
  isPdfString,
  type PdfDictionary,
  type PdfName,
  type PdfString,
  type PdfValue
} from "./nativeCos";
import type { NativePdfDocument } from "./nativeDocument";
import {
  parseNativePdfFont,
  type NativeMissingFontResolver,
  type NativePdfFont
} from "./nativeFont";
import {
  NativePdfFormAppearanceRegistry,
  type NativePdfAnnotationAppearance,
  type NativePdfChoiceOption,
  type NativePdfForm,
  type NativePdfFormInvocation,
  type NativePdfMatrix,
  type NativePdfRectangle,
  type NativePdfResolvedAnnotationAppearance
} from "./nativeForms";
import type { NativeOptionalContentRegistry } from "./nativeOptionalContent";
import {
  PdfError,
  type PdfDiagnostic,
  throwIfAborted
} from "./nativeTypes";

export interface NativePdfAppearanceSynthesisOptions {
  readonly missingFontResolver?: NativeMissingFontResolver;
  /** Required when synthesized annotations carry an /OC association. */
  readonly optionalContent?: NativeOptionalContentRegistry;
  /** Maximum automatically selected text size in default user-space units. @default 72 */
  readonly maxAutoFontSize?: number;
  readonly onDiagnostic?: (diagnostic: Readonly<PdfDiagnostic>) => void;
}

/**
 * A normal appearance structurally compatible with the native Form registry.
 * `decodedContent` is already decoded PDF content and has no filter chain.
 */
export interface NativePdfSynthesizedAppearance extends NativePdfResolvedAnnotationAppearance {
  readonly synthesized: true;
  readonly decodedContent: Uint8Array;
  /** Synthesized appearances contain no nested Form XObjects. */
  readonly formResources: ReadonlyMap<string, number>;
  readonly diagnostic: Readonly<PdfDiagnostic>;
}

interface AppearanceCharacteristics {
  readonly rotation: 0 | 90 | 180 | 270;
  readonly borderColor: AppearanceColor | null;
  readonly backgroundColor: AppearanceColor | null;
  readonly caption: string | null;
  readonly hasIconSemantics: boolean;
}

interface BorderStyle {
  readonly width: number;
  readonly style: "solid" | "dashed" | "underline";
  readonly dash: readonly number[];
}

interface LinkBorderStyle extends BorderStyle {
  readonly horizontalRadius: number;
  readonly verticalRadius: number;
}

interface DefaultAppearance {
  readonly fontResourceName: string | null;
  readonly fontSize: number;
  readonly color: AppearanceColor;
}

interface AppearanceColor {
  readonly components: readonly number[];
}

interface EncodedGlyph {
  readonly bytes: Uint8Array;
  readonly width: number;
  readonly unicode: string;
}

interface EncodedLine {
  readonly glyphs: readonly EncodedGlyph[];
  readonly bytes: Uint8Array;
  readonly width: number;
}

interface TextLayout {
  readonly fontSize: number;
  readonly lines: readonly EncodedLine[];
  readonly leading: number;
}

interface LogicalAppearanceGeometry {
  readonly width: number;
  readonly height: number;
  readonly bbox: NativePdfRectangle;
  readonly matrix: NativePdfMatrix;
}

interface DecodedChoiceOption {
  readonly exportValue: string;
  readonly displayValue: string;
}

interface ResolvedChoiceSelection {
  readonly indices: ReadonlySet<number>;
  readonly displayValues: readonly string[];
}

const FIELD_FLAG_MULTILINE = 1 << 12;
const FIELD_FLAG_PASSWORD = 1 << 13;
const FIELD_FLAG_RADIO = 1 << 15;
const FIELD_FLAG_PUSH_BUTTON = 1 << 16;
const FIELD_FLAG_COMBO = 1 << 17;
const FIELD_FLAG_EDIT = 1 << 18;
const FIELD_FLAG_FILE_SELECT = 1 << 20;
const FIELD_FLAG_MULTI_SELECT = 1 << 21;
const FIELD_FLAG_COMB = 1 << 24;
const FIELD_FLAG_RICH_TEXT = 1 << 25;
const EMPTY_FORM_RESOURCES: ReadonlyMap<string, number> = new Map();
const DEFAULT_COLOR: AppearanceColor = Object.freeze({ components: Object.freeze([0]) });
const TEXT_ENCODER = new TextEncoder();
const KAPPA = 0.5522847498307936;

/**
 * Deterministically synthesizes static default-view appearances for common
 * AcroForm widgets and Link borders. It never changes field values or the PDF.
 * Unsupported semantics fail with a typed error instead of being omitted.
 */
export class NativePdfAppearanceSynthesizer {
  readonly document: NativePdfDocument;

  private readonly missingFontResolver?: NativeMissingFontResolver;
  private readonly optionalContent?: NativeOptionalContentRegistry;
  private readonly maxAutoFontSize: number;
  private readonly onDiagnostic?: (diagnostic: Readonly<PdfDiagnostic>) => void;
  private readonly diagnostics: PdfDiagnostic[] = [];
  private readonly resultCache = new WeakMap<NativePdfAnnotationAppearance, NativePdfSynthesizedAppearance>();
  private readonly contentByForm = new WeakMap<NativePdfForm, Uint8Array>();
  private readonly fontCache = new WeakMap<PdfDictionary, Map<string, Promise<NativePdfFont>>>();

  constructor(
    document: NativePdfDocument,
    options: NativePdfAppearanceSynthesisOptions = {}
  ) {
    this.document = document;
    this.missingFontResolver = options.missingFontResolver;
    this.optionalContent = options.optionalContent;
    const maxAutoFontSize = options.maxAutoFontSize ?? 72;
    if (!Number.isFinite(maxAutoFontSize) || maxAutoFontSize <= 0) {
      throw new RangeError("maxAutoFontSize must be a positive finite number.");
    }
    this.maxAutoFontSize = maxAutoFontSize;
    this.onDiagnostic = options.onDiagnostic;
  }

  getDiagnostics(): readonly PdfDiagnostic[] {
    return Object.freeze(this.diagnostics.map((diagnostic) => Object.freeze({ ...diagnostic })));
  }

  ownsForm(form: NativePdfForm): boolean {
    return this.contentByForm.has(form);
  }

  /** Return decoded synthetic content, or null for a source-backed Form. */
  getDecodedFormContent(form: NativePdfForm): Uint8Array | null {
    return this.contentByForm.get(form) ?? null;
  }

  async synthesize(
    annotation: NativePdfAnnotationAppearance,
    signal?: AbortSignal
  ): Promise<NativePdfSynthesizedAppearance | null> {
    throwIfAborted(signal);
    const cached = this.resultCache.get(annotation);
    if (cached) return cached;
    if (!annotation.visibleInDefaultView) return null;
    let optionalContentIndex = -1;
    if (annotation.optionalContent !== undefined && annotation.optionalContent !== null) {
      if (!this.optionalContent) {
        throw synthesisError(annotation, "Optional-content visibility must be evaluated before appearance synthesis.", {
          reason: "annotation-optional-content"
        });
      }
      const membership = await this.optionalContent.resolvePropertyValue(annotation.optionalContent, signal);
      if (!membership) {
        throw new PdfError("invalid-object", "Annotation /OC does not resolve to an OCG or OCMD membership.", {
          pageIndex: annotation.pageIndex,
          details: {
            annotationIndex: annotation.annotationIndex,
            feature: "appearance-synthesis",
            reason: "annotation-optional-content-invalid"
          }
        });
      }
      if (!membership.defaultVisible) return null;
      optionalContentIndex = membership.index;
    }
    if (annotation.subtype === "Link") {
      await this.requireMissingNormalAppearance(annotation, signal);
      return await this.synthesizeLinkBorder(annotation, optionalContentIndex, signal);
    }
    if (annotation.subtype !== "Widget" || !annotation.widget) {
      throw synthesisError(annotation, "Only AcroForm Widgets and Link borders have synthesizable appearances.", {
        reason: "appearance-synthesis-unsupported-subtype",
        subtype: annotation.subtype
      });
    }
    await this.requireMissingNormalAppearance(annotation, signal);

    const geometry = await this.readGeometry(annotation, signal);
    const mk = await this.readAppearanceCharacteristics(annotation, signal);
    const border = await this.readBorderStyle(annotation, signal);
    if (border.width > Math.min(geometry.width, geometry.height)) {
      throw new PdfError("invalid-object", "Widget border width exceeds its appearance bounds.", {
        pageIndex: annotation.pageIndex,
        details: { annotationIndex: annotation.annotationIndex, feature: "appearance-synthesis" }
      });
    }
    const defaultAppearance = annotation.widget.defaultAppearance
      ? parseDefaultAppearance(annotation.widget.defaultAppearance.bytes, annotation)
      : { fontResourceName: null, fontSize: 0, color: DEFAULT_COLOR };

    let content: Uint8Array;
    let stateName: string | undefined;
    switch (annotation.widget.fieldType) {
      case "Tx":
        content = await this.synthesizeTextField(
          annotation,
          geometry,
          mk,
          border,
          defaultAppearance,
          signal
        );
        break;
      case "Btn": {
        const button = await this.synthesizeButton(
          annotation,
          geometry,
          mk,
          border,
          defaultAppearance,
          signal
        );
        content = button.content;
        stateName = button.stateName;
        break;
      }
      case "Sig":
        throw synthesisError(annotation, "Signature-field appearance synthesis is out of scope.", {
          reason: "appearance-signature-unsupported"
        });
      case "Ch":
        content = await this.synthesizeChoiceField(
          annotation,
          geometry,
          mk,
          border,
          defaultAppearance,
          signal
        );
        break;
      case undefined:
        throw new PdfError("invalid-object", "A Widget requiring synthesis has no inherited /FT.", {
          pageIndex: annotation.pageIndex,
          details: { annotationIndex: annotation.annotationIndex, feature: "appearance-synthesis" }
        });
      default:
        throw synthesisError(annotation, `Field type /${annotation.widget.fieldType} is not synthesizable.`, {
          reason: "appearance-field-type-unsupported",
          fieldType: annotation.widget.fieldType
        });
    }

    const resources = annotation.widget.acroForm?.defaultResources ?? new Map<string, PdfValue>();
    return this.finishSynthesis(
      annotation,
      geometry,
      content,
      resources,
      annotation.widget.acroForm?.defaultResources ? "inherited" : "empty",
      optionalContentIndex,
      stateName
    );
  }

  private finishSynthesis(
    annotation: NativePdfAnnotationAppearance,
    geometry: LogicalAppearanceGeometry,
    content: Uint8Array,
    resources: PdfDictionary,
    resourceOrigin: "inherited" | "empty",
    optionalContentIndex: number,
    stateName?: string
  ): NativePdfSynthesizedAppearance {
    if (content.length > this.document.limits.maxDecodedStreamBytes) {
      throw new PdfError("resource-limit", "A synthesized appearance exceeds the decoded-stream limit.", {
        pageIndex: annotation.pageIndex,
        details: {
          annotationIndex: annotation.annotationIndex,
          feature: "appearance-synthesis",
          byteLength: content.length,
          limit: this.document.limits.maxDecodedStreamBytes
        }
      });
    }
    const id = `synthetic:${annotation.id}:normal`;
    const dictionary: PdfDictionary = new Map();
    dictionary.set("Type", pdfName("XObject"));
    dictionary.set("Subtype", pdfName("Form"));
    dictionary.set("FormType", 1);
    dictionary.set("BBox", [...geometry.bbox]);
    dictionary.set("Matrix", [...geometry.matrix]);
    dictionary.set("Resources", resources);
    const form: NativePdfForm = Object.freeze({
      id,
      ref: null,
      dictionary,
      bbox: geometry.bbox,
      matrix: geometry.matrix,
      resources,
      resourceOrigin,
      encodedContentBytes: content.length
    });
    const invocation: NativePdfFormInvocation = Object.freeze({
      form,
      depth: 1,
      ancestry: Object.freeze([id])
    });
    const diagnosticDetails: Record<string, string | number | boolean | null> = {
      annotationIndex: annotation.annotationIndex,
      subtype: annotation.subtype
    };
    if (annotation.widget) {
      diagnosticDetails.fieldType = annotation.widget.fieldType ?? null;
      diagnosticDetails.fieldName = annotation.widget.fullyQualifiedName ?? null;
    }
    const diagnostic: PdfDiagnostic = Object.freeze({
      code: "annotation.appearance-synthesized",
      severity: "warning",
      message: `Synthesized a deterministic normal appearance for /${annotation.subtype} annotation ${annotation.annotationIndex}.`,
      pageIndex: annotation.pageIndex,
      details: Object.freeze(diagnosticDetails)
    });
    const result: NativePdfSynthesizedAppearance = Object.freeze({
      annotation,
      normalAppearance: invocation,
      stateName,
      optionalContentIndex,
      synthesized: true,
      decodedContent: content,
      formResources: EMPTY_FORM_RESOURCES,
      diagnostic
    });
    this.contentByForm.set(form, content);
    this.resultCache.set(annotation, result);
    this.diagnostics.push(diagnostic);
    this.onDiagnostic?.(diagnostic);
    return result;
  }

  private async synthesizeLinkBorder(
    annotation: NativePdfAnnotationAppearance,
    optionalContentIndex: number,
    signal?: AbortSignal
  ): Promise<NativePdfSynthesizedAppearance | null> {
    const border = await this.readLinkBorderStyle(annotation, signal);
    // A zero-width border is explicitly non-painting. It is not an unsupported
    // visible annotation and therefore needs neither a display command nor a
    // synthetic empty Form.
    if (border.width === 0) return null;
    const color = await this.readLinkColor(annotation, signal);
    // ISO 32000 defines an empty /C array as transparent/no colour.
    if (!color) return null;

    const opacity = await optionalFiniteNumber(
      this.document,
      annotation.dictionary,
      "CA",
      1,
      signal,
      "Link annotation"
    );
    if (opacity < 0 || opacity > 1) {
      throw new PdfError("invalid-object", "Link annotation /CA must be from 0 through 1.", {
        pageIndex: annotation.pageIndex,
        details: { annotationIndex: annotation.annotationIndex, feature: "appearance-synthesis" }
      });
    }
    if (opacity === 0) return null;
    if (opacity !== 1) {
      throw synthesisError(annotation, "A translucent Link border is not yet synthesizable.", {
        reason: "appearance-link-opacity-unsupported",
        opacity
      });
    }

    const geometry = this.readLinkGeometry(annotation);
    if (!geometry) return null;
    if (border.width > Math.min(geometry.width, geometry.height)) {
      throw new PdfError("invalid-object", "Link border width exceeds its appearance bounds.", {
        pageIndex: annotation.pageIndex,
        details: { annotationIndex: annotation.annotationIndex, feature: "appearance-synthesis" }
      });
    }

    const inset = border.width / 2;
    const innerWidth = geometry.width - border.width;
    const innerHeight = geometry.height - border.width;
    const lines = ["q", strokeColorOperator(color), `${pdfNumber(border.width)} w`];
    if (border.style === "dashed") {
      lines.push(`[${border.dash.map(pdfNumber).join(" ")}] 0 d`);
    }
    if (border.style === "underline") {
      lines.push(
        `${pdfNumber(inset)} ${pdfNumber(inset)} m ` +
        `${pdfNumber(geometry.width - inset)} ${pdfNumber(inset)} l S`
      );
    } else if (
      border.horizontalRadius > 0 && border.verticalRadius > 0 &&
      innerWidth > 0 && innerHeight > 0
    ) {
      lines.push(
        `${roundedRectanglePath(
          inset,
          inset,
          innerWidth,
          innerHeight,
          Math.min(border.horizontalRadius, innerWidth / 2),
          Math.min(border.verticalRadius, innerHeight / 2)
        )} S`
      );
    } else {
      lines.push(
        `${pdfNumber(inset)} ${pdfNumber(inset)} ${pdfNumber(innerWidth)} ` +
        `${pdfNumber(innerHeight)} re S`
      );
    }
    lines.push("Q");
    const content = encodeContent(lines);
    return this.finishSynthesis(
      annotation,
      geometry,
      content,
      new Map<string, PdfValue>(),
      "empty",
      optionalContentIndex
    );
  }

  private readLinkGeometry(
    annotation: NativePdfAnnotationAppearance
  ): LogicalAppearanceGeometry | null {
    const width = annotation.rectangle[2] - annotation.rectangle[0];
    const height = annotation.rectangle[3] - annotation.rectangle[1];
    if (width === 0 || height === 0) return null;
    if (width >= 1e20 || height >= 1e20) {
      throw new PdfError("resource-limit", "A Link /Rect exceeds the synthesized appearance coordinate limit.", {
        pageIndex: annotation.pageIndex,
        details: {
          annotationIndex: annotation.annotationIndex,
          feature: "appearance-synthesis",
          reason: "appearance-bounds-range"
        }
      });
    }
    return freezeGeometry(width, height, [1, 0, 0, 1, 0, 0]);
  }

  private async synthesizeTextField(
    annotation: NativePdfAnnotationAppearance,
    geometry: LogicalAppearanceGeometry,
    mk: AppearanceCharacteristics,
    border: BorderStyle,
    da: DefaultAppearance,
    signal?: AbortSignal
  ): Promise<Uint8Array> {
    const widget = annotation.widget!;
    const unsupportedFlags = widget.fieldFlags & FIELD_FLAG_RICH_TEXT;
    if (unsupportedFlags !== 0) {
      throw synthesisError(annotation, "This text field uses unsupported appearance semantics.", {
        reason: "appearance-text-flags-unsupported",
        fieldFlags: widget.fieldFlags,
        unsupportedFlags
      });
    }
    const rawValue = widget.value;
    if (rawValue !== undefined && rawValue !== null && !isPdfString(rawValue)) {
      throw new PdfError("invalid-object", "A text field /V is not a string.", {
        pageIndex: annotation.pageIndex,
        details: { annotationIndex: annotation.annotationIndex, feature: "appearance-synthesis" }
      });
    }
    const text = rawValue
      ? normalizeFieldText(decodePdfTextString(rawValue, annotation), annotation)
      : "";
    const characters = [...text];
    if (widget.maxLength !== undefined && characters.length > widget.maxLength) {
      throw new PdfError("invalid-object", "A text field /V exceeds its inherited /MaxLen.", {
        pageIndex: annotation.pageIndex,
        details: {
          annotationIndex: annotation.annotationIndex,
          feature: "appearance-synthesis",
          reason: "appearance-text-max-length",
          maxLength: widget.maxLength
        }
      });
    }
    const lines: string[] = [];
    appendRectangularBackgroundAndBorder(lines, geometry.width, geometry.height, mk, border);
    if (text.length === 0) return encodeContent(lines);

    const font = await this.loadFont(annotation, da.fontResourceName, signal);
    const multiline = (widget.fieldFlags & FIELD_FLAG_MULTILINE) !== 0;
    const password = (widget.fieldFlags & FIELD_FLAG_PASSWORD) !== 0;
    const comb = (widget.fieldFlags & FIELD_FLAG_COMB) !== 0;
    const fileSelect = (widget.fieldFlags & FIELD_FLAG_FILE_SELECT) !== 0;
    if (comb && (multiline || password || fileSelect || widget.maxLength === undefined)) {
      throw synthesisError(annotation, "A comb field has an invalid flag or /MaxLen combination.", {
        reason: "appearance-comb-semantics",
        multiline,
        password,
        fileSelect,
        maxLength: widget.maxLength ?? null
      });
    }
    const displayText = password ? "*".repeat(characters.length) : text;
    const normalizedText = multiline ? displayText : displayText.replace(/\n/g, " ");
    const glyphParagraphs = await encodeTextParagraphs(font, normalizedText, multiline, annotation);
    const padding = appearancePadding(border, mk);
    const innerWidth = geometry.width - padding * 2;
    const innerHeight = geometry.height - padding * 2;
    requirePositiveInnerBox(annotation, innerWidth, innerHeight);
    if (comb) {
      appendCombText(
        lines,
        glyphParagraphs[0],
        font,
        da,
        widget.quadding ?? 0,
        widget.maxLength!,
        padding,
        padding,
        innerWidth,
        innerHeight,
        this.maxAutoFontSize
      );
      return encodeContent(lines);
    }
    const layout = layoutText(
      glyphParagraphs,
      font,
      da.fontSize,
      innerWidth,
      innerHeight,
      multiline,
      this.maxAutoFontSize,
      annotation
    );
    appendTextLayout(
      lines,
      layout,
      font,
      da,
      widget.quadding ?? 0,
      padding,
      padding,
      innerWidth,
      innerHeight
    );
    return encodeContent(lines);
  }

  private async synthesizeButton(
    annotation: NativePdfAnnotationAppearance,
    geometry: LogicalAppearanceGeometry,
    mk: AppearanceCharacteristics,
    border: BorderStyle,
    da: DefaultAppearance,
    signal?: AbortSignal
  ): Promise<{ readonly content: Uint8Array; readonly stateName?: string }> {
    const widget = annotation.widget!;
    const radio = (widget.fieldFlags & FIELD_FLAG_RADIO) !== 0;
    const push = (widget.fieldFlags & FIELD_FLAG_PUSH_BUTTON) !== 0;
    if (radio && push) {
      throw new PdfError("invalid-object", "A button field cannot be both radio and push-button.", {
        pageIndex: annotation.pageIndex,
        details: { annotationIndex: annotation.annotationIndex, feature: "appearance-synthesis" }
      });
    }
    if (push) {
      if (mk.hasIconSemantics) {
        throw synthesisError(annotation, "Push-button icon and text-position semantics are unsupported.", {
          reason: "appearance-button-icon-unsupported"
        });
      }
      const lines: string[] = [];
      appendRectangularBackgroundAndBorder(lines, geometry.width, geometry.height, mk, border);
      const caption = mk.caption ?? "";
      if (caption.length > 0) {
        const font = await this.loadFont(annotation, da.fontResourceName, signal);
        const glyphParagraphs = await encodeTextParagraphs(
          font,
          normalizeFieldText(caption, annotation),
          false,
          annotation
        );
        const padding = appearancePadding(border, mk);
        const innerWidth = geometry.width - padding * 2;
        const innerHeight = geometry.height - padding * 2;
        requirePositiveInnerBox(annotation, innerWidth, innerHeight);
        const layout = layoutText(
          glyphParagraphs,
          font,
          da.fontSize,
          innerWidth,
          innerHeight,
          false,
          this.maxAutoFontSize,
          annotation
        );
        appendTextLayout(lines, layout, font, da, 1, padding, padding, innerWidth, innerHeight);
      }
      return { content: encodeContent(lines) };
    }

    const stateName = buttonState(annotation, radio);
    const on = stateName !== "Off";
    const lines: string[] = [];
    if (radio) {
      if (on && mk.caption !== null && mk.caption !== "l") {
        throw synthesisError(annotation, `Radio-button mark caption ${JSON.stringify(mk.caption)} is unsupported.`, {
          reason: "appearance-radio-mark-unsupported"
        });
      }
      appendRadioBackgroundAndBorder(lines, geometry.width, geometry.height, mk, border);
      if (on) appendRadioMark(lines, geometry.width, geometry.height, da.color, border);
    } else {
      appendRectangularBackgroundAndBorder(lines, geometry.width, geometry.height, mk, border);
      if (on) appendCheckMark(lines, geometry.width, geometry.height, mk.caption, da.color, border, annotation);
    }
    return { content: encodeContent(lines), stateName };
  }

  private async synthesizeChoiceField(
    annotation: NativePdfAnnotationAppearance,
    geometry: LogicalAppearanceGeometry,
    mk: AppearanceCharacteristics,
    border: BorderStyle,
    da: DefaultAppearance,
    signal?: AbortSignal
  ): Promise<Uint8Array> {
    const widget = annotation.widget!;
    const combo = (widget.fieldFlags & FIELD_FLAG_COMBO) !== 0;
    const editable = (widget.fieldFlags & FIELD_FLAG_EDIT) !== 0;
    const multiSelect = (widget.fieldFlags & FIELD_FLAG_MULTI_SELECT) !== 0;
    if (editable && !combo) {
      throw new PdfError("invalid-object", "A choice field sets Edit without Combo.", {
        pageIndex: annotation.pageIndex,
        details: {
          annotationIndex: annotation.annotationIndex,
          feature: "appearance-synthesis",
          reason: "appearance-choice-flags"
        }
      });
    }
    const values = await decodeChoiceValues(this.document, widget.value, annotation, signal);
    if ((combo || !multiSelect) && values.length > 1) {
      throw new PdfError("invalid-object", "A single-select choice field has multiple selected values.", {
        pageIndex: annotation.pageIndex,
        details: {
          annotationIndex: annotation.annotationIndex,
          feature: "appearance-synthesis",
          reason: "appearance-choice-selection-count"
        }
      });
    }
    const options = decodeChoiceOptions(widget.choiceOptions ?? [], annotation);
    const selected = resolveChoiceSelection(
      options,
      values,
      widget.selectedChoiceIndices,
      editable,
      annotation
    );
    const lines: string[] = [];
    appendRectangularBackgroundAndBorder(lines, geometry.width, geometry.height, mk, border);
    const padding = appearancePadding(border, mk);
    const innerWidth = geometry.width - padding * 2;
    const innerHeight = geometry.height - padding * 2;
    requirePositiveInnerBox(annotation, innerWidth, innerHeight);

    if (combo) {
      const selectedText = selected.displayValues[0] ?? values[0] ?? "";
      if (selectedText.length === 0) return encodeContent(lines);
      const font = await this.loadFont(annotation, da.fontResourceName, signal);
      const paragraphs = await encodeTextParagraphs(font, selectedText, false, annotation);
      const layout = layoutText(
        paragraphs,
        font,
        da.fontSize,
        innerWidth,
        innerHeight,
        false,
        this.maxAutoFontSize,
        annotation
      );
      appendTextLayout(
        lines,
        layout,
        font,
        da,
        widget.quadding ?? 0,
        padding,
        padding,
        innerWidth,
        innerHeight
      );
      return encodeContent(lines);
    }

    if (options.length === 0) return encodeContent(lines);
    const font = await this.loadFont(annotation, da.fontResourceName, signal);
    const encodedOptions = await Promise.all(options.map(async (option) =>
      makeEncodedLine((await encodeTextParagraphs(font, option.displayValue, false, annotation))[0])
    ));
    const fontSize = chooseListBoxFontSize(
      encodedOptions,
      font,
      da.fontSize,
      innerWidth,
      innerHeight,
      this.maxAutoFontSize
    );
    appendChoiceList(
      lines,
      encodedOptions,
      selected.indices,
      widget.topChoiceIndex ?? 0,
      font,
      da,
      fontSize,
      widget.quadding ?? 0,
      padding,
      padding,
      innerWidth,
      innerHeight
    );
    return encodeContent(lines);
  }

  private async loadFont(
    annotation: NativePdfAnnotationAppearance,
    resourceName: string | null,
    signal?: AbortSignal
  ): Promise<NativePdfFont> {
    if (!resourceName) {
      throw synthesisFontError(annotation, "A nonempty field appearance has no /DA font selection.", {
        reason: "appearance-font-missing"
      });
    }
    const resources = annotation.widget?.acroForm?.defaultResources;
    if (!resources) {
      throw synthesisFontError(annotation, `Default appearance font /${resourceName} has no AcroForm /DR.`, {
        reason: "appearance-font-resources-missing",
        fontResourceName: resourceName
      });
    }
    let cache = this.fontCache.get(resources);
    if (!cache) {
      cache = new Map();
      this.fontCache.set(resources, cache);
    }
    const cached = cache.get(resourceName);
    if (cached) return await cached;
    const pending = this.loadFontUncached(annotation, resources, resourceName, signal).catch((error) => {
      cache!.delete(resourceName);
      throw error;
    });
    cache.set(resourceName, pending);
    return await pending;
  }

  private async loadFontUncached(
    annotation: NativePdfAnnotationAppearance,
    resources: PdfDictionary,
    resourceName: string,
    signal?: AbortSignal
  ): Promise<NativePdfFont> {
    const rawFonts = resources.get("Font");
    if (rawFonts === undefined || rawFonts === null) {
      throw synthesisFontError(annotation, `AcroForm /DR has no /Font dictionary for /${resourceName}.`, {
        reason: "appearance-font-resources-missing",
        fontResourceName: resourceName
      });
    }
    const fonts = await this.document.resolveDictionary(rawFonts, signal);
    const rawFont = fonts.get(resourceName);
    if (rawFont === undefined || rawFont === null) {
      throw synthesisFontError(annotation, `AcroForm font resource /${resourceName} is missing.`, {
        reason: "appearance-font-missing",
        fontResourceName: resourceName
      });
    }
    const font = await parseNativePdfFont(rawFont, this.document, {
      signal,
      missingFontResolver: this.missingFontResolver
    });
    if (font.subtype === "Type3" || font.writingMode !== 0) {
      throw synthesisFontError(annotation, "Type3 and vertical fonts are unsupported for synthesized field text.", {
        reason: "appearance-font-unsupported",
        fontSubtype: font.subtype,
        writingMode: font.writingMode
      });
    }
    return font;
  }

  private async readGeometry(
    annotation: NativePdfAnnotationAppearance,
    signal?: AbortSignal
  ): Promise<LogicalAppearanceGeometry> {
    throwIfAborted(signal);
    const mk = await resolveOptionalDictionary(this.document, annotation.dictionary.get("MK"), signal, "Widget /MK");
    const rotation = mk
      ? await optionalInteger(this.document, mk, "R", 0, signal, "Widget /MK")
      : 0;
    const normalizedRotation = normalizeRotation(rotation, annotation);
    const targetWidth = annotation.rectangle[2] - annotation.rectangle[0];
    const targetHeight = annotation.rectangle[3] - annotation.rectangle[1];
    if (!(targetWidth > 0) || !(targetHeight > 0)) {
      throw new PdfError("invalid-object", "A Widget /Rect is empty and cannot receive an appearance.", {
        pageIndex: annotation.pageIndex,
        details: { annotationIndex: annotation.annotationIndex, feature: "appearance-synthesis" }
      });
    }
    // PDF real numbers do not permit exponent notation. Keep generated operands in
    // the fixed-point range used by pdfNumber() instead of emitting invalid syntax
    // for adversarially large widget rectangles.
    if (targetWidth >= 1e20 || targetHeight >= 1e20) {
      throw new PdfError("resource-limit", "A Widget /Rect exceeds the synthesized appearance coordinate limit.", {
        pageIndex: annotation.pageIndex,
        details: {
          annotationIndex: annotation.annotationIndex,
          feature: "appearance-synthesis",
          reason: "appearance-bounds-range"
        }
      });
    }
    if (normalizedRotation === 0) {
      return freezeGeometry(targetWidth, targetHeight, [1, 0, 0, 1, 0, 0]);
    }
    if (normalizedRotation === 90) {
      return freezeGeometry(targetHeight, targetWidth, [0, 1, -1, 0, targetWidth, 0]);
    }
    if (normalizedRotation === 180) {
      return freezeGeometry(targetWidth, targetHeight, [-1, 0, 0, -1, targetWidth, targetHeight]);
    }
    return freezeGeometry(targetHeight, targetWidth, [0, -1, 1, 0, 0, targetHeight]);
  }

  private async readAppearanceCharacteristics(
    annotation: NativePdfAnnotationAppearance,
    signal?: AbortSignal
  ): Promise<AppearanceCharacteristics> {
    const dictionary = await resolveOptionalDictionary(
      this.document,
      annotation.dictionary.get("MK"),
      signal,
      "Widget /MK"
    );
    if (!dictionary) {
      return {
        rotation: 0,
        borderColor: null,
        backgroundColor: null,
        caption: null,
        hasIconSemantics: false
      };
    }
    const rotation = normalizeRotation(
      await optionalInteger(this.document, dictionary, "R", 0, signal, "Widget /MK"),
      annotation
    );
    const borderColor = await optionalColor(this.document, dictionary, "BC", signal, "Widget /MK");
    const backgroundColor = await optionalColor(this.document, dictionary, "BG", signal, "Widget /MK");
    const captionValue = await this.document.resolveValue(dictionary.get("CA"), signal);
    if (captionValue !== undefined && captionValue !== null && !isPdfString(captionValue)) {
      throw new PdfError("invalid-object", "Widget /MK /CA is not a string.", {
        pageIndex: annotation.pageIndex,
        details: { annotationIndex: annotation.annotationIndex, feature: "appearance-synthesis" }
      });
    }
    const textPosition = await optionalInteger(this.document, dictionary, "TP", 0, signal, "Widget /MK");
    if (textPosition < 0 || textPosition > 6) {
      throw new PdfError("invalid-object", "Widget /MK /TP must be from 0 through 6.", {
        pageIndex: annotation.pageIndex,
        details: { annotationIndex: annotation.annotationIndex, feature: "appearance-synthesis" }
      });
    }
    return {
      rotation,
      borderColor,
      backgroundColor,
      caption: captionValue ? decodePdfTextString(captionValue, annotation) : null,
      hasIconSemantics:
        textPosition !== 0 ||
        dictionary.has("I") || dictionary.has("RI") || dictionary.has("IX") || dictionary.has("IF")
    };
  }

  private async readLinkColor(
    annotation: NativePdfAnnotationAppearance,
    signal?: AbortSignal
  ): Promise<AppearanceColor | null> {
    const raw = await this.document.resolveValue(annotation.dictionary.get("C"), signal);
    // Annotation colour has no explicit ISO default. Black is the interoperable
    // default used by existing processors when a Link has a painting border.
    if (raw === undefined || raw === null) return DEFAULT_COLOR;
    if (!Array.isArray(raw) || ![0, 1, 3, 4].includes(raw.length)) {
      throw new PdfError(
        "invalid-object",
        "Link annotation /C is not a transparent, DeviceGray, RGB, or CMYK color array.",
        {
          pageIndex: annotation.pageIndex,
          details: { annotationIndex: annotation.annotationIndex, feature: "appearance-synthesis" }
        }
      );
    }
    if (raw.length === 0) return null;
    const components: number[] = [];
    for (const item of raw) {
      const component = await this.document.resolveValue(item, signal);
      if (
        typeof component !== "number" || !Number.isFinite(component) ||
        component < 0 || component > 1
      ) {
        throw new PdfError("invalid-object", "Link annotation /C contains an invalid component.", {
          pageIndex: annotation.pageIndex,
          details: { annotationIndex: annotation.annotationIndex, feature: "appearance-synthesis" }
        });
      }
      components.push(component);
    }
    return Object.freeze({ components: Object.freeze(components) });
  }

  private async readLinkBorderStyle(
    annotation: NativePdfAnnotationAppearance,
    signal?: AbortSignal
  ): Promise<LinkBorderStyle> {
    const rawStyle = annotation.dictionary.get("BS");
    if (rawStyle !== undefined && rawStyle !== null) {
      const dictionary = await this.document.resolveDictionary(rawStyle, signal);
      const type = await this.document.resolveValue(dictionary.get("Type"), signal);
      if (type !== undefined && type !== null && !isPdfName(type, "Border")) {
        throw invalidBorder(annotation, "Link /BS has an invalid /Type.");
      }
      const width = await optionalFiniteNumber(this.document, dictionary, "W", 1, signal, "Link /BS");
      if (width < 0) throw invalidBorder(annotation, "Link /BS /W cannot be negative.");
      if (width === 0) {
        return Object.freeze({
          width,
          style: "solid",
          dash: Object.freeze([]),
          horizontalRadius: 0,
          verticalRadius: 0
        });
      }
      const rawName = await this.document.resolveValue(dictionary.get("S"), signal);
      if (rawName !== undefined && rawName !== null && !isPdfName(rawName)) {
        throw invalidBorder(annotation, "Link /BS /S is not a name.");
      }
      const name = rawName?.value ?? "S";
      if (name === "B" || name === "I") {
        throw synthesisError(annotation, "Beveled and inset Link borders are not safely synthesizable.", {
          reason: "appearance-border-style-unsupported",
          borderStyle: name
        });
      }
      if (name !== "S" && name !== "D" && name !== "U") {
        throw synthesisError(annotation, `Link border style /${name} is unsupported.`, {
          reason: "appearance-border-style-unsupported",
          borderStyle: name
        });
      }
      const dash = name === "D"
        ? await readDashArray(this.document, dictionary.get("D"), [3], signal, annotation, true)
        : Object.freeze([]);
      return Object.freeze({
        width,
        style: name === "D" ? "dashed" : name === "U" ? "underline" : "solid",
        dash,
        horizontalRadius: 0,
        verticalRadius: 0
      });
    }

    const rawBorder = await this.document.resolveValue(annotation.dictionary.get("Border"), signal);
    if (rawBorder === undefined || rawBorder === null) {
      return Object.freeze({
        width: 1,
        style: "solid",
        dash: Object.freeze([]),
        horizontalRadius: 0,
        verticalRadius: 0
      });
    }
    if (!Array.isArray(rawBorder) || (rawBorder.length !== 3 && rawBorder.length !== 4)) {
      throw invalidBorder(annotation, "Link /Border is not a three- or four-element array.");
    }
    const values: PdfValue[] = [];
    for (let index = 0; index < 3; index += 1) {
      values.push((await this.document.resolveValue(rawBorder[index], signal)) ?? null);
    }
    for (let index = 0; index < 3; index += 1) {
      if (typeof values[index] !== "number" || !Number.isFinite(values[index] as number)) {
        throw invalidBorder(annotation, "Link /Border contains an invalid number.");
      }
    }
    const horizontalRadius = values[0] as number;
    const verticalRadius = values[1] as number;
    const width = values[2] as number;
    if (horizontalRadius < 0 || verticalRadius < 0) {
      throw invalidBorder(annotation, "Link /Border corner radii cannot be negative.");
    }
    if (width < 0) throw invalidBorder(annotation, "Link /Border width cannot be negative.");
    if (width === 0) {
      return Object.freeze({
        width,
        style: "solid",
        dash: Object.freeze([]),
        horizontalRadius,
        verticalRadius
      });
    }
    const dash = rawBorder.length === 4
      ? await readDashArray(this.document, rawBorder[3], [], signal, annotation, true)
      : Object.freeze([]);
    return Object.freeze({
      width,
      style: dash.length > 0 ? "dashed" : "solid",
      dash,
      horizontalRadius,
      verticalRadius
    });
  }

  private async readBorderStyle(
    annotation: NativePdfAnnotationAppearance,
    signal?: AbortSignal
  ): Promise<BorderStyle> {
    const rawStyle = annotation.dictionary.get("BS");
    if (rawStyle !== undefined && rawStyle !== null) {
      const dictionary = await this.document.resolveDictionary(rawStyle, signal);
      const width = await optionalFiniteNumber(this.document, dictionary, "W", 1, signal, "Widget /BS");
      if (width < 0) throw invalidBorder(annotation, "Widget /BS /W cannot be negative.");
      const rawName = await this.document.resolveValue(dictionary.get("S"), signal);
      if (rawName !== undefined && rawName !== null && !isPdfName(rawName)) {
        throw invalidBorder(annotation, "Widget /BS /S is not a name.");
      }
      const name = rawName?.value ?? "S";
      if (name === "B" || name === "I") {
        throw synthesisError(annotation, "Beveled and inset border lighting is not safely synthesizable.", {
          reason: "appearance-border-style-unsupported",
          borderStyle: name
        });
      }
      if (name !== "S" && name !== "D" && name !== "U") {
        throw synthesisError(annotation, `Border style /${name} is unsupported.`, {
          reason: "appearance-border-style-unsupported",
          borderStyle: name
        });
      }
      const dash = name === "D"
        ? await readDashArray(this.document, dictionary.get("D"), [3], signal, annotation)
        : [];
      return Object.freeze({
        width,
        style: name === "D" ? "dashed" : name === "U" ? "underline" : "solid",
        dash
      });
    }

    const rawBorder = await this.document.resolveValue(annotation.dictionary.get("Border"), signal);
    if (rawBorder === undefined || rawBorder === null) {
      return Object.freeze({ width: 1, style: "solid", dash: Object.freeze([]) });
    }
    if (!Array.isArray(rawBorder) || (rawBorder.length !== 3 && rawBorder.length !== 4)) {
      throw invalidBorder(annotation, "Widget /Border is not a three- or four-element array.");
    }
    const values: PdfValue[] = [];
    for (const value of rawBorder) values.push((await this.document.resolveValue(value, signal)) ?? null);
    for (let index = 0; index < 3; index += 1) {
      if (typeof values[index] !== "number" || !Number.isFinite(values[index] as number)) {
        throw invalidBorder(annotation, "Widget /Border contains an invalid number.");
      }
    }
    const horizontalRadius = values[0] as number;
    const verticalRadius = values[1] as number;
    const width = values[2] as number;
    if (horizontalRadius !== 0 || verticalRadius !== 0) {
      throw synthesisError(annotation, "Rounded Widget /Border radii are unsupported.", {
        reason: "appearance-border-radius-unsupported"
      });
    }
    if (width < 0) throw invalidBorder(annotation, "Widget /Border width cannot be negative.");
    const dash = rawBorder.length === 4
      ? await readDashArray(this.document, values[3], [], signal, annotation)
      : [];
    return Object.freeze({
      width,
      style: dash.length > 0 ? "dashed" : "solid",
      dash
    });
  }

  private async requireMissingNormalAppearance(
    annotation: NativePdfAnnotationAppearance,
    signal?: AbortSignal
  ): Promise<void> {
    const raw = annotation.dictionary.get("AP");
    if (raw === undefined || raw === null) return;
    const resolved = await this.document.resolveValue(raw, signal);
    if (!isPdfDictionary(resolved)) {
      throw new PdfError("invalid-object", "Annotation /AP is not an appearance dictionary.", {
        pageIndex: annotation.pageIndex,
        details: { annotationIndex: annotation.annotationIndex, feature: "appearance-synthesis" }
      });
    }
    if (resolved.get("N") !== undefined && resolved.get("N") !== null) {
      throw synthesisError(annotation, "A normal appearance already exists and must not be overwritten.", {
        reason: "appearance-normal-present"
      });
    }
  }
}

/**
 * Narrow integration hook for the Form graph. Source appearances retain their
 * existing registry path; only its explicit missing-appearance result invokes
 * deterministic synthesis. Callers can use `getDecodedFormContent()` to
 * distinguish the synthetic Form when preparing a definition.
 */
export async function resolveNativePdfAnnotationAppearanceWithSynthesis(
  registry: NativePdfFormAppearanceRegistry,
  synthesizer: NativePdfAppearanceSynthesizer,
  annotation: NativePdfAnnotationAppearance,
  signal?: AbortSignal
): Promise<NativePdfResolvedAnnotationAppearance | null> {
  try {
    return await registry.resolveAnnotationAppearance(annotation, signal);
  } catch (error) {
    if (
      !(error instanceof PdfError) ||
      error.code !== "unsupported-content" ||
      error.details?.reason !== "appearance-synthesis-not-implemented" ||
      (annotation.subtype !== "Link" && (annotation.subtype !== "Widget" || !annotation.widget))
    ) {
      throw error;
    }
    return await synthesizer.synthesize(annotation, signal);
  }
}

function appendRectangularBackgroundAndBorder(
  lines: string[],
  width: number,
  height: number,
  mk: AppearanceCharacteristics,
  border: BorderStyle
): void {
  lines.push("q");
  if (mk.backgroundColor) {
    lines.push(fillColorOperator(mk.backgroundColor));
    lines.push(`0 0 ${pdfNumber(width)} ${pdfNumber(height)} re f`);
  }
  if (border.width > 0 && mk.borderColor) {
    lines.push(strokeColorOperator(mk.borderColor));
    lines.push(`${pdfNumber(border.width)} w`);
    if (border.style === "dashed") lines.push(`[${border.dash.map(pdfNumber).join(" ")}] 0 d`);
    const inset = border.width / 2;
    if (border.style === "underline") {
      lines.push(`${pdfNumber(inset)} ${pdfNumber(inset)} m ${pdfNumber(width - inset)} ${pdfNumber(inset)} l S`);
    } else {
      lines.push(
        `${pdfNumber(inset)} ${pdfNumber(inset)} ${pdfNumber(width - border.width)} ` +
        `${pdfNumber(height - border.width)} re S`
      );
    }
  }
  lines.push("Q");
}

function appendRadioBackgroundAndBorder(
  lines: string[],
  width: number,
  height: number,
  mk: AppearanceCharacteristics,
  border: BorderStyle
): void {
  const cx = width / 2;
  const cy = height / 2;
  const borderInset = border.width / 2;
  const rx = Math.max(0, width / 2 - borderInset);
  const ry = Math.max(0, height / 2 - borderInset);
  lines.push("q");
  if (mk.backgroundColor) {
    lines.push(fillColorOperator(mk.backgroundColor));
    lines.push(`${ellipsePath(cx, cy, width / 2, height / 2)} f`);
  }
  if (border.width > 0 && mk.borderColor) {
    lines.push(strokeColorOperator(mk.borderColor), `${pdfNumber(border.width)} w`);
    if (border.style === "dashed") lines.push(`[${border.dash.map(pdfNumber).join(" ")}] 0 d`);
    if (border.style === "underline") {
      lines.push(`${pdfNumber(borderInset)} ${pdfNumber(borderInset)} m ${pdfNumber(width - borderInset)} ${pdfNumber(borderInset)} l S`);
    } else if (rx > 0 && ry > 0) {
      lines.push(`${ellipsePath(cx, cy, rx, ry)} S`);
    }
  }
  lines.push("Q");
}

function appendRadioMark(
  lines: string[],
  width: number,
  height: number,
  color: AppearanceColor,
  border: BorderStyle
): void {
  const radiusX = Math.max(0, (width - border.width * 2) * 0.25);
  const radiusY = Math.max(0, (height - border.width * 2) * 0.25);
  if (!(radiusX > 0) || !(radiusY > 0)) return;
  lines.push("q", fillColorOperator(color));
  lines.push(`${ellipsePath(width / 2, height / 2, radiusX, radiusY)} f`, "Q");
}

function appendCheckMark(
  lines: string[],
  width: number,
  height: number,
  caption: string | null,
  color: AppearanceColor,
  border: BorderStyle,
  annotation: NativePdfAnnotationAppearance
): void {
  const style = caption ?? "4";
  if (!["4", "8", "l", "u", "n"].includes(style)) {
    throw synthesisError(annotation, `Checkbox mark caption ${JSON.stringify(style)} is unsupported.`, {
      reason: "appearance-checkbox-mark-unsupported"
    });
  }
  const inset = Math.max(border.width + 1, Math.min(width, height) * 0.18);
  const left = inset;
  const bottom = inset;
  const right = width - inset;
  const top = height - inset;
  if (!(right > left) || !(top > bottom)) return;
  lines.push("q");
  if (style === "4" || style === "8") {
    lines.push(strokeColorOperator(color), `${pdfNumber(Math.max(1, Math.min(width, height) * 0.1))} w`);
    if (style === "4") {
      lines.push(
        `${pdfNumber(left)} ${pdfNumber(bottom + (top - bottom) * 0.45)} m ` +
        `${pdfNumber(left + (right - left) * 0.35)} ${pdfNumber(bottom)} l ` +
        `${pdfNumber(right)} ${pdfNumber(top)} l S`
      );
    } else {
      lines.push(
        `${pdfNumber(left)} ${pdfNumber(bottom)} m ${pdfNumber(right)} ${pdfNumber(top)} l S`,
        `${pdfNumber(left)} ${pdfNumber(top)} m ${pdfNumber(right)} ${pdfNumber(bottom)} l S`
      );
    }
  } else {
    lines.push(fillColorOperator(color));
    if (style === "l") {
      lines.push(`${ellipsePath(width / 2, height / 2, (right - left) / 2, (top - bottom) / 2)} f`);
    } else if (style === "u") {
      lines.push(
        `${pdfNumber(width / 2)} ${pdfNumber(top)} m ${pdfNumber(right)} ${pdfNumber(height / 2)} l ` +
        `${pdfNumber(width / 2)} ${pdfNumber(bottom)} l ${pdfNumber(left)} ${pdfNumber(height / 2)} l h f`
      );
    } else {
      lines.push(`${pdfNumber(left)} ${pdfNumber(bottom)} ${pdfNumber(right - left)} ${pdfNumber(top - bottom)} re f`);
    }
  }
  lines.push("Q");
}

function appendTextLayout(
  output: string[],
  layout: TextLayout,
  font: NativePdfFont,
  da: DefaultAppearance,
  quadding: 0 | 1 | 2,
  innerX: number,
  innerY: number,
  innerWidth: number,
  innerHeight: number
): void {
  const fontName = da.fontResourceName!;
  const ascent = font.descriptor.ascent / 1000 * layout.fontSize;
  const descent = font.descriptor.descent / 1000 * layout.fontSize;
  const firstBaseline = layout.lines.length === 1
    ? innerY + (innerHeight - (ascent - descent)) / 2 - descent
    : innerY + innerHeight - ascent;
  output.push("q");
  output.push(`${pdfNumber(innerX)} ${pdfNumber(innerY)} ${pdfNumber(innerWidth)} ${pdfNumber(innerHeight)} re W n`);
  output.push("BT", `/${encodePdfName(fontName)} ${pdfNumber(layout.fontSize)} Tf`, fillColorOperator(da.color));
  for (let index = 0; index < layout.lines.length; index += 1) {
    const line = layout.lines[index];
    const lineWidth = line.width / 1000 * layout.fontSize;
    const x = quadding === 1
      ? innerX + (innerWidth - lineWidth) / 2
      : quadding === 2
        ? innerX + innerWidth - lineWidth
        : innerX;
    const y = firstBaseline - index * layout.leading;
    output.push(`1 0 0 1 ${pdfNumber(x)} ${pdfNumber(y)} Tm <${hex(line.bytes)}> Tj`);
  }
  output.push("ET", "Q");
}

function appendCombText(
  output: string[],
  glyphs: readonly EncodedGlyph[],
  font: NativePdfFont,
  da: DefaultAppearance,
  quadding: 0 | 1 | 2,
  maxLength: number,
  innerX: number,
  innerY: number,
  innerWidth: number,
  innerHeight: number,
  maxAutoFontSize: number
): void {
  const cellWidth = innerWidth / maxLength;
  const widestGlyph = glyphs.reduce((width, glyph) => Math.max(width, glyph.width), 0);
  const emHeight = Math.max(1e-6, (font.descriptor.ascent - font.descriptor.descent) / 1000);
  const automaticSize = Math.min(
    maxAutoFontSize,
    innerHeight / emHeight,
    widestGlyph > 0 ? cellWidth * 1000 / widestGlyph : maxAutoFontSize
  );
  const fontSize = da.fontSize > 0
    ? da.fontSize
    : Math.max(0.25, Math.floor(automaticSize * 1000) / 1000);
  const ascent = font.descriptor.ascent / 1000 * fontSize;
  const descent = font.descriptor.descent / 1000 * fontSize;
  const baseline = innerY + (innerHeight - (ascent - descent)) / 2 - descent;
  const firstCell = quadding === 1
    ? Math.floor((maxLength - glyphs.length) / 2)
    : quadding === 2
      ? maxLength - glyphs.length
      : 0;
  output.push("q");
  output.push(`${pdfNumber(innerX)} ${pdfNumber(innerY)} ${pdfNumber(innerWidth)} ${pdfNumber(innerHeight)} re W n`);
  output.push("BT", `/${encodePdfName(da.fontResourceName!)} ${pdfNumber(fontSize)} Tf`, fillColorOperator(da.color));
  for (let index = 0; index < glyphs.length; index += 1) {
    const glyph = glyphs[index];
    const glyphWidth = glyph.width / 1000 * fontSize;
    const x = innerX + (firstCell + index) * cellWidth + (cellWidth - glyphWidth) / 2;
    output.push(`1 0 0 1 ${pdfNumber(x)} ${pdfNumber(baseline)} Tm <${hex(glyph.bytes)}> Tj`);
  }
  output.push("ET", "Q");
}

function chooseListBoxFontSize(
  options: readonly EncodedLine[],
  font: NativePdfFont,
  requestedSize: number,
  width: number,
  height: number,
  maxAutoFontSize: number
): number {
  if (requestedSize > 0) return requestedSize;
  const emHeight = Math.max(1e-6, (font.descriptor.ascent - font.descriptor.descent) / 1000);
  const maximumWidth = options.reduce((largest, option) => Math.max(largest, option.width), 0);
  const widthLimit = maximumWidth > 0 ? width * 1000 / maximumWidth : maxAutoFontSize;
  const selected = Math.min(maxAutoFontSize, 12, height / emHeight, widthLimit);
  return Math.max(0.25, Math.floor(selected * 1000) / 1000);
}

function appendChoiceList(
  output: string[],
  options: readonly EncodedLine[],
  selectedIndices: ReadonlySet<number>,
  topIndex: number,
  font: NativePdfFont,
  da: DefaultAppearance,
  fontSize: number,
  quadding: 0 | 1 | 2,
  innerX: number,
  innerY: number,
  innerWidth: number,
  innerHeight: number
): void {
  const leading = fontSize * 1.2;
  const ascent = font.descriptor.ascent / 1000 * fontSize;
  const visibleCount = Math.max(1, Math.ceil(innerHeight / leading));
  const limit = Math.min(options.length, topIndex + visibleCount);
  output.push("q");
  output.push(`${pdfNumber(innerX)} ${pdfNumber(innerY)} ${pdfNumber(innerWidth)} ${pdfNumber(innerHeight)} re W n`);
  for (let index = topIndex; index < limit; index += 1) {
    const row = index - topIndex;
    const rowTop = innerY + innerHeight - row * leading;
    const rowBottom = rowTop - leading;
    const selected = selectedIndices.has(index);
    if (selected) {
      output.push("0.153 0.376 0.616 rg");
      output.push(`${pdfNumber(innerX)} ${pdfNumber(rowBottom)} ${pdfNumber(innerWidth)} ${pdfNumber(leading)} re f`);
    }
    const option = options[index];
    const lineWidth = option.width / 1000 * fontSize;
    const x = quadding === 1
      ? innerX + (innerWidth - lineWidth) / 2
      : quadding === 2
        ? innerX + innerWidth - lineWidth
        : innerX;
    output.push(
      "BT",
      `/${encodePdfName(da.fontResourceName!)} ${pdfNumber(fontSize)} Tf`,
      selected ? "1 g" : fillColorOperator(da.color),
      `1 0 0 1 ${pdfNumber(x)} ${pdfNumber(rowTop - ascent)} Tm <${hex(option.bytes)}> Tj`,
      "ET"
    );
  }
  output.push("Q");
}

function decodeChoiceOptions(
  options: readonly NativePdfChoiceOption[],
  annotation: NativePdfAnnotationAppearance
): readonly DecodedChoiceOption[] {
  return Object.freeze(options.map((option) => Object.freeze({
    exportValue: normalizeFieldText(decodePdfTextString(option.exportValue, annotation), annotation),
    displayValue: normalizeFieldText(decodePdfTextString(option.displayValue, annotation), annotation)
  })));
}

async function decodeChoiceValues(
  document: NativePdfDocument,
  value: PdfValue | undefined,
  annotation: NativePdfAnnotationAppearance,
  signal?: AbortSignal
): Promise<readonly string[]> {
  if (value === undefined || value === null) return Object.freeze([]);
  const rawValues = Array.isArray(value) ? value : [value];
  const values: string[] = [];
  for (let index = 0; index < rawValues.length; index += 1) {
    if ((index & 0x3ff) === 0) throwIfAborted(signal);
    const resolved = await document.resolveValue(rawValues[index], signal);
    if (!isPdfString(resolved)) {
      throw new PdfError("invalid-object", "A choice field /V entry is not a string.", {
        pageIndex: annotation.pageIndex,
        details: {
          annotationIndex: annotation.annotationIndex,
          feature: "appearance-synthesis",
          reason: "appearance-choice-value"
        }
      });
    }
    values.push(normalizeFieldText(decodePdfTextString(resolved, annotation), annotation));
  }
  return Object.freeze(values);
}

function resolveChoiceSelection(
  options: readonly DecodedChoiceOption[],
  values: readonly string[],
  explicitIndices: readonly number[] | undefined,
  editable: boolean,
  annotation: NativePdfAnnotationAppearance
): ResolvedChoiceSelection {
  if (explicitIndices) {
    const displayValues = explicitIndices.map((index) => options[index]?.displayValue ?? "");
    const exportValues = explicitIndices.map((index) => options[index]?.exportValue ?? "");
    if (
      values.length > 0 &&
      (values.length !== exportValues.length || values.some((value, index) => value !== exportValues[index]))
    ) {
      throw new PdfError("invalid-object", "Choice field /V and /I select different options.", {
        pageIndex: annotation.pageIndex,
        details: {
          annotationIndex: annotation.annotationIndex,
          feature: "appearance-synthesis",
          reason: "appearance-choice-value-index-mismatch"
        }
      });
    }
    return Object.freeze({
      indices: new Set(explicitIndices),
      displayValues: Object.freeze(displayValues)
    });
  }

  const indices = new Set<number>();
  const displayValues: string[] = [];
  for (const value of values) {
    const index = options.findIndex((option) => option.exportValue === value);
    if (index < 0) {
      if (!editable) {
        throw new PdfError("invalid-object", "A non-editable choice field /V is absent from /Opt.", {
          pageIndex: annotation.pageIndex,
          details: {
            annotationIndex: annotation.annotationIndex,
            feature: "appearance-synthesis",
            reason: "appearance-choice-value-not-option"
          }
        });
      }
      displayValues.push(value);
      continue;
    }
    indices.add(index);
    displayValues.push(options[index].displayValue);
  }
  return Object.freeze({ indices, displayValues: Object.freeze(displayValues) });
}

function layoutText(
  paragraphs: readonly (readonly EncodedGlyph[])[],
  font: NativePdfFont,
  requestedSize: number,
  width: number,
  height: number,
  multiline: boolean,
  maxAutoFontSize: number,
  annotation: NativePdfAnnotationAppearance
): TextLayout {
  const make = (fontSize: number): TextLayout => {
    const maximumWidthUnits = width * 1000 / fontSize;
    const lines = multiline
      ? paragraphs.flatMap((paragraph) => wrapGlyphs(paragraph, maximumWidthUnits))
      : [makeEncodedLine(paragraphs.flat())];
    return Object.freeze({ fontSize, lines: Object.freeze(lines), leading: fontSize * 1.2 });
  };
  const fits = (layout: TextLayout): boolean => {
    const ascent = font.descriptor.ascent / 1000 * layout.fontSize;
    const descent = font.descriptor.descent / 1000 * layout.fontSize;
    const totalHeight = ascent - descent + (layout.lines.length - 1) * layout.leading;
    return totalHeight <= height + 1e-7 && layout.lines.every((line) =>
      line.width / 1000 * layout.fontSize <= width + 1e-7
    );
  };
  if (requestedSize > 0) {
    const layout = make(requestedSize);
    if (!fits(layout)) {
      throw synthesisError(annotation, "Field text does not fit its static appearance at the declared font size.", {
        reason: "appearance-text-overflow",
        fontSize: requestedSize
      });
    }
    return layout;
  }
  let low = 0.25;
  let high = maxAutoFontSize;
  if (!fits(make(low))) {
    throw synthesisError(annotation, "Field text cannot fit within its appearance bounds.", {
      reason: "appearance-text-overflow"
    });
  }
  for (let iteration = 0; iteration < 20; iteration += 1) {
    const middle = (low + high) / 2;
    if (fits(make(middle))) low = middle;
    else high = middle;
  }
  const selected = Math.floor(low * 1000) / 1000;
  return make(Math.max(0.25, selected));
}

function wrapGlyphs(glyphs: readonly EncodedGlyph[], maximumWidth: number): EncodedLine[] {
  if (glyphs.length === 0) return [makeEncodedLine([])];
  const lines: EncodedLine[] = [];
  let start = 0;
  while (start < glyphs.length) {
    while (start < glyphs.length && glyphs[start].unicode === " ") start += 1;
    if (start >= glyphs.length) break;
    let width = 0;
    let end = start;
    let lastSpace = -1;
    while (end < glyphs.length) {
      const nextWidth = width + glyphs[end].width;
      if (end > start && nextWidth > maximumWidth) break;
      width = nextWidth;
      if (glyphs[end].unicode === " ") lastSpace = end;
      end += 1;
      if (end === start + 1 && width > maximumWidth) break;
    }
    let lineEnd = end;
    if (end < glyphs.length && lastSpace >= start) lineEnd = lastSpace;
    while (lineEnd > start && glyphs[lineEnd - 1].unicode === " ") lineEnd -= 1;
    if (lineEnd === start) lineEnd = Math.min(start + 1, glyphs.length);
    lines.push(makeEncodedLine(glyphs.slice(start, lineEnd)));
    start = end < glyphs.length && lastSpace >= lineEnd ? lastSpace + 1 : lineEnd;
  }
  return lines.length > 0 ? lines : [makeEncodedLine([])];
}

async function encodeTextParagraphs(
  font: NativePdfFont,
  text: string,
  multiline: boolean,
  annotation: NativePdfAnnotationAppearance
): Promise<readonly (readonly EncodedGlyph[])[]> {
  const paragraphs = multiline ? text.split("\n") : [text.replace(/\n/g, " ")];
  const targets = new Set<string>();
  for (const paragraph of paragraphs) for (const character of paragraph) targets.add(character);
  const mapping = buildFontEncoding(font, targets, annotation);
  return Object.freeze(paragraphs.map((paragraph) => Object.freeze([...paragraph].map((unicode) => {
    const glyph = mapping.get(unicode);
    if (!glyph) {
      throw synthesisFontError(annotation, `Appearance font cannot encode ${JSON.stringify(unicode)}.`, {
        reason: "appearance-font-encoding",
        codePoint: unicode.codePointAt(0) ?? -1
      });
    }
    return glyph;
  }))));
}

function buildFontEncoding(
  font: NativePdfFont,
  targets: ReadonlySet<string>,
  annotation: NativePdfAnnotationAppearance
): ReadonlyMap<string, EncodedGlyph> {
  const result = new Map<string, EncodedGlyph>();
  const capture = (bytes: Uint8Array, expectedLength: number): void => {
    let mapped;
    try {
      mapped = font.decode(bytes);
    } catch {
      return;
    }
    const unicode = mapped.unicode;
    if (
      mapped.codeByteLength !== expectedLength || !unicode || !targets.has(unicode) ||
      result.has(unicode) || !Number.isFinite(mapped.width)
    ) {
      return;
    }
    result.set(unicode, Object.freeze({ bytes, width: mapped.width, unicode }));
  };
  for (let code = 0; code <= 0xff && result.size < targets.size; code += 1) {
    capture(Uint8Array.of(code), 1);
  }
  if (font.subtype === "Type0") {
    for (let code = 0; code <= 0xffff && result.size < targets.size; code += 1) {
      capture(Uint8Array.of(code >>> 8, code & 0xff), 2);
    }
  }
  for (const target of targets) {
    if (!result.has(target)) {
      throw synthesisFontError(annotation, `Appearance font cannot encode ${JSON.stringify(target)}.`, {
        reason: "appearance-font-encoding",
        codePoint: target.codePointAt(0) ?? -1
      });
    }
  }
  return result;
}

function makeEncodedLine(glyphs: readonly EncodedGlyph[]): EncodedLine {
  const length = glyphs.reduce((sum, glyph) => sum + glyph.bytes.length, 0);
  const bytes = new Uint8Array(length);
  let offset = 0;
  let width = 0;
  for (const glyph of glyphs) {
    bytes.set(glyph.bytes, offset);
    offset += glyph.bytes.length;
    width += glyph.width;
  }
  return Object.freeze({ glyphs: Object.freeze([...glyphs]), bytes, width });
}

function parseDefaultAppearance(bytes: Uint8Array, annotation: NativePdfAnnotationAppearance): DefaultAppearance {
  const scanner = new DefaultAppearanceScanner(bytes, annotation);
  let fontResourceName: string | null = null;
  let fontSize = 0;
  let color = DEFAULT_COLOR;
  const operands: Array<number | PdfName> = [];
  while (true) {
    const token = scanner.next();
    if (token === null) break;
    if (typeof token === "number" || (typeof token === "object" && isPdfName(token))) {
      operands.push(token);
      continue;
    }
    if (token === "Tf") {
      if (operands.length !== 2 || !isPdfName(operands[0]) || typeof operands[1] !== "number" || operands[1] < 0) {
        throw invalidDefaultAppearance(annotation, "Default appearance Tf operands are invalid.");
      }
      fontResourceName = operands[0].value;
      fontSize = operands[1];
    } else if (token === "g" || token === "rg" || token === "k") {
      const count = token === "g" ? 1 : token === "rg" ? 3 : 4;
      if (operands.length !== count || operands.some((value) => typeof value !== "number")) {
        throw invalidDefaultAppearance(annotation, `Default appearance ${token} operands are invalid.`);
      }
      color = appearanceColor(operands as number[], annotation, "default appearance color");
    } else {
      throw synthesisError(annotation, `Default appearance operator ${token} is unsupported.`, {
        reason: "appearance-da-operator-unsupported",
        operator: token
      });
    }
    operands.length = 0;
  }
  if (operands.length !== 0) throw invalidDefaultAppearance(annotation, "Default appearance has trailing operands.");
  return Object.freeze({ fontResourceName, fontSize, color });
}

class DefaultAppearanceScanner {
  private readonly bytes: Uint8Array;
  private readonly annotation: NativePdfAnnotationAppearance;
  private offset = 0;

  constructor(bytes: Uint8Array, annotation: NativePdfAnnotationAppearance) {
    this.bytes = bytes;
    this.annotation = annotation;
  }

  next(): number | PdfName | string | null {
    this.skipSpaceAndComments();
    if (this.offset >= this.bytes.length) return null;
    const first = this.bytes[this.offset];
    if (first === 0x2f) return this.readName();
    if (first === 0x2b || first === 0x2d || first === 0x2e || isDigit(first)) return this.readNumber();
    if (isDelimiter(first)) {
      throw invalidDefaultAppearance(this.annotation, "Default appearance contains a composite object.");
    }
    const start = this.offset;
    while (this.offset < this.bytes.length && !isWhite(this.bytes[this.offset]) && !isDelimiter(this.bytes[this.offset])) {
      this.offset += 1;
    }
    return ascii(this.bytes.subarray(start, this.offset));
  }

  private skipSpaceAndComments(): void {
    while (this.offset < this.bytes.length) {
      if (isWhite(this.bytes[this.offset])) {
        this.offset += 1;
        continue;
      }
      if (this.bytes[this.offset] !== 0x25) return;
      while (this.offset < this.bytes.length && this.bytes[this.offset] !== 0x0a && this.bytes[this.offset] !== 0x0d) {
        this.offset += 1;
      }
    }
  }

  private readName(): PdfName {
    this.offset += 1;
    let value = "";
    while (this.offset < this.bytes.length && !isWhite(this.bytes[this.offset]) && !isDelimiter(this.bytes[this.offset])) {
      const byte = this.bytes[this.offset++];
      if (byte === 0x23) {
        if (this.offset + 1 >= this.bytes.length) {
          throw invalidDefaultAppearance(this.annotation, "Default appearance contains an invalid name escape.");
        }
        const high = hexValue(this.bytes[this.offset++]);
        const low = hexValue(this.bytes[this.offset++]);
        if (high < 0 || low < 0) {
          throw invalidDefaultAppearance(this.annotation, "Default appearance contains an invalid name escape.");
        }
        value += String.fromCharCode((high << 4) | low);
      } else {
        value += String.fromCharCode(byte);
      }
    }
    if (value.length === 0) throw invalidDefaultAppearance(this.annotation, "Default appearance has an empty name.");
    return pdfName(value);
  }

  private readNumber(): number {
    const start = this.offset;
    if (this.bytes[this.offset] === 0x2b || this.bytes[this.offset] === 0x2d) this.offset += 1;
    let digits = 0;
    while (this.offset < this.bytes.length && isDigit(this.bytes[this.offset])) {
      digits += 1;
      this.offset += 1;
    }
    if (this.bytes[this.offset] === 0x2e) {
      this.offset += 1;
      while (this.offset < this.bytes.length && isDigit(this.bytes[this.offset])) {
        digits += 1;
        this.offset += 1;
      }
    }
    if (digits === 0) throw invalidDefaultAppearance(this.annotation, "Default appearance contains an invalid number.");
    const value = Number(ascii(this.bytes.subarray(start, this.offset)));
    if (!Number.isFinite(value)) throw invalidDefaultAppearance(this.annotation, "Default appearance number is not finite.");
    return value;
  }
}

function buttonState(annotation: NativePdfAnnotationAppearance, radio: boolean): string {
  const explicit = annotation.appearanceState;
  if (explicit) return explicit;
  const value = annotation.widget?.value;
  if (value === undefined || value === null) return "Off";
  if (!isPdfName(value)) {
    throw new PdfError("invalid-object", "A button field /V is not a name.", {
      pageIndex: annotation.pageIndex,
      details: { annotationIndex: annotation.annotationIndex, feature: "appearance-synthesis" }
    });
  }
  if (radio && value.value !== "Off") {
    throw synthesisError(annotation, "A radio widget without /AS has an ambiguous selected state.", {
      reason: "appearance-radio-state-ambiguous",
      fieldValue: value.value
    });
  }
  return value.value;
}

async function resolveOptionalDictionary(
  document: NativePdfDocument,
  value: PdfValue | undefined,
  signal: AbortSignal | undefined,
  label: string
): Promise<PdfDictionary | null> {
  const resolved = await document.resolveValue(value, signal);
  if (resolved === undefined || resolved === null) return null;
  if (!isPdfDictionary(resolved)) throw new PdfError("invalid-object", `${label} is not a dictionary.`);
  return resolved;
}

async function optionalColor(
  document: NativePdfDocument,
  dictionary: PdfDictionary,
  key: string,
  signal: AbortSignal | undefined,
  label: string
): Promise<AppearanceColor | null> {
  const raw = await document.resolveValue(dictionary.get(key), signal);
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw) || ![1, 3, 4].includes(raw.length)) {
    throw new PdfError("invalid-object", `${label} /${key} is not a DeviceGray, RGB, or CMYK color array.`);
  }
  const components: number[] = [];
  for (const item of raw) {
    const resolved = await document.resolveValue(item, signal);
    if (typeof resolved !== "number" || !Number.isFinite(resolved)) {
      throw new PdfError("invalid-object", `${label} /${key} contains an invalid component.`);
    }
    components.push(resolved);
  }
  return appearanceColor(components, null, `${label} /${key}`);
}

function appearanceColor(
  components: readonly number[],
  annotation: NativePdfAnnotationAppearance | null,
  label: string
): AppearanceColor {
  if (![1, 3, 4].includes(components.length) || components.some((value) => value < 0 || value > 1)) {
    if (annotation) throw invalidDefaultAppearance(annotation, `${label} components must be from 0 through 1.`);
    throw new PdfError("invalid-object", `${label} components must be from 0 through 1.`);
  }
  return Object.freeze({ components: Object.freeze([...components]) });
}

async function optionalInteger(
  document: NativePdfDocument,
  dictionary: PdfDictionary,
  key: string,
  fallback: number,
  signal: AbortSignal | undefined,
  label: string
): Promise<number> {
  const value = await document.resolveValue(dictionary.get(key), signal);
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new PdfError("invalid-object", `${label} /${key} is not an integer.`);
  }
  return value;
}

async function optionalFiniteNumber(
  document: NativePdfDocument,
  dictionary: PdfDictionary,
  key: string,
  fallback: number,
  signal: AbortSignal | undefined,
  label: string
): Promise<number> {
  const value = await document.resolveValue(dictionary.get(key), signal);
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new PdfError("invalid-object", `${label} /${key} is not a finite number.`);
  }
  return value;
}

async function readDashArray(
  document: NativePdfDocument,
  value: PdfValue | undefined,
  fallback: readonly number[],
  signal: AbortSignal | undefined,
  annotation: NativePdfAnnotationAppearance,
  allowEmpty = false
): Promise<readonly number[]> {
  const resolved = await document.resolveValue(value, signal);
  if (resolved === undefined || resolved === null) return Object.freeze([...fallback]);
  if (!Array.isArray(resolved)) throw invalidBorder(annotation, "A border dash pattern is not an array.");
  const dash: number[] = [];
  for (const item of resolved) {
    const component = await document.resolveValue(item, signal);
    if (typeof component !== "number" || !Number.isFinite(component) || component < 0) {
      throw invalidBorder(annotation, "A border dash pattern contains an invalid length.");
    }
    dash.push(component);
  }
  if (dash.length === 0) {
    if (allowEmpty) return Object.freeze([]);
    throw invalidBorder(annotation, "A dashed border requires a nonzero dash pattern.");
  }
  if (dash.every((value) => value === 0)) {
    throw invalidBorder(annotation, "A dashed border requires a nonzero dash pattern.");
  }
  return Object.freeze(dash);
}

function normalizeRotation(value: number, annotation: NativePdfAnnotationAppearance): 0 | 90 | 180 | 270 {
  const normalized = ((value % 360) + 360) % 360;
  if (normalized !== 0 && normalized !== 90 && normalized !== 180 && normalized !== 270) {
    throw synthesisError(annotation, "Widget /MK /R is not a multiple of 90 degrees.", {
      reason: "appearance-rotation-unsupported",
      rotation: value
    });
  }
  return normalized;
}

function freezeGeometry(
  width: number,
  height: number,
  matrix: NativePdfMatrix
): LogicalAppearanceGeometry {
  return Object.freeze({
    width,
    height,
    bbox: Object.freeze([0, 0, width, height]) as NativePdfRectangle,
    matrix: Object.freeze([...matrix]) as NativePdfMatrix
  });
}

function appearancePadding(border: BorderStyle, mk: AppearanceCharacteristics): number {
  return Math.max(1, mk.borderColor ? border.width + 1 : 1);
}

function requirePositiveInnerBox(
  annotation: NativePdfAnnotationAppearance,
  width: number,
  height: number
): void {
  if (!(width > 0) || !(height > 0)) {
    throw new PdfError("invalid-object", "Widget border leaves no area for its field content.", {
      pageIndex: annotation.pageIndex,
      details: { annotationIndex: annotation.annotationIndex, feature: "appearance-synthesis" }
    });
  }
}

function decodePdfTextString(value: PdfString, annotation: NativePdfAnnotationAppearance): string {
  const bytes = value.bytes;
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return decodeUtf16(bytes.subarray(2), false, annotation);
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return decodeUtf16(bytes.subarray(2), true, annotation);
  }
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(3));
    } catch {
      throw new PdfError("invalid-object", "A field text string contains malformed UTF-8.", {
        pageIndex: annotation.pageIndex,
        details: { annotationIndex: annotation.annotationIndex, feature: "appearance-synthesis" }
      });
    }
  }
  let output = "";
  for (const byte of bytes) output += PDF_DOC_ENCODING[byte] ?? String.fromCharCode(byte);
  return output;
}

function decodeUtf16(
  bytes: Uint8Array,
  littleEndian: boolean,
  annotation: NativePdfAnnotationAppearance
): string {
  if (bytes.length % 2 !== 0) {
    throw new PdfError("invalid-object", "A field text string contains malformed UTF-16.", {
      pageIndex: annotation.pageIndex,
      details: { annotationIndex: annotation.annotationIndex, feature: "appearance-synthesis" }
    });
  }
  let output = "";
  for (let index = 0; index < bytes.length; index += 2) {
    output += String.fromCharCode(littleEndian
      ? bytes[index] | (bytes[index + 1] << 8)
      : (bytes[index] << 8) | bytes[index + 1]);
  }
  return output;
}

function normalizeFieldText(
  value: string,
  annotation: NativePdfAnnotationAppearance
): string {
  const normalized = value.replace(/\r\n?/g, "\n").replace(/\t/g, " ");
  for (const character of normalized) {
    const code = character.codePointAt(0)!;
    if ((code < 0x20 && character !== "\n") || code === 0x7f) {
      throw new PdfError("unsupported-content", "A field value contains an unsupported control character.", {
        pageIndex: annotation.pageIndex,
        details: {
          annotationIndex: annotation.annotationIndex,
          feature: "appearance-synthesis",
          reason: "appearance-text-control",
          codePoint: code
        }
      });
    }
  }
  return normalized;
}

function fillColorOperator(color: AppearanceColor): string {
  const suffix = color.components.length === 1 ? "g" : color.components.length === 3 ? "rg" : "k";
  return `${color.components.map(pdfNumber).join(" ")} ${suffix}`;
}

function strokeColorOperator(color: AppearanceColor): string {
  const suffix = color.components.length === 1 ? "G" : color.components.length === 3 ? "RG" : "K";
  return `${color.components.map(pdfNumber).join(" ")} ${suffix}`;
}

function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  const ox = rx * KAPPA;
  const oy = ry * KAPPA;
  return [
    `${pdfNumber(cx + rx)} ${pdfNumber(cy)} m`,
    `${pdfNumber(cx + rx)} ${pdfNumber(cy + oy)} ${pdfNumber(cx + ox)} ${pdfNumber(cy + ry)} ${pdfNumber(cx)} ${pdfNumber(cy + ry)} c`,
    `${pdfNumber(cx - ox)} ${pdfNumber(cy + ry)} ${pdfNumber(cx - rx)} ${pdfNumber(cy + oy)} ${pdfNumber(cx - rx)} ${pdfNumber(cy)} c`,
    `${pdfNumber(cx - rx)} ${pdfNumber(cy - oy)} ${pdfNumber(cx - ox)} ${pdfNumber(cy - ry)} ${pdfNumber(cx)} ${pdfNumber(cy - ry)} c`,
    `${pdfNumber(cx + ox)} ${pdfNumber(cy - ry)} ${pdfNumber(cx + rx)} ${pdfNumber(cy - oy)} ${pdfNumber(cx + rx)} ${pdfNumber(cy)} c h`
  ].join(" ");
}

function roundedRectanglePath(
  x: number,
  y: number,
  width: number,
  height: number,
  radiusX: number,
  radiusY: number
): string {
  const left = x;
  const bottom = y;
  const right = x + width;
  const top = y + height;
  const rx = Math.max(0, Math.min(radiusX, width / 2));
  const ry = Math.max(0, Math.min(radiusY, height / 2));
  const ox = rx * KAPPA;
  const oy = ry * KAPPA;
  return [
    `${pdfNumber(left + rx)} ${pdfNumber(bottom)} m`,
    `${pdfNumber(right - rx)} ${pdfNumber(bottom)} l`,
    `${pdfNumber(right - rx + ox)} ${pdfNumber(bottom)} ${pdfNumber(right)} ${pdfNumber(bottom + ry - oy)} ${pdfNumber(right)} ${pdfNumber(bottom + ry)} c`,
    `${pdfNumber(right)} ${pdfNumber(top - ry)} l`,
    `${pdfNumber(right)} ${pdfNumber(top - ry + oy)} ${pdfNumber(right - rx + ox)} ${pdfNumber(top)} ${pdfNumber(right - rx)} ${pdfNumber(top)} c`,
    `${pdfNumber(left + rx)} ${pdfNumber(top)} l`,
    `${pdfNumber(left + rx - ox)} ${pdfNumber(top)} ${pdfNumber(left)} ${pdfNumber(top - ry + oy)} ${pdfNumber(left)} ${pdfNumber(top - ry)} c`,
    `${pdfNumber(left)} ${pdfNumber(bottom + ry)} l`,
    `${pdfNumber(left)} ${pdfNumber(bottom + ry - oy)} ${pdfNumber(left + rx - ox)} ${pdfNumber(bottom)} ${pdfNumber(left + rx)} ${pdfNumber(bottom)} c h`
  ].join(" ");
}

function encodeContent(lines: readonly string[]): Uint8Array {
  return TEXT_ENCODER.encode(lines.join("\n"));
}

function pdfNumber(value: number): string {
  if (!Number.isFinite(value)) throw new RangeError("A synthesized PDF number is not finite.");
  if (Object.is(value, -0) || Math.abs(value) < 5e-9) return "0";
  if (Number.isSafeInteger(value)) return String(value);
  return value.toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
}

function pdfName(value: string): PdfName {
  return { kind: "name", value };
}

function encodePdfName(value: string): string {
  let output = "";
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code > 0xff) throw new RangeError("A PDF resource name contains a non-byte character.");
    if (code <= 0x20 || code >= 0x7f || isDelimiter(code) || code === 0x23) {
      output += `#${code.toString(16).toUpperCase().padStart(2, "0")}`;
    } else {
      output += character;
    }
  }
  return output;
}

function hex(bytes: Uint8Array): string {
  let output = "";
  for (const byte of bytes) output += byte.toString(16).toUpperCase().padStart(2, "0");
  return output;
}

function synthesisError(
  annotation: NativePdfAnnotationAppearance,
  message: string,
  details: Readonly<Record<string, string | number | boolean | null>>
): PdfError {
  return new PdfError("unsupported-content", message, {
    pageIndex: annotation.pageIndex,
    details: {
      annotationIndex: annotation.annotationIndex,
      feature: "appearance-synthesis",
      ...details
    }
  });
}

function synthesisFontError(
  annotation: NativePdfAnnotationAppearance,
  message: string,
  details: Readonly<Record<string, string | number | boolean | null>>
): PdfError {
  return new PdfError("unsupported-font", message, {
    pageIndex: annotation.pageIndex,
    details: {
      annotationIndex: annotation.annotationIndex,
      feature: "appearance-synthesis",
      ...details
    }
  });
}

function invalidDefaultAppearance(annotation: NativePdfAnnotationAppearance, message: string): PdfError {
  return new PdfError("invalid-object", message, {
    pageIndex: annotation.pageIndex,
    details: { annotationIndex: annotation.annotationIndex, feature: "appearance-synthesis" }
  });
}

function invalidBorder(annotation: NativePdfAnnotationAppearance, message: string): PdfError {
  return new PdfError("invalid-object", message, {
    pageIndex: annotation.pageIndex,
    details: { annotationIndex: annotation.annotationIndex, feature: "appearance-synthesis" }
  });
}

function isWhite(byte: number): boolean {
  return byte === 0 || byte === 9 || byte === 10 || byte === 12 || byte === 13 || byte === 32;
}

function isDigit(byte: number): boolean {
  return byte >= 0x30 && byte <= 0x39;
}

function isDelimiter(byte: number): boolean {
  return byte === 0x28 || byte === 0x29 || byte === 0x3c || byte === 0x3e ||
    byte === 0x5b || byte === 0x5d || byte === 0x7b || byte === 0x7d ||
    byte === 0x2f || byte === 0x25;
}

function ascii(bytes: Uint8Array): string {
  let output = "";
  for (const byte of bytes) output += String.fromCharCode(byte);
  return output;
}

function hexValue(byte: number): number {
  if (byte >= 0x30 && byte <= 0x39) return byte - 0x30;
  if (byte >= 0x41 && byte <= 0x46) return byte - 0x41 + 10;
  if (byte >= 0x61 && byte <= 0x66) return byte - 0x61 + 10;
  return -1;
}

const PDF_DOC_ENCODING: Readonly<Record<number, string>> = Object.freeze({
  0x18: "\u02d8", 0x19: "\u02c7", 0x1a: "\u02c6", 0x1b: "\u02d9",
  0x1c: "\u02dd", 0x1d: "\u02db", 0x1e: "\u02da", 0x1f: "\u02dc",
  0x80: "\u2022", 0x81: "\u2020", 0x82: "\u2021", 0x83: "\u2026",
  0x84: "\u2014", 0x85: "\u2013", 0x86: "\u0192", 0x87: "\u2044",
  0x88: "\u2039", 0x89: "\u203a", 0x8a: "\u2212", 0x8b: "\u2030",
  0x8c: "\u201e", 0x8d: "\u201c", 0x8e: "\u201d", 0x8f: "\u2018",
  0x90: "\u2019", 0x91: "\u201a", 0x92: "\u2122", 0x93: "\ufb01",
  0x94: "\ufb02", 0x95: "\u0141", 0x96: "\u0152", 0x97: "\u0160",
  0x98: "\u0178", 0x99: "\u017d", 0x9a: "\u0131", 0x9b: "\u0142",
  0x9c: "\u0153", 0x9d: "\u0161", 0x9e: "\u017e", 0xa0: "\u20ac"
});
