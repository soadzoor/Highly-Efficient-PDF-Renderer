import {
  isPdfDictionary,
  isPdfName,
  isPdfRef,
  isPdfString,
  pdfRefKey,
  type PdfDictionary,
  type PdfValue
} from "./nativeCos";
import {
  PdfError,
  type PdfDiagnostic
} from "./nativeTypes";

export const NATIVE_OPTIONAL_CONTENT_DIAGNOSTIC_CODES = Object.freeze({
  HiddenDefault: "optional-content.hidden",
  UnresolvedMetadataProperty: "marked-content.unresolved-property"
} as const);

export interface NativeOptionalContentResolver {
  readonly catalog: PdfDictionary;
  resolveValue(value: PdfValue | undefined, signal?: AbortSignal): Promise<PdfValue | undefined>;
}

export interface NativeOptionalContentLimits {
  readonly maxGroups: number;
  readonly maxMemberships: number;
  readonly maxExpressionDepth: number;
  readonly maxExpressionNodes: number;
  readonly maxExpressionOperands: number;
  readonly maxPageProperties: number;
}

export const DEFAULT_NATIVE_OPTIONAL_CONTENT_LIMITS: Readonly<NativeOptionalContentLimits> =
  Object.freeze({
    maxGroups: 100_000,
    maxMemberships: 100_000,
    maxExpressionDepth: 64,
    maxExpressionNodes: 1_000_000,
    maxExpressionOperands: 100_000,
    maxPageProperties: 100_000
  });

export interface NativeOptionalContentOptions {
  readonly signal?: AbortSignal;
  readonly limits?: Partial<NativeOptionalContentLimits>;
  readonly onDiagnostic?: (diagnostic: Readonly<PdfDiagnostic>) => void;
}

export interface NativeOptionalContentGroup {
  readonly index: number;
  readonly membershipIndex: number;
  readonly identity: string;
  readonly name: string;
  readonly defaultVisible: boolean;
}

export type NativeOptionalContentPolicy =
  | "Identity"
  | "AnyOn"
  | "AllOn"
  | "AnyOff"
  | "AllOff"
  | "VisibilityExpression";

export type NativeOptionalContentExpression =
  | {
      readonly kind: "group";
      readonly groupIndex: number;
      readonly defaultVisible: boolean;
    }
  | {
      readonly kind: "membership";
      readonly membershipIndex: number;
      readonly defaultVisible: boolean;
    }
  | {
      readonly kind: "and" | "or";
      readonly operands: readonly NativeOptionalContentExpression[];
      readonly defaultVisible: boolean;
    }
  | {
      readonly kind: "not";
      readonly operand: NativeOptionalContentExpression;
      readonly defaultVisible: boolean;
    };

export interface NativeOptionalContentMembership {
  readonly index: number;
  readonly identity: string;
  readonly kind: "ocg" | "ocmd";
  readonly policy: NativeOptionalContentPolicy;
  readonly groupIndices: readonly number[];
  readonly expression: NativeOptionalContentExpression | null;
  readonly defaultVisible: boolean;
}

export interface NativeOptionalContentPageProperty {
  readonly name: string;
  /** Resolved generic property-list dictionary, or null for tolerated non-paint metadata. */
  readonly propertyList: PdfDictionary | null;
  readonly membershipIndex: number | null;
  readonly membership: NativeOptionalContentMembership | null;
  readonly defaultVisible: boolean;
}

interface GroupDraft {
  readonly index: number;
  readonly identity: string;
  readonly name: string;
  readonly intents: readonly string[];
  readonly usage: PdfValue | undefined;
  configuredVisible: boolean;
  usedInDefaultView: boolean;
  defaultVisible: boolean;
}

interface ParseContext {
  readonly activeMemberships: ReadonlySet<string>;
  readonly activeExpressionRefs: ReadonlySet<string>;
  readonly activeExpressionObjects: ReadonlySet<object>;
  readonly expressionDepth: number;
  readonly expressionNodes: { count: number };
}

interface ParsedExpression {
  readonly expression: NativeOptionalContentExpression;
  readonly affectsVisibility: boolean;
}

function createParseContext(): ParseContext {
  return {
    activeMemberships: new Set<string>(),
    activeExpressionRefs: new Set<string>(),
    activeExpressionObjects: new Set<object>(),
    expressionDepth: 0,
    expressionNodes: { count: 0 }
  };
}

/**
 * Static default-view optional-content registry.
 *
 * It deliberately exposes no layer-toggle mutation. All returned identities,
 * membership indexes, and visibility values remain stable for its lifetime.
 */
export class NativeOptionalContentRegistry {
  private readonly resolver: NativeOptionalContentResolver;
  private readonly limits: Readonly<NativeOptionalContentLimits>;
  private readonly onDiagnostic: ((diagnostic: Readonly<PdfDiagnostic>) => void) | undefined;
  private readonly groupDrafts: GroupDraft[] = [];
  private readonly groupByIdentity = new Map<string, GroupDraft>();
  private readonly memberships: NativeOptionalContentMembership[] = [];
  private readonly membershipEffects: boolean[] = [];
  private readonly membershipByIdentity = new Map<string, Promise<NativeOptionalContentMembership>>();
  private readonly directIdentities = new WeakMap<PdfDictionary, string>();
  private readonly diagnostics: PdfDiagnostic[] = [];
  private readonly diagnosedHidden = new Set<string>();
  private readonly diagnosedUnresolvedMetadataProperties = new Set<string>();
  private nextDirectIdentity = 0;
  private initialization: Promise<this> | null = null;
  private operationTail: Promise<void> = Promise.resolve();
  private initialized = false;

  constructor(
    resolver: NativeOptionalContentResolver,
    options: Omit<NativeOptionalContentOptions, "signal"> = {}
  ) {
    this.resolver = resolver;
    this.limits = normalizeLimits(options.limits);
    this.onDiagnostic = options.onDiagnostic;
  }

  /** Parse catalog /OCProperties and its default configuration exactly once. */
  async initialize(signal?: AbortSignal): Promise<this> {
    if (this.initialized) return this;
    if (this.initialization) return await this.initialization;
    const initialization = this.initializeInternal(signal);
    this.initialization = initialization;
    return await initialization;
  }

  private async initializeInternal(signal?: AbortSignal): Promise<this> {
    signal?.throwIfAborted();
    const rawProperties = this.resolver.catalog.get("OCProperties");
    if (rawProperties === undefined || rawProperties === null) {
      this.initialized = true;
      return this;
    }
    const properties = await this.resolveDictionary(
      rawProperties,
      signal,
      "The catalog /OCProperties entry"
    );
    const rawGroups = await this.resolver.resolveValue(properties.get("OCGs"), signal);
    if (!Array.isArray(rawGroups)) {
      throw invalidOptionalContent("The catalog /OCProperties /OCGs entry is not an array.");
    }
    if (rawGroups.length > this.limits.maxGroups) {
      throw optionalContentLimit(
        `Optional-content group count ${rawGroups.length} exceeds limit ${this.limits.maxGroups}.`
      );
    }
    if (rawGroups.length > this.limits.maxMemberships) {
      throw optionalContentLimit(
        `Optional-content group memberships exceed limit ${this.limits.maxMemberships}.`
      );
    }

    for (let index = 0; index < rawGroups.length; index += 1) {
      signal?.throwIfAborted();
      const rawGroup = rawGroups[index];
      if (!isPdfRef(rawGroup)) {
        throw invalidOptionalContent(
          `The catalog /OCGs entry ${index} is not an indirect reference.`
        );
      }
      const identity = this.identityOf(rawGroup, `OCGs[${index}]`);
      if (this.groupByIdentity.has(identity)) {
        throw invalidOptionalContent(`The catalog /OCGs array repeats ${identity}.`);
      }
      const dictionary = await this.resolveDictionary(
        rawGroup,
        signal,
        `The catalog /OCGs entry ${index}`
      );
      const type = await this.resolver.resolveValue(dictionary.get("Type"), signal);
      if (!isPdfName(type, "OCG")) {
        throw invalidOptionalContent(`The catalog /OCGs entry ${index} is not an /OCG dictionary.`);
      }
      const nameValue = await this.resolver.resolveValue(dictionary.get("Name"), signal);
      if (!isPdfString(nameValue)) {
        throw invalidOptionalContent(`Optional-content group ${identity} has no string /Name.`);
      }
      const name = decodePdfTextString(nameValue.bytes);
      if (name.length === 0) {
        throw invalidOptionalContent(`Optional-content group ${identity} has an empty /Name.`);
      }
      const intents = await this.readIntentNames(
        dictionary.get("Intent"),
        `Optional-content group ${identity} /Intent`,
        ["View"],
        signal
      );
      const draft: GroupDraft = {
        index,
        identity,
        name,
        intents,
        usage: dictionary.get("Usage"),
        configuredVisible: true,
        usedInDefaultView: true,
        defaultVisible: true
      };
      this.groupDrafts.push(draft);
      this.groupByIdentity.set(identity, draft);
    }

    const defaultConfiguration = properties.get("D");
    if (defaultConfiguration === undefined || defaultConfiguration === null) {
      throw invalidOptionalContent("The catalog /OCProperties dictionary has no default /D configuration.");
    }
    await this.applyDefaultConfiguration(defaultConfiguration, signal);
    for (const group of this.groupDrafts) {
      const publicGroup = this.freezeGroup(group);
      const membership: NativeOptionalContentMembership = Object.freeze({
        index: group.index,
        identity: group.identity,
        kind: "ocg",
        policy: "Identity",
        groupIndices: Object.freeze([group.index]),
        expression: null,
        defaultVisible: group.defaultVisible
      });
      this.memberships.push(membership);
      this.membershipEffects.push(group.usedInDefaultView);
      this.membershipByIdentity.set(group.identity, Promise.resolve(membership));
      if (!publicGroup.defaultVisible) this.emitHiddenDiagnostic(membership, publicGroup.name);
    }
    this.initialized = true;
    return this;
  }

  get groupCount(): number {
    this.assertInitialized();
    return this.groupDrafts.length;
  }

  get membershipCount(): number {
    this.assertInitialized();
    return this.memberships.length;
  }

  listGroups(): readonly NativeOptionalContentGroup[] {
    this.assertInitialized();
    return Object.freeze(this.groupDrafts.map((group) => this.freezeGroup(group)));
  }

  listMemberships(): readonly NativeOptionalContentMembership[] {
    this.assertInitialized();
    return Object.freeze([...this.memberships]);
  }

  getGroup(index: number): NativeOptionalContentGroup {
    this.assertInitialized();
    const group = this.groupDrafts[index];
    if (group === undefined) throw new RangeError(`Optional-content group index ${index} is out of range.`);
    return this.freezeGroup(group);
  }

  getMembership(index: number): NativeOptionalContentMembership {
    this.assertInitialized();
    const membership = this.memberships[index];
    if (membership === undefined) {
      throw new RangeError(`Optional-content membership index ${index} is out of range.`);
    }
    return membership;
  }

  getDiagnostics(): readonly PdfDiagnostic[] {
    return Object.freeze(this.diagnostics.map((diagnostic) => Object.freeze({ ...diagnostic })));
  }

  /**
   * Resolve one direct OCG/OCMD or property-list dictionary.
   *
   * This is also the bounded resolver hook for inline BDC `/OC` dictionaries:
   * callers may pass either the inline OCG/OCMD itself or its enclosing
   * property-list dictionary. It performs the same identity, cycle, intent,
   * and expression-limit checks as resource-scoped properties.
   */
  async resolvePropertyValue(
    value: PdfValue,
    signal?: AbortSignal
  ): Promise<NativeOptionalContentMembership | null> {
    this.assertInitialized();
    return await this.enqueueOperation(
      async () => await this.resolvePropertyValueInternal(value, signal)
    );
  }

  private async resolvePropertyValueInternal(
    value: PdfValue,
    signal?: AbortSignal
  ): Promise<NativeOptionalContentMembership | null> {
    signal?.throwIfAborted();
    const resolved = await this.resolver.resolveValue(value, signal);
    if (!isPdfDictionary(resolved)) {
      throw invalidOptionalContent("An optional-content marked-content property is not a dictionary.");
    }
    const type = await this.resolver.resolveValue(resolved.get("Type"), signal);
    if (isPdfName(type, "OCG") || isPdfName(type, "OCMD")) {
      return await this.resolveMembership(value, createParseContext(), signal);
    }
    if (!resolved.has("OC")) return null;
    const membershipValue = resolved.get("OC");
    if (membershipValue === undefined || membershipValue === null) {
      throw invalidOptionalContent("A marked-content property list has an empty /OC entry.");
    }
    return await this.resolveMembership(membershipValue, createParseContext(), signal);
  }

  /**
   * Membership parsing appends to stable index-addressed stores. Serialize the
   * public lazy-resolution entry points so concurrent page compilations cannot
   * assign different indexes to the same first-use sequence.
   */
  private async enqueueOperation<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.operationTail;
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.operationTail = previous.then(() => current, () => current);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
    }
  }

  /**
   * Resolve only page /Properties names actually used by BDC or DP operators.
   * Results preserve first-use order and reject duplicate requested names.
   */
  async resolvePageProperties(
    resourcesValue: PdfValue | undefined,
    usedPropertyNames: Iterable<string>,
    signal?: AbortSignal,
    /**
     * Exact names used by an /OC-tagged BDC or DP operator. When omitted, the
     * historical strict classifier behavior is retained for direct callers.
     */
    optionalContentPropertyNames?: Iterable<string>
  ): Promise<readonly NativeOptionalContentPageProperty[]> {
    this.assertInitialized();
    return await this.enqueueOperation(
      async () => await this.resolvePagePropertiesInternal(
        resourcesValue,
        usedPropertyNames,
        signal,
        optionalContentPropertyNames
      )
    );
  }

  private async resolvePagePropertiesInternal(
    resourcesValue: PdfValue | undefined,
    usedPropertyNames: Iterable<string>,
    signal?: AbortSignal,
    optionalContentPropertyNames?: Iterable<string>
  ): Promise<readonly NativeOptionalContentPageProperty[]> {
    signal?.throwIfAborted();
    const names: string[] = [];
    const seen = new Set<string>();
    for (const name of usedPropertyNames) {
      signal?.throwIfAborted();
      if (names.length >= this.limits.maxPageProperties) {
        throw optionalContentLimit(
          `Used page property count exceeds limit ${this.limits.maxPageProperties}.`
        );
      }
      if (typeof name !== "string" || name.length === 0) {
        throw invalidOptionalContent("A used page /Properties name is empty or invalid.");
      }
      if (seen.has(name)) {
        throw invalidOptionalContent(`Page /Properties name /${name} was requested more than once.`);
      }
      seen.add(name);
      names.push(name);
    }
    if (names.length === 0) return Object.freeze([]);
    const classifyEveryProperty = optionalContentPropertyNames === undefined;
    const optionalNames = new Set<string>();
    if (optionalContentPropertyNames !== undefined) {
      for (const name of optionalContentPropertyNames) {
        signal?.throwIfAborted();
        if (typeof name !== "string" || name.length === 0 || !seen.has(name)) {
          throw invalidOptionalContent(
            "An optional-content property name was not present in the used page property set."
          );
        }
        if (optionalNames.has(name)) {
          throw invalidOptionalContent(`Optional-content property /${name} was requested more than once.`);
        }
        optionalNames.add(name);
      }
    }
    const hasStrictProperty = classifyEveryProperty || optionalNames.size > 0;
    if (resourcesValue === undefined || resourcesValue === null) {
      if (hasStrictProperty) {
        throw invalidOptionalContent("A content operator uses /Properties but the page has no resources.");
      }
      return this.unresolvedMetadataProperties(names, "resources-missing");
    }
    const resources = await this.resolveDictionary(resourcesValue, signal, "The page /Resources entry");
    const propertiesValue = resources.get("Properties");
    if (propertiesValue === undefined || propertiesValue === null) {
      if (hasStrictProperty) {
        throw invalidOptionalContent("A content operator uses /Properties but the resource dictionary has none.");
      }
      return this.unresolvedMetadataProperties(names, "properties-missing");
    }
    let properties: PdfDictionary;
    try {
      properties = await this.resolveDictionary(
        propertiesValue,
        signal,
        "The page /Resources /Properties entry"
      );
    } catch (error) {
      if (hasStrictProperty || !isIgnorableMetadataResolutionError(error)) throw error;
      return this.unresolvedMetadataProperties(names, "properties-unresolvable");
    }
    const output: NativeOptionalContentPageProperty[] = [];
    for (const name of names) {
      signal?.throwIfAborted();
      const optionalPaint = optionalNames.has(name);
      const strict = classifyEveryProperty || optionalPaint;
      if (!properties.has(name)) {
        if (strict) {
          throw invalidOptionalContent(`The used page property /${name} is missing from /Resources /Properties.`);
        }
        output.push(this.unresolvedMetadataProperty(name, "property-missing"));
        continue;
      }
      const value = properties.get(name);
      if (value === undefined || value === null) {
        if (strict) throw invalidOptionalContent(`The used page property /${name} is empty.`);
        output.push(this.unresolvedMetadataProperty(name, "property-empty"));
        continue;
      }
      let propertyList: PdfValue | undefined;
      try {
        propertyList = await this.resolver.resolveValue(value, signal);
      } catch (error) {
        if (strict || !isIgnorableMetadataResolutionError(error)) throw error;
        output.push(this.unresolvedMetadataProperty(name, "property-unresolvable"));
        continue;
      }
      if (!isPdfDictionary(propertyList)) {
        if (strict) {
          throw invalidOptionalContent(`The used page property /${name} is not a dictionary.`);
        }
        output.push(this.unresolvedMetadataProperty(name, "property-not-dictionary"));
        continue;
      }
      const membership = classifyEveryProperty || optionalPaint
        ? await this.resolvePropertyValueInternal(value, signal)
        : null;
      if (optionalPaint && membership === null) {
        throw invalidOptionalContent(
          `The /OC page property /${name} does not resolve to an OCG or OCMD membership.`
        );
      }
      output.push(Object.freeze({
        name,
        propertyList,
        membershipIndex: membership?.index ?? null,
        membership,
        defaultVisible: membership?.defaultVisible ?? true
      }));
    }
    return Object.freeze(output);
  }

  private unresolvedMetadataProperties(
    names: readonly string[],
    reason: string
  ): readonly NativeOptionalContentPageProperty[] {
    return Object.freeze(names.map((name) => this.unresolvedMetadataProperty(name, reason)));
  }

  private unresolvedMetadataProperty(
    name: string,
    reason: string
  ): NativeOptionalContentPageProperty {
    const identity = `${name}:${reason}`;
    if (!this.diagnosedUnresolvedMetadataProperties.has(identity)) {
      this.diagnosedUnresolvedMetadataProperties.add(identity);
      const diagnostic: PdfDiagnostic = {
        code: NATIVE_OPTIONAL_CONTENT_DIAGNOSTIC_CODES.UnresolvedMetadataProperty,
        severity: "warning",
        message: `Non-optional marked-content property /${name} could not be resolved; its content remains visible.`,
        details: { propertyName: name, reason, defaultVisible: true }
      };
      this.diagnostics.push(diagnostic);
      this.onDiagnostic?.(Object.freeze({ ...diagnostic }));
    }
    return Object.freeze({
      name,
      propertyList: null,
      membershipIndex: null,
      membership: null,
      defaultVisible: true
    });
  }

  private async applyDefaultConfiguration(
    rawConfiguration: PdfValue | undefined,
    signal?: AbortSignal
  ): Promise<void> {
    if (rawConfiguration === undefined || rawConfiguration === null) {
      throw invalidOptionalContent("The default optional-content configuration /D is empty.");
    }
    const configuration = await this.resolveDictionary(
      rawConfiguration,
      signal,
      "The default optional-content configuration /D"
    );
    const configurationIntents = await this.readIntentNames(
      configuration.get("Intent"),
      "The default optional-content configuration /Intent",
      ["View"],
      signal
    );
    const allIntents = configurationIntents.includes("All");
    const intentSet = new Set(configurationIntents);
    for (const group of this.groupDrafts) {
      group.usedInDefaultView = allIntents
        ? group.intents.length > 0
        : group.intents.some((intent) => intentSet.has(intent));
    }

    const baseValue = await this.resolver.resolveValue(configuration.get("BaseState"), signal);
    const baseState = baseValue === undefined || baseValue === null
      ? "ON"
      : isPdfName(baseValue) && (
          baseValue.value === "ON" ||
          baseValue.value === "OFF" ||
          baseValue.value === "Unchanged"
        )
        ? baseValue.value
        : null;
    if (baseState === null) {
      throw unsupportedOptionalContent("The default optional-content /BaseState is unsupported.");
    }
    // At document open there is no previous mutable layer state; /Unchanged
    // therefore retains the PDF initial state, which is ON for every OCG.
    const baseVisible = baseState !== "OFF";
    for (const group of this.groupDrafts) group.configuredVisible = baseVisible;

    const onGroups = await this.readConfigurationGroupSet(configuration.get("ON"), "/D /ON", signal);
    const offGroups = await this.readConfigurationGroupSet(configuration.get("OFF"), "/D /OFF", signal);
    for (const identity of onGroups) {
      if (offGroups.has(identity)) {
        throw invalidOptionalContent(`Optional-content group ${identity} appears in both /D /ON and /D /OFF.`);
      }
      this.groupByIdentity.get(identity)!.configuredVisible = true;
    }
    for (const identity of offGroups) this.groupByIdentity.get(identity)!.configuredVisible = false;

    await this.applyViewUsageApplications(configuration.get("AS"), signal);
    for (const group of this.groupDrafts) {
      // A group whose intent is not selected by the current configuration has
      // no effect on visibility, which is represented as visible in the static
      // default view rather than as a mutable hidden layer.
      group.defaultVisible = !group.usedInDefaultView || group.configuredVisible;
    }
  }

  private async applyViewUsageApplications(
    rawApplications: PdfValue | undefined,
    signal?: AbortSignal
  ): Promise<void> {
    if (rawApplications === undefined || rawApplications === null) return;
    const applications = await this.resolver.resolveValue(rawApplications, signal);
    if (!Array.isArray(applications)) {
      throw invalidOptionalContent("The default optional-content /AS entry is not an array.");
    }
    if (applications.length > this.limits.maxMemberships) {
      throw optionalContentLimit("The default optional-content /AS entry exceeds its application limit.");
    }

    const recommendations = new Map<number, boolean>();
    for (let applicationIndex = 0; applicationIndex < applications.length; applicationIndex += 1) {
      signal?.throwIfAborted();
      const application = await this.resolveDictionary(
        applications[applicationIndex],
        signal,
        `The default optional-content /AS entry ${applicationIndex}`
      );
      const event = await this.resolver.resolveValue(application.get("Event"), signal);
      if (!isPdfName(event)) {
        throw invalidOptionalContent(
          `The default optional-content /AS entry ${applicationIndex} has no name /Event.`
        );
      }
      if (event.value === "Print" || event.value === "Export") {
        // Non-View applications do not participate in the static default View.
        // Keep their OCG/category payloads lazy because they may depend on
        // print/export context that this engine intentionally does not expose.
        continue;
      }
      if (event.value !== "View") {
        throw unsupportedOptionalContent(
          `Optional-content usage event /${event.value} is unsupported in the static default View.`
        );
      }

      const groupIdentities = await this.readConfigurationGroupSet(
        application.get("OCGs"),
        `/D /AS[${applicationIndex}] /OCGs`,
        signal
      );
      const activeGroups = [...groupIdentities]
        .map((identity) => this.groupByIdentity.get(identity)!)
        .filter((group) => group.usedInDefaultView);
      if (activeGroups.length === 0) continue;

      if (application.get("Category") === undefined || application.get("Category") === null) {
        throw unsupportedOptionalContent(
          "Default-view optional-content usage applications require a supported /Category array."
        );
      }
      const categories = await this.readRequiredNameArray(
        application.get("Category"),
        `/D /AS[${applicationIndex}] /Category`,
        signal
      );
      if (categories.length === 0) continue;
      const unsupportedCategory = categories.find((category) => category !== "View");
      if (unsupportedCategory !== undefined) {
        throw unsupportedOptionalContent(
          `Optional-content View usage category /${unsupportedCategory} requires external viewer context.`
        );
      }

      for (const group of activeGroups) {
        signal?.throwIfAborted();
        const recommendation = await this.readViewUsageRecommendation(group, signal);
        if (recommendation === null) continue;
        const previous = recommendations.get(group.index);
        recommendations.set(
          group.index,
          previous === undefined ? recommendation : previous && recommendation
        );
      }
    }
    for (const [groupIndex, recommendation] of recommendations) {
      this.groupDrafts[groupIndex].configuredVisible = recommendation;
    }
  }

  private async readViewUsageRecommendation(
    group: GroupDraft,
    signal?: AbortSignal
  ): Promise<boolean | null> {
    if (group.usage === undefined || group.usage === null) return null;
    const usage = await this.resolveDictionary(
      group.usage,
      signal,
      `Optional-content group ${group.identity} /Usage`
    );
    const rawView = usage.get("View");
    if (rawView === undefined || rawView === null) return null;
    const view = await this.resolveDictionary(
      rawView,
      signal,
      `Optional-content group ${group.identity} /Usage /View`
    );
    const state = await this.resolver.resolveValue(view.get("ViewState"), signal);
    if (!isPdfName(state) || (state.value !== "ON" && state.value !== "OFF")) {
      throw invalidOptionalContent(
        `Optional-content group ${group.identity} has an invalid /Usage /View /ViewState.`
      );
    }
    return state.value === "ON";
  }

  private async readIntentNames(
    rawValue: PdfValue | undefined,
    label: string,
    fallback: readonly string[],
    signal?: AbortSignal
  ): Promise<readonly string[]> {
    const resolved = await this.resolver.resolveValue(rawValue, signal);
    if (resolved === undefined || resolved === null) return Object.freeze([...fallback]);
    const values = Array.isArray(resolved) ? resolved : [rawValue!];
    if (values.length > this.limits.maxGroups) {
      throw optionalContentLimit(`${label} exceeds the optional-content intent limit.`);
    }
    const names: string[] = [];
    const seen = new Set<string>();
    for (let index = 0; index < values.length; index += 1) {
      signal?.throwIfAborted();
      const value = await this.resolver.resolveValue(values[index], signal);
      if (!isPdfName(value)) throw invalidOptionalContent(`${label} contains a non-name value.`);
      if (seen.has(value.value)) throw invalidOptionalContent(`${label} repeats /${value.value}.`);
      seen.add(value.value);
      names.push(value.value);
    }
    return Object.freeze(names);
  }

  private async readRequiredNameArray(
    rawValue: PdfValue | undefined,
    label: string,
    signal?: AbortSignal
  ): Promise<readonly string[]> {
    const resolved = await this.resolver.resolveValue(rawValue, signal);
    if (!Array.isArray(resolved)) {
      throw invalidOptionalContent(`The optional-content ${label} entry is not an array.`);
    }
    if (resolved.length > this.limits.maxExpressionOperands) {
      throw optionalContentLimit(`${label} exceeds the optional-content operand limit.`);
    }
    const output: string[] = [];
    const seen = new Set<string>();
    for (const rawName of resolved) {
      signal?.throwIfAborted();
      const value = await this.resolver.resolveValue(rawName, signal);
      if (!isPdfName(value)) {
        throw invalidOptionalContent(`The optional-content ${label} entry contains a non-name value.`);
      }
      if (seen.has(value.value)) {
        throw invalidOptionalContent(`The optional-content ${label} entry repeats /${value.value}.`);
      }
      seen.add(value.value);
      output.push(value.value);
    }
    return Object.freeze(output);
  }

  private async readConfigurationGroupSet(
    rawValue: PdfValue | undefined,
    label: string,
    signal?: AbortSignal
  ): Promise<ReadonlySet<string>> {
    if (rawValue === undefined || rawValue === null) return new Set<string>();
    const resolved = await this.resolver.resolveValue(rawValue, signal);
    if (!Array.isArray(resolved)) {
      throw invalidOptionalContent(`The optional-content ${label} entry is not an array.`);
    }
    if (resolved.length > this.limits.maxGroups) {
      throw optionalContentLimit(`${label} exceeds the optional-content group limit.`);
    }
    const identities = new Set<string>();
    for (let index = 0; index < resolved.length; index += 1) {
      signal?.throwIfAborted();
      const rawGroup = resolved[index];
      const identity = this.identityOf(rawGroup, `${label}[${index}]`);
      if (!this.groupByIdentity.has(identity)) {
        throw unsupportedOptionalContent(
          `The optional-content ${label} entry references ${identity}, which is absent from /OCGs.`
        );
      }
      if (identities.has(identity)) {
        throw invalidOptionalContent(`The optional-content ${label} entry repeats ${identity}.`);
      }
      identities.add(identity);
    }
    return identities;
  }

  private async resolveMembership(
    rawValue: PdfValue,
    context: ParseContext,
    signal?: AbortSignal
  ): Promise<NativeOptionalContentMembership> {
    signal?.throwIfAborted();
    const identity = this.identityOf(rawValue, "optional-content membership");
    const group = this.groupByIdentity.get(identity);
    if (group !== undefined) return this.memberships[group.index];
    if (context.activeMemberships.has(identity)) {
      throw invalidOptionalContent(`Optional-content membership cycle detected at ${identity}.`);
    }
    const cached = this.membershipByIdentity.get(identity);
    if (cached !== undefined) return await cached;
    if (this.memberships.length >= this.limits.maxMemberships) {
      throw optionalContentLimit(
        `Optional-content membership count exceeds limit ${this.limits.maxMemberships}.`
      );
    }
    const nextActive = new Set(context.activeMemberships);
    nextActive.add(identity);
    const promise = this.parseMembership(
      rawValue,
      identity,
      {
        activeMemberships: nextActive,
        activeExpressionRefs: context.activeExpressionRefs,
        activeExpressionObjects: context.activeExpressionObjects,
        expressionDepth: context.expressionDepth,
        expressionNodes: context.expressionNodes
      },
      signal
    );
    this.membershipByIdentity.set(identity, promise);
    try {
      return await promise;
    } catch (error) {
      if (this.membershipByIdentity.get(identity) === promise) {
        this.membershipByIdentity.delete(identity);
      }
      throw error;
    }
  }

  private async parseMembership(
    rawValue: PdfValue,
    identity: string,
    context: ParseContext,
    signal?: AbortSignal
  ): Promise<NativeOptionalContentMembership> {
    const dictionary = await this.resolveDictionary(
      rawValue,
      signal,
      `Optional-content membership ${identity}`
    );
    const type = await this.resolver.resolveValue(dictionary.get("Type"), signal);
    if (isPdfName(type, "OCG")) {
      throw unsupportedOptionalContent(
        `Optional-content group ${identity} is referenced but absent from the catalog /OCGs array.`
      );
    }
    if (!isPdfName(type, "OCMD")) {
      throw invalidOptionalContent(`Optional-content membership ${identity} is not an /OCG or /OCMD.`);
    }

    const expressionValue = dictionary.get("VE");
    let expression: NativeOptionalContentExpression | null = null;
    let policy: NativeOptionalContentPolicy;
    let groupIndices: readonly number[];
    let defaultVisible: boolean;
    let affectsVisibility: boolean;
    if (expressionValue !== undefined && expressionValue !== null) {
      const resolvedExpression = await this.resolver.resolveValue(expressionValue, signal);
      if (!Array.isArray(resolvedExpression)) {
        throw invalidOptionalContent(
          `Optional-content membership ${identity} has a /VE entry that is not an expression array.`
        );
      }
      const parsedExpression = await this.parseExpression(
        expressionValue,
        context,
        signal
      );
      expression = parsedExpression.expression;
      policy = "VisibilityExpression";
      groupIndices = Object.freeze(collectExpressionGroups(expression, this.memberships));
      defaultVisible = expression.defaultVisible;
      affectsVisibility = parsedExpression.affectsVisibility;
    } else {
      const groups = await this.readMembershipGroups(dictionary.get("OCGs"), identity, signal);
      const policyValue = await this.resolver.resolveValue(dictionary.get("P"), signal);
      policy = policyValue === undefined || policyValue === null
        ? "AnyOn"
        : isPdfName(policyValue) && isPolicy(policyValue.value)
          ? policyValue.value
          : (() => {
              throw unsupportedOptionalContent(
                `Optional-content membership ${identity} has an unsupported /P policy.`
              );
            })();
      groupIndices = Object.freeze(groups.map((group) => group.index));
      const activeGroups = groups.filter((group) => group.usedInDefaultView);
      affectsVisibility = activeGroups.length > 0;
      defaultVisible = !affectsVisibility || evaluatePolicy(
        policy,
        activeGroups.map((group) => group.defaultVisible)
      );
    }

    // Nested /VE memberships may have consumed the remaining capacity since
    // this membership began parsing, so enforce the ceiling again at publish.
    if (this.memberships.length >= this.limits.maxMemberships) {
      throw optionalContentLimit(
        `Optional-content membership count exceeds limit ${this.limits.maxMemberships}.`
      );
    }
    const membership: NativeOptionalContentMembership = Object.freeze({
      index: this.memberships.length,
      identity,
      kind: "ocmd",
      policy,
      groupIndices,
      expression,
      defaultVisible
    });
    this.memberships.push(membership);
    this.membershipEffects.push(affectsVisibility);
    if (!membership.defaultVisible) this.emitHiddenDiagnostic(membership);
    return membership;
  }

  private async readMembershipGroups(
    rawValue: PdfValue | undefined,
    membershipIdentity: string,
    signal?: AbortSignal
  ): Promise<readonly GroupDraft[]> {
    if (rawValue === undefined || rawValue === null) return Object.freeze([]);
    const resolved = await this.resolver.resolveValue(rawValue, signal);
    const rawGroups = Array.isArray(resolved) ? resolved : [rawValue];
    if (rawGroups.length > this.limits.maxGroups) {
      throw optionalContentLimit(
        `Optional-content membership ${membershipIdentity} exceeds the group limit.`
      );
    }
    const groups: GroupDraft[] = [];
    const seen = new Set<string>();
    for (let index = 0; index < rawGroups.length; index += 1) {
      signal?.throwIfAborted();
      const rawGroup = rawGroups[index];
      const resolvedGroup = await this.resolver.resolveValue(rawGroup, signal);
      // PDF 1.7, 4.10.2 explicitly ignores null and deleted OCG entries. A
      // resolver represents a resolved deleted entry as null when it can do so;
      // an unresolved/missing indirect object remains a typed structural error.
      if (resolvedGroup === undefined || resolvedGroup === null) continue;
      if (!isPdfDictionary(resolvedGroup)) {
        throw invalidOptionalContent(
          `Optional-content membership ${membershipIdentity} has a non-dictionary /OCGs entry ${index}.`
        );
      }
      const identity = this.identityOf(rawGroup, `${membershipIdentity} /OCGs[${index}]`);
      const group = this.groupByIdentity.get(identity);
      if (group === undefined) {
        throw unsupportedOptionalContent(
          `Optional-content membership ${membershipIdentity} references ${identity}, which is absent from /OCGs.`
        );
      }
      if (seen.has(identity)) {
        throw invalidOptionalContent(
          `Optional-content membership ${membershipIdentity} repeats group ${identity}.`
        );
      }
      seen.add(identity);
      groups.push(group);
    }
    return Object.freeze(groups);
  }

  private async parseExpression(
    rawValue: PdfValue,
    context: ParseContext,
    signal?: AbortSignal
  ): Promise<ParsedExpression> {
    signal?.throwIfAborted();
    if (context.expressionDepth > this.limits.maxExpressionDepth) {
      throw optionalContentLimit(
        `Optional-content visibility expression depth exceeds limit ${this.limits.maxExpressionDepth}.`
      );
    }
    context.expressionNodes.count += 1;
    if (context.expressionNodes.count > this.limits.maxExpressionNodes) {
      throw optionalContentLimit(
        `Optional-content visibility expression nodes exceed limit ${this.limits.maxExpressionNodes}.`
      );
    }
    const resolved = await this.resolver.resolveValue(rawValue, signal);
    if (Array.isArray(resolved)) {
      const expressionRef = isPdfRef(rawValue) ? `ref:${pdfRefKey(rawValue)}` : null;
      if (expressionRef !== null && context.activeExpressionRefs.has(expressionRef)) {
        throw invalidOptionalContent(
          `Optional-content visibility-expression cycle detected at ${expressionRef}.`
        );
      }
      if (context.activeExpressionObjects.has(resolved)) {
        throw invalidOptionalContent("Optional-content visibility-expression array cycle detected.");
      }
      if (resolved.length === 0) {
        throw invalidOptionalContent("An optional-content visibility expression is empty.");
      }
      if (resolved.length - 1 > this.limits.maxExpressionOperands) {
        throw optionalContentLimit(
          `Optional-content visibility-expression operand count exceeds limit ${this.limits.maxExpressionOperands}.`
        );
      }
      const operatorValue = await this.resolver.resolveValue(resolved[0], signal);
      if (!isPdfName(operatorValue)) {
        throw invalidOptionalContent("An optional-content visibility expression has no name operator.");
      }
      const nextExpressionRefs = new Set(context.activeExpressionRefs);
      if (expressionRef !== null) nextExpressionRefs.add(expressionRef);
      const nextExpressionObjects = new Set(context.activeExpressionObjects);
      nextExpressionObjects.add(resolved);
      const childContext: ParseContext = {
        activeMemberships: context.activeMemberships,
        activeExpressionRefs: nextExpressionRefs,
        activeExpressionObjects: nextExpressionObjects,
        expressionDepth: context.expressionDepth + 1,
        expressionNodes: context.expressionNodes
      };
      if (operatorValue.value === "Not") {
        if (resolved.length !== 2) {
          throw invalidOptionalContent("A /Not visibility expression requires exactly one operand.");
        }
        const parsedOperand = await this.parseExpression(resolved[1], childContext, signal);
        return Object.freeze({
          expression: Object.freeze({
            kind: "not",
            operand: parsedOperand.expression,
            defaultVisible: parsedOperand.affectsVisibility
              ? !parsedOperand.expression.defaultVisible
              : true
          }),
          affectsVisibility: parsedOperand.affectsVisibility
        });
      }
      if (operatorValue.value !== "And" && operatorValue.value !== "Or") {
        throw unsupportedOptionalContent(
          `Visibility expression operator /${operatorValue.value} is unsupported.`
        );
      }
      if (resolved.length < 2) {
        throw invalidOptionalContent(
          `A /${operatorValue.value} visibility expression requires at least one operand.`
        );
      }
      const operands: NativeOptionalContentExpression[] = [];
      const affectingValues: boolean[] = [];
      for (let index = 1; index < resolved.length; index += 1) {
        const parsedOperand = await this.parseExpression(resolved[index], childContext, signal);
        operands.push(parsedOperand.expression);
        if (parsedOperand.affectsVisibility) {
          affectingValues.push(parsedOperand.expression.defaultVisible);
        }
      }
      const kind = operatorValue.value === "And" ? "and" : "or";
      return Object.freeze({
        expression: Object.freeze({
          kind,
          operands: Object.freeze(operands),
          defaultVisible: affectingValues.length === 0
            ? true
            : kind === "and"
              ? affectingValues.every(Boolean)
              : affectingValues.some(Boolean)
        }),
        affectsVisibility: affectingValues.length > 0
      });
    }
    if (!isPdfRef(rawValue) && !isPdfDictionary(resolved)) {
      throw invalidOptionalContent("A visibility-expression operand is not an OCG, OCMD, or expression array.");
    }
    const identity = this.identityOf(rawValue, "visibility-expression operand");
    const group = this.groupByIdentity.get(identity);
    if (group !== undefined) {
      return Object.freeze({
        expression: Object.freeze({
          kind: "group",
          groupIndex: group.index,
          defaultVisible: group.defaultVisible
        }),
        affectsVisibility: group.usedInDefaultView
      });
    }
    const membership = await this.resolveMembership(rawValue, context, signal);
    const affectsVisibility = this.membershipEffects[membership.index];
    if (affectsVisibility === undefined) {
      throw invalidOptionalContent(
        `Visibility expression references unresolved membership index ${membership.index}.`
      );
    }
    return Object.freeze({
      expression: Object.freeze({
        kind: "membership",
        membershipIndex: membership.index,
        defaultVisible: membership.defaultVisible
      }),
      affectsVisibility
    });
  }

  private async resolveDictionary(
    value: PdfValue,
    signal: AbortSignal | undefined,
    label: string
  ): Promise<PdfDictionary> {
    const resolved = await this.resolver.resolveValue(value, signal);
    if (!isPdfDictionary(resolved)) throw invalidOptionalContent(`${label} is not a dictionary.`);
    return resolved;
  }

  private identityOf(value: PdfValue, label: string): string {
    if (isPdfRef(value)) return `ref:${pdfRefKey(value)}`;
    if (isPdfDictionary(value)) {
      let identity = this.directIdentities.get(value);
      if (identity === undefined) {
        identity = `direct:${this.nextDirectIdentity++}`;
        this.directIdentities.set(value, identity);
      }
      return identity;
    }
    throw invalidOptionalContent(`${label} is not an indirect reference or dictionary.`);
  }

  private emitHiddenDiagnostic(
    membership: NativeOptionalContentMembership,
    groupName?: string
  ): void {
    if (this.diagnosedHidden.has(membership.identity)) return;
    this.diagnosedHidden.add(membership.identity);
    const diagnostic: PdfDiagnostic = Object.freeze({
      code: NATIVE_OPTIONAL_CONTENT_DIAGNOSTIC_CODES.HiddenDefault,
      severity: "info",
      message: groupName === undefined
        ? `Optional-content membership ${membership.identity} is hidden in the default view.`
        : `Optional-content group “${groupName}” is hidden in the default view.`,
      details: Object.freeze({
        membershipIndex: membership.index,
        kind: membership.kind,
        groupCount: membership.groupIndices.length
      })
    });
    this.diagnostics.push(diagnostic);
    this.onDiagnostic?.(diagnostic);
  }

  private freezeGroup(group: GroupDraft): NativeOptionalContentGroup {
    return Object.freeze({
      index: group.index,
      membershipIndex: group.index,
      identity: group.identity,
      name: group.name,
      defaultVisible: group.defaultVisible
    });
  }

  private assertInitialized(): void {
    if (!this.initialized) {
      throw new Error("NativeOptionalContentRegistry.initialize() must complete before use.");
    }
  }
}

export async function createNativeOptionalContentRegistry(
  resolver: NativeOptionalContentResolver,
  options: NativeOptionalContentOptions = {}
): Promise<NativeOptionalContentRegistry> {
  const registry = new NativeOptionalContentRegistry(resolver, options);
  return await registry.initialize(options.signal);
}

function normalizeLimits(
  overrides: Partial<NativeOptionalContentLimits> | undefined
): Readonly<NativeOptionalContentLimits> {
  const limits = { ...DEFAULT_NATIVE_OPTIONAL_CONTENT_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(`${name} must be a non-negative safe integer.`);
    }
  }
  return Object.freeze(limits);
}

function isIgnorableMetadataResolutionError(error: unknown): boolean {
  return error instanceof PdfError && (
    error.code === "invalid-object" ||
    error.code === "invalid-xref" ||
    error.code === "unexpected-eof"
  );
}

function isPolicy(value: string): value is Exclude<NativeOptionalContentPolicy, "Identity" | "VisibilityExpression"> {
  return value === "AnyOn" || value === "AllOn" || value === "AnyOff" || value === "AllOff";
}

function evaluatePolicy(
  policy: Exclude<NativeOptionalContentPolicy, "Identity" | "VisibilityExpression">,
  values: readonly boolean[]
): boolean {
  switch (policy) {
    case "AnyOn": return values.some(Boolean);
    case "AllOn": return values.every(Boolean);
    case "AnyOff": return values.some((value) => !value);
    case "AllOff": return values.every((value) => !value);
  }
}

function collectExpressionGroups(
  expression: NativeOptionalContentExpression,
  memberships: readonly NativeOptionalContentMembership[]
): number[] {
  const groups = new Set<number>();
  const visit = (node: NativeOptionalContentExpression): void => {
    if (node.kind === "group") {
      groups.add(node.groupIndex);
    } else if (node.kind === "membership") {
      const membership = memberships[node.membershipIndex];
      if (membership === undefined) {
        throw invalidOptionalContent(
          `Visibility expression references unknown membership index ${node.membershipIndex}.`
        );
      }
      membership.groupIndices.forEach((groupIndex) => groups.add(groupIndex));
    } else if (node.kind === "not") {
      visit(node.operand);
    } else {
      node.operands.forEach(visit);
    }
  };
  visit(expression);
  return [...groups].sort((left, right) => left - right);
}

function invalidOptionalContent(message: string): PdfError {
  return new PdfError("invalid-object", message);
}

function unsupportedOptionalContent(message: string): PdfError {
  return new PdfError("unsupported-content", message);
}

function optionalContentLimit(message: string): PdfError {
  return new PdfError("resource-limit", message);
}

function decodePdfTextString(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return decodeUtf16(bytes.subarray(2), false);
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return decodeUtf16(bytes.subarray(2), true);
  }
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(3));
    } catch {
      throw invalidOptionalContent("An optional-content group /Name has malformed UTF-8 bytes.");
    }
  }
  let output = "";
  for (const byte of bytes) output += PDF_DOC_ENCODING[byte] ?? String.fromCharCode(byte);
  return output;
}

function decodeUtf16(bytes: Uint8Array, littleEndian: boolean): string {
  if (bytes.length % 2 !== 0) {
    throw invalidOptionalContent("An optional-content group /Name has malformed UTF-16 bytes.");
  }
  let output = "";
  for (let index = 0; index < bytes.length; index += 2) {
    const code = littleEndian
      ? bytes[index] | (bytes[index + 1] << 8)
      : (bytes[index] << 8) | bytes[index + 1];
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 3 >= bytes.length) {
        throw invalidOptionalContent(
          "An optional-content group /Name has an unpaired UTF-16 high surrogate."
        );
      }
      const low = littleEndian
        ? bytes[index + 2] | (bytes[index + 3] << 8)
        : (bytes[index + 2] << 8) | bytes[index + 3];
      if (low < 0xdc00 || low > 0xdfff) {
        throw invalidOptionalContent(
          "An optional-content group /Name has an unpaired UTF-16 high surrogate."
        );
      }
      output += String.fromCharCode(code, low);
      index += 2;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      throw invalidOptionalContent(
        "An optional-content group /Name has an unpaired UTF-16 low surrogate."
      );
    }
    output += String.fromCharCode(code);
  }
  return output;
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
