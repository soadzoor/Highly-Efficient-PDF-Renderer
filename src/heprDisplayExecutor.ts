import {
  HEPR_PAINT_KIND,
  HEPR_PATTERN_KIND,
  type DrawRun,
  type HeprCompositeGroup,
  type HeprDisplayCommand,
  type HeprPageData,
  type HeprReusableProgram,
  type InvokeGroup,
  type InvokeProgram,
  type PdfBlendMode,
  type PdfBox,
  type PdfMatrix
} from "./heprDocumentData";
import {
  HEPR_DATA_VALIDATION_CODES,
  HeprDataValidationError,
  validateHeprPageData
} from "./heprDocumentDataValidation";

export const HEPR_DISPLAY_EXECUTION_CODES = {
  InvalidPage: "display.invalid-page",
  InvalidResource: "display.invalid-resource",
  ResourceCycle: "display.resource-cycle",
  ResourceLimit: "display.resource-limit",
  DepthLimit: "display.depth-limit",
  ExecutionLimit: "display.execution-limit",
  UnsupportedCommand: "display.unsupported-command",
  UnsupportedDrawSource: "display.unsupported-draw-source",
  UnsupportedBlendMode: "display.unsupported-blend-mode"
} as const;

export type HeprDisplayExecutionCode =
  (typeof HEPR_DISPLAY_EXECUTION_CODES)[keyof typeof HEPR_DISPLAY_EXECUTION_CODES];

/** Typed failure raised before an invalid program can reach a renderer. */
export class HeprDisplayExecutionError extends Error {
  readonly code: HeprDisplayExecutionCode;
  readonly path: string | null;

  constructor(
    code: HeprDisplayExecutionCode,
    message: string,
    options: { readonly path?: string; readonly cause?: unknown } = {}
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "HeprDisplayExecutionError";
    this.code = code;
    this.path = options.path ?? null;
  }
}

export interface HeprDisplayExecutionLimits {
  /** Root is depth zero; every invoked group/program or soft mask adds one. */
  readonly maxInvocationDepth: number;
  /** Dynamic commands, including commands reached through reusable programs. */
  readonly maxExecutedCommands: number;
  readonly maxCompositeGroupExecutions: number;
  readonly maxProgramExecutions: number;
}

export const DEFAULT_HEPR_DISPLAY_EXECUTION_LIMITS: Readonly<HeprDisplayExecutionLimits> =
  Object.freeze({
    maxInvocationDepth: 64,
    maxExecutedCommands: 10_000_000,
    maxCompositeGroupExecutions: 1_000_000,
    maxProgramExecutions: 1_000_000
  });

export type HeprClipScopeOrigin = "command" | "group" | "program-bounds";

/**
 * Persistent clip scope. Resource clips reference a complete stored clip
 * chain; `outerTransform` places that resource-local chain in page space.
 * For a glyph-backed node, a backend must union every referenced outline with
 * `outerTransform * clipTransform * glyphTransform`, then intersect its parent
 * once. The current draw/invocation command transform is deliberately absent.
 */
export type HeprExecutionClipScope =
  | {
      readonly kind: "resource";
      readonly origin: Exclude<HeprClipScopeOrigin, "program-bounds">;
      readonly clipIndex: number;
      readonly ownerKind: "group" | "program";
      readonly ownerIndex: number;
      readonly outerTransform: PdfMatrix;
      readonly parent: HeprExecutionClipScope | null;
    }
  | {
      readonly kind: "program-bounds";
      readonly origin: "program-bounds";
      readonly programIndex: number;
      readonly bounds: PdfBox;
      readonly outerTransform: PdfMatrix;
      readonly parent: HeprExecutionClipScope | null;
    };

export interface HeprExecutionIndexScope {
  readonly index: number;
  readonly parent: HeprExecutionIndexScope | null;
}

export interface HeprExecutionFrame {
  readonly kind: "group" | "program";
  readonly index: number;
  readonly executionId: number;
  readonly role: HeprCompositeGroupRole | "program";
  readonly parent: HeprExecutionFrame | null;
}

/** Fully composed state supplied to a backend callback. */
export interface HeprExecutionState {
  readonly transform: PdfMatrix;
  readonly clips: HeprExecutionClipScope | null;
  readonly optionalContent: HeprExecutionIndexScope | null;
  readonly markedContent: HeprExecutionIndexScope | null;
  readonly invocation: HeprExecutionFrame | null;
  readonly type3PaintIndex: number;
  /** Active annotation view-counter-transform requirements, inherited by descendants. */
  readonly viewTransformFlags: number;
  readonly visible: boolean;
}

export type HeprCompositeGroupRole = "root" | "invoked" | "soft-mask";

export interface HeprCompositeGroupExecution {
  readonly page: HeprPageData;
  readonly group: HeprCompositeGroup;
  readonly groupIndex: number;
  readonly executionId: number;
  readonly parentExecutionId: number | null;
  readonly role: HeprCompositeGroupRole;
  readonly depth: number;
  readonly state: HeprExecutionState;
  readonly invocationCommand: InvokeGroup | null;
  /** Execution that produced the mask consumed by this group, if any. */
  readonly softMaskExecutionId: number | null;
  readonly isolated: boolean;
  readonly knockout: boolean;
  readonly blendMode: PdfBlendMode;
  readonly alpha: number;
  readonly alphaIsShape: boolean;
  readonly softMaskGroupIndex: number;
  readonly softMaskSubtype: "Alpha" | "Luminosity" | null;
  readonly softMaskTransferFunctionIndex: number;
  readonly backdropPaintIndex: number;
  readonly blendingColorSpaceIndex: number;
  readonly clipIndex: number;
}

export interface HeprProgramExecution {
  readonly page: HeprPageData;
  readonly program: HeprReusableProgram;
  readonly programIndex: number;
  readonly executionId: number;
  readonly parentExecutionId: number;
  readonly depth: number;
  readonly state: HeprExecutionState;
  readonly invocationCommand: InvokeProgram;
  /** Flags introduced by this invocation; accumulated flags are in `state`. */
  readonly viewTransformFlags: number;
}

export interface HeprDrawRunExecution {
  readonly page: HeprPageData;
  /**
   * Pattern paints on path runs resolve through `stores.paints`: compose the
   * paint's use-time pattern transform with the pattern resource matrix, and
   * bind `patternBasePaintIndices` while executing PaintType 2 cell programs.
   * `resolveHeprPatternPaint()` performs that lookup/composition without
   * choosing a viewport-dependent tiling strategy.
   */
  readonly command: DrawRun;
  /** Monotonic callback order, including soft-mask draws. */
  readonly sequence: number;
  readonly containerKind: "group" | "program";
  readonly containerIndex: number;
  readonly containerExecutionId: number;
  readonly commandIndex: number;
  readonly commandPath: string;
  readonly depth: number;
  readonly state: HeprExecutionState;
}

export interface HeprExecutionOutcome {
  readonly status: "complete" | "aborted" | "error";
  readonly error?: unknown;
}

type MaybePromise<T> = T | PromiseLike<T>;

/**
 * Renderer-neutral callback contract shared by WebGL, WebGPU, and Three.js.
 * A backend must explicitly handle every draw run and composite boundary.
 */
export interface HeprDisplayBackend {
  drawRun(execution: HeprDrawRunExecution): MaybePromise<void>;
  beginCompositeGroup(execution: HeprCompositeGroupExecution): MaybePromise<void>;
  endCompositeGroup(
    execution: HeprCompositeGroupExecution,
    outcome: HeprExecutionOutcome
  ): MaybePromise<void>;
  beginProgram?(execution: HeprProgramExecution): MaybePromise<void>;
  endProgram?(
    execution: HeprProgramExecution,
    outcome: HeprExecutionOutcome
  ): MaybePromise<void>;
}

export interface ExecuteHeprDisplayProgramOptions {
  readonly signal?: AbortSignal;
  readonly limits?: Partial<HeprDisplayExecutionLimits>;
}

export interface HeprDisplayExecutionStats {
  readonly executedCommands: number;
  readonly drawRuns: number;
  readonly drawnItems: number;
  /** Hidden optional-content command roots; skipped descendants are not counted. */
  readonly hiddenCommands: number;
  readonly compositeGroupExecutions: number;
  readonly softMaskExecutions: number;
  readonly programExecutions: number;
  readonly maxDepth: number;
}

export type HeprResolvedPatternKind =
  | "colored-tiling"
  | "uncolored-tiling"
  | "shading";

/** Backend-ready, viewport-independent metadata for one Pattern paint. */
export interface HeprResolvedPatternPaint {
  readonly paintIndex: number;
  readonly patternIndex: number;
  readonly kind: HeprResolvedPatternKind;
  readonly useTransformIndex: number;
  readonly resourceTransformIndex: number;
  readonly useTransform: PdfMatrix;
  readonly resourceTransform: PdfMatrix;
  /** `useTransform * resourceTransform`, mapping pattern space to its owner. */
  readonly patternToOwnerTransform: PdfMatrix;
  /** PaintType 2 caller color; -1 for colored tiling and shading patterns. */
  readonly basePaintIndex: number;
  /** Reusable cell program for tiling patterns; -1 for shading patterns. */
  readonly programIndex: number;
  /** Gradient resource for shading patterns; -1 for tiling patterns. */
  readonly gradientIndex: number;
}

interface MutableStats {
  executedCommands: number;
  drawRuns: number;
  drawnItems: number;
  hiddenCommands: number;
  compositeGroupExecutions: number;
  softMaskExecutions: number;
  programExecutions: number;
  maxDepth: number;
}

interface ContainerExecution {
  readonly kind: "group" | "program";
  readonly index: number;
  readonly executionId: number;
  readonly depth: number;
  readonly path: string;
}

const IDENTITY_MATRIX: PdfMatrix = Object.freeze([1, 0, 0, 1, 0, 0]);

/** Execute one page's display program without introducing a raster fallback. */
export async function executeHeprDisplayProgram(
  page: HeprPageData,
  backend: HeprDisplayBackend,
  options: ExecuteHeprDisplayProgramOptions = {}
): Promise<HeprDisplayExecutionStats> {
  options.signal?.throwIfAborted();
  validateBackend(backend);
  validatePageForExecution(page);
  options.signal?.throwIfAborted();

  const executor = new DisplayExecutor(
    page,
    backend,
    options.signal,
    normalizeLimits(options.limits)
  );
  return await executor.execute();
}

/** Compose affine transforms using PDF's column-vector convention. */
export function multiplyHeprMatrices(outer: PdfMatrix, local: PdfMatrix): PdfMatrix {
  return [
    outer[0] * local[0] + outer[2] * local[1],
    outer[1] * local[0] + outer[3] * local[1],
    outer[0] * local[2] + outer[2] * local[3],
    outer[1] * local[2] + outer[3] * local[3],
    outer[0] * local[4] + outer[2] * local[5] + outer[4],
    outer[1] * local[4] + outer[3] * local[5] + outer[5]
  ];
}

/**
 * Resolve a paint-store entry for a renderer. Returns `null` for non-pattern
 * paints. Tiling repetition remains backend-driven because it depends on the
 * target clip and viewport, but all PDF transform and PaintType 2 binding
 * semantics are resolved here deterministically.
 */
export function resolveHeprPatternPaint(
  page: HeprPageData,
  paintIndex: number
): Readonly<HeprResolvedPatternPaint> | null {
  const paintPath = `stores.paints[${paintIndex}]`;
  assertResolverIndex(paintIndex, page.stores.paints.kinds.length, paintPath);
  if (page.stores.paints.kinds[paintIndex] !== HEPR_PAINT_KIND.Pattern) return null;

  const patternIndex = page.stores.paints.resourceIndices[paintIndex];
  assertResolverIndex(patternIndex, page.stores.patterns.kinds.length, `${paintPath}.resourceIndex`);
  const useTransformIndex = page.stores.paints.patternTransformIndices[paintIndex];
  const resourceTransformIndex = page.stores.patterns.matrixIndices[patternIndex];
  const useTransform = readResolverTransform(
    page,
    useTransformIndex,
    `${paintPath}.patternTransformIndex`
  );
  const resourceTransform = readResolverTransform(
    page,
    resourceTransformIndex,
    `stores.patterns.matrixIndices[${patternIndex}]`
  );
  const rawKind = page.stores.patterns.kinds[patternIndex];
  const kind: HeprResolvedPatternKind = rawKind === HEPR_PATTERN_KIND.ColoredTiling
    ? "colored-tiling"
    : rawKind === HEPR_PATTERN_KIND.UncoloredTiling
      ? "uncolored-tiling"
      : rawKind === HEPR_PATTERN_KIND.Shading
        ? "shading"
        : failPatternResolution(`stores.patterns.kinds[${patternIndex}]`, "unknown pattern kind");
  const basePaintIndex = page.stores.paints.patternBasePaintIndices[paintIndex];
  const programIndex = page.stores.patterns.programIndices[patternIndex];
  const gradientIndex = page.stores.patterns.gradientIndices[patternIndex];
  if (kind === "uncolored-tiling") {
    assertResolverIndex(basePaintIndex, page.stores.paints.kinds.length, `${paintPath}.basePaintIndex`);
    if (page.stores.paints.kinds[basePaintIndex] !== HEPR_PAINT_KIND.SolidColor) {
      failPatternResolution(`${paintPath}.basePaintIndex`, "PaintType 2 base is not a solid paint");
    }
  } else if (basePaintIndex !== -1) {
    failPatternResolution(`${paintPath}.basePaintIndex`, "colored pattern unexpectedly has a base paint");
  }
  if (kind === "shading") {
    assertResolverIndex(gradientIndex, page.stores.gradients.kinds.length, `${paintPath}.gradientIndex`);
    if (programIndex !== -1) {
      failPatternResolution(`${paintPath}.programIndex`, "shading pattern unexpectedly has a cell program");
    }
  } else {
    assertResolverIndex(programIndex, page.displayProgram.programs.length, `${paintPath}.programIndex`);
    if (page.displayProgram.programs[programIndex].kind !== "pattern") {
      failPatternResolution(`${paintPath}.programIndex`, "tiling pattern does not reference a Pattern program");
    }
    if (gradientIndex !== -1) {
      failPatternResolution(`${paintPath}.gradientIndex`, "tiling pattern unexpectedly has a gradient");
    }
  }
  return Object.freeze({
    paintIndex,
    patternIndex,
    kind,
    useTransformIndex,
    resourceTransformIndex,
    useTransform,
    resourceTransform,
    patternToOwnerTransform: Object.freeze(
      multiplyHeprMatrices(useTransform, resourceTransform)
    ) as PdfMatrix,
    basePaintIndex,
    programIndex,
    gradientIndex
  });
}

/** Expand a persistent outer-to-inner scope for APIs that prefer arrays. */
export function collectHeprExecutionScopes<T extends { readonly parent: T | null }>(
  innermost: T | null
): readonly T[] {
  const scopes: T[] = [];
  for (let scope = innermost; scope !== null; scope = scope.parent) scopes.push(scope);
  scopes.reverse();
  return scopes;
}

class DisplayExecutor {
  private readonly page: HeprPageData;
  private readonly backend: HeprDisplayBackend;
  private readonly signal: AbortSignal | undefined;
  private readonly limits: Readonly<HeprDisplayExecutionLimits>;
  private readonly transformCache: Array<PdfMatrix | undefined>;
  private readonly activeNodes = new Set<string>();
  private readonly stats: MutableStats = {
    executedCommands: 0,
    drawRuns: 0,
    drawnItems: 0,
    hiddenCommands: 0,
    compositeGroupExecutions: 0,
    softMaskExecutions: 0,
    programExecutions: 0,
    maxDepth: 0
  };
  private nextExecutionId = 1;
  private nextDrawSequence = 0;

  constructor(
    page: HeprPageData,
    backend: HeprDisplayBackend,
    signal: AbortSignal | undefined,
    limits: Readonly<HeprDisplayExecutionLimits>
  ) {
    this.page = page;
    this.backend = backend;
    this.signal = signal;
    this.limits = limits;
    this.transformCache = new Array(page.stores.transforms.values.length / 6);
  }

  async execute(): Promise<HeprDisplayExecutionStats> {
    const rootState: HeprExecutionState = {
      transform: IDENTITY_MATRIX,
      clips: null,
      optionalContent: null,
      markedContent: null,
      invocation: null,
      type3PaintIndex: -1,
      viewTransformFlags: 0,
      visible: true
    };
    await this.executeGroup(
      this.page.displayProgram.rootGroupIndex,
      rootState,
      "root",
      0,
      null,
      null
    );
    this.signal?.throwIfAborted();
    return Object.freeze({ ...this.stats });
  }

  private async executeGroup(
    groupIndex: number,
    incomingState: HeprExecutionState,
    role: HeprCompositeGroupRole,
    depth: number,
    parentExecutionId: number | null,
    invocationCommand: InvokeGroup | null
  ): Promise<number> {
    this.checkDepth(depth);
    this.checkGroupLimit();
    const nodeKey = `group:${groupIndex}`;
    this.enterNode(nodeKey, `displayProgram.groups[${groupIndex}]`);
    const executionId = this.nextExecutionId++;
    const group = this.page.displayProgram.groups[groupIndex];
    assertKnownBlendMode(group.blendMode, `displayProgram.groups[${groupIndex}].blendMode`);
    const groupState = this.enterGroupState(incomingState, group, groupIndex, executionId, role);
    this.stats.compositeGroupExecutions += 1;
    if (role === "soft-mask") this.stats.softMaskExecutions += 1;
    this.stats.maxDepth = Math.max(this.stats.maxDepth, depth);

    try {
      this.signal?.throwIfAborted();
      let softMaskExecutionId: number | null = null;
      if (group.softMaskGroupIndex >= 0) {
        softMaskExecutionId = await this.executeGroup(
          group.softMaskGroupIndex,
          groupState,
          "soft-mask",
          depth + 1,
          executionId,
          null
        );
      }

      const context: HeprCompositeGroupExecution = {
        page: this.page,
        group,
        groupIndex,
        executionId,
        parentExecutionId,
        role,
        depth,
        state: groupState,
        invocationCommand,
        softMaskExecutionId,
        isolated: group.isolated,
        knockout: group.knockout,
        blendMode: group.blendMode,
        alpha: group.alpha,
        alphaIsShape: group.alphaIsShape,
        softMaskGroupIndex: group.softMaskGroupIndex,
        softMaskSubtype: group.softMaskSubtype,
        softMaskTransferFunctionIndex: group.softMaskTransferFunctionIndex,
        backdropPaintIndex: group.backdropPaintIndex,
        blendingColorSpaceIndex: group.blendingColorSpaceIndex,
        clipIndex: group.clipIndex
      };

      await this.withBoundary(
        () => this.backend.beginCompositeGroup(context),
        (outcome) => this.backend.endCompositeGroup(context, outcome),
        async () => {
          await this.executeCommands(
            group.commands,
            groupState,
            {
              kind: "group",
              index: groupIndex,
              executionId,
              depth,
              path: `displayProgram.groups[${groupIndex}]`
            }
          );
        }
      );
      return executionId;
    } finally {
      this.activeNodes.delete(nodeKey);
    }
  }

  private async executeProgram(
    programIndex: number,
    incomingState: HeprExecutionState,
    command: InvokeProgram,
    depth: number,
    parentExecutionId: number
  ): Promise<void> {
    this.checkDepth(depth);
    this.checkProgramLimit();
    const nodeKey = `program:${programIndex}`;
    this.enterNode(nodeKey, `displayProgram.programs[${programIndex}]`);
    const executionId = this.nextExecutionId++;
    const program = this.page.displayProgram.programs[programIndex];
    const programState = this.enterProgramState(
      incomingState,
      program,
      programIndex,
      executionId,
      command.type3PaintIndex,
      command.viewTransformFlags
    );
    const context: HeprProgramExecution = {
      page: this.page,
      program,
      programIndex,
      executionId,
      parentExecutionId,
      depth,
      state: programState,
      invocationCommand: command,
      viewTransformFlags: command.viewTransformFlags
    };
    this.stats.programExecutions += 1;
    this.stats.maxDepth = Math.max(this.stats.maxDepth, depth);

    try {
      await this.withBoundary(
        () => this.backend.beginProgram?.(context),
        (outcome) => this.backend.endProgram?.(context, outcome),
        async () => {
          await this.executeCommands(
            program.commands,
            programState,
            {
              kind: "program",
              index: programIndex,
              executionId,
              depth,
              path: `displayProgram.programs[${programIndex}]`
            }
          );
        }
      );
    } finally {
      this.activeNodes.delete(nodeKey);
    }
  }

  private async executeCommands(
    commands: readonly HeprDisplayCommand[],
    state: HeprExecutionState,
    container: ContainerExecution
  ): Promise<void> {
    for (let commandIndex = 0; commandIndex < commands.length; commandIndex += 1) {
      this.signal?.throwIfAborted();
      this.checkCommandLimit();
      const command = commands[commandIndex];
      const commandPath = `${container.path}.commands[${commandIndex}]`;
      const commandState = this.applyCommandState(state, command, container);
      this.stats.executedCommands += 1;

      if (!commandState.visible) {
        this.stats.hiddenCommands += 1;
        continue;
      }

      if (command.kind === "draw") {
        assertKnownDrawSource(command, commandPath);
        const execution: HeprDrawRunExecution = {
          page: this.page,
          command,
          sequence: this.nextDrawSequence++,
          containerKind: container.kind,
          containerIndex: container.index,
          containerExecutionId: container.executionId,
          commandIndex,
          commandPath,
          depth: container.depth,
          state: commandState
        };
        const pendingDraw = pendingCallback(this.backend.drawRun(execution));
        if (pendingDraw !== null) await pendingDraw;
        this.stats.drawRuns += 1;
        this.stats.drawnItems += command.count;
      } else if (command.kind === "invoke-program") {
        await this.executeProgram(
          command.programIndex,
          commandState,
          command,
          container.depth + 1,
          container.executionId
        );
      } else if (command.kind === "invoke-group") {
        await this.executeGroup(
          command.groupIndex,
          commandState,
          "invoked",
          container.depth + 1,
          container.executionId,
          command
        );
      } else {
        throw new HeprDisplayExecutionError(
          HEPR_DISPLAY_EXECUTION_CODES.UnsupportedCommand,
          `${commandPath}: unsupported display command`,
          { path: `${commandPath}.kind` }
        );
      }
      this.signal?.throwIfAborted();
    }
  }

  private enterGroupState(
    state: HeprExecutionState,
    group: HeprCompositeGroup,
    groupIndex: number,
    executionId: number,
    role: HeprCompositeGroupRole
  ): HeprExecutionState {
    const clips = group.clipIndex < 0
      ? state.clips
      : {
          kind: "resource" as const,
          origin: "group" as const,
          clipIndex: group.clipIndex,
          ownerKind: "group" as const,
          ownerIndex: groupIndex,
          outerTransform: state.transform,
          parent: state.clips
        };
    return {
      ...state,
      clips,
      invocation: {
        kind: "group",
        index: groupIndex,
        executionId,
        role,
        parent: state.invocation
      }
    };
  }

  private enterProgramState(
    state: HeprExecutionState,
    program: HeprReusableProgram,
    programIndex: number,
    executionId: number,
    type3PaintIndex: number,
    viewTransformFlags: number
  ): HeprExecutionState {
    const transform = composeHeprMatrices(state.transform, this.readTransform(program.matrixIndex));
    const clips = program.clipToBounds && program.bounds !== null
      ? {
          kind: "program-bounds" as const,
          origin: "program-bounds" as const,
          programIndex,
          bounds: program.bounds,
          outerTransform: transform,
          parent: state.clips
        }
      : state.clips;
    return {
      ...state,
      transform,
      clips,
      invocation: {
        kind: "program",
        index: programIndex,
        executionId,
        role: "program",
        parent: state.invocation
      },
      type3PaintIndex: type3PaintIndex >= 0 ? type3PaintIndex : state.type3PaintIndex,
      viewTransformFlags: state.viewTransformFlags | viewTransformFlags
    };
  }

  private applyCommandState(
    state: HeprExecutionState,
    command: HeprDisplayCommand,
    owner: Pick<ContainerExecution, "kind" | "index">
  ): HeprExecutionState {
    const clips = command.clipIndex < 0
      ? state.clips
      : {
          kind: "resource" as const,
          origin: "command" as const,
          clipIndex: command.clipIndex,
          ownerKind: owner.kind,
          ownerIndex: owner.index,
          outerTransform: state.transform,
          parent: state.clips
        };
    const optionalContent = command.optionalContentIndex < 0
      ? state.optionalContent
      : {
          index: command.optionalContentIndex,
          parent: state.optionalContent
        };
    const markedContent = command.markedContentIndex < 0
      ? state.markedContent
      : {
          index: command.markedContentIndex,
          parent: state.markedContent
        };
    const visible = state.visible && (
      command.optionalContentIndex < 0 ||
      this.page.stores.optionalContent.defaultVisible[command.optionalContentIndex] !== 0
    );
    const transform = composeHeprMatrices(state.transform, this.readTransform(command.transformIndex));
    if (
      transform === state.transform &&
      clips === state.clips &&
      optionalContent === state.optionalContent &&
      markedContent === state.markedContent &&
      visible === state.visible
    ) {
      return state;
    }
    return {
      ...state,
      transform,
      clips,
      optionalContent,
      markedContent,
      visible
    };
  }

  private readTransform(index: number): PdfMatrix {
    const cached = this.transformCache[index];
    if (cached !== undefined) return cached;
    const values = this.page.stores.transforms.values;
    const offset = index * 6;
    const transform: PdfMatrix = [
      values[offset],
      values[offset + 1],
      values[offset + 2],
      values[offset + 3],
      values[offset + 4],
      values[offset + 5]
    ];
    this.transformCache[index] = transform;
    return transform;
  }

  private checkDepth(depth: number): void {
    if (depth > this.limits.maxInvocationDepth) {
      throw new HeprDisplayExecutionError(
        HEPR_DISPLAY_EXECUTION_CODES.DepthLimit,
        `Display invocation depth ${depth} exceeds limit ${this.limits.maxInvocationDepth}.`
      );
    }
  }

  private checkCommandLimit(): void {
    if (this.stats.executedCommands >= this.limits.maxExecutedCommands) {
      throw new HeprDisplayExecutionError(
        HEPR_DISPLAY_EXECUTION_CODES.ExecutionLimit,
        `Executed command limit ${this.limits.maxExecutedCommands} exceeded.`
      );
    }
  }

  private checkGroupLimit(): void {
    if (this.stats.compositeGroupExecutions >= this.limits.maxCompositeGroupExecutions) {
      throw new HeprDisplayExecutionError(
        HEPR_DISPLAY_EXECUTION_CODES.ExecutionLimit,
        `Composite group execution limit ${this.limits.maxCompositeGroupExecutions} exceeded.`
      );
    }
  }

  private checkProgramLimit(): void {
    if (this.stats.programExecutions >= this.limits.maxProgramExecutions) {
      throw new HeprDisplayExecutionError(
        HEPR_DISPLAY_EXECUTION_CODES.ExecutionLimit,
        `Reusable program execution limit ${this.limits.maxProgramExecutions} exceeded.`
      );
    }
  }

  private enterNode(key: string, path: string): void {
    if (this.activeNodes.has(key)) {
      throw new HeprDisplayExecutionError(
        HEPR_DISPLAY_EXECUTION_CODES.ResourceCycle,
        `${path}: cyclic display resource invocation`,
        { path }
      );
    }
    this.activeNodes.add(key);
  }

  private async withBoundary(
    begin: () => MaybePromise<void> | undefined,
    end: (outcome: HeprExecutionOutcome) => MaybePromise<void> | undefined,
    body: () => Promise<void>
  ): Promise<void> {
    this.signal?.throwIfAborted();
    const pendingBegin = pendingCallback(begin());
    if (pendingBegin !== null) await pendingBegin;
    let bodyError: unknown;
    let bodyFailed = false;
    try {
      await body();
      this.signal?.throwIfAborted();
    } catch (error) {
      bodyError = error;
      bodyFailed = true;
    }

    const outcome: HeprExecutionOutcome = !bodyFailed
      ? { status: "complete" }
      : this.signal?.aborted
        ? { status: "aborted", error: bodyError }
        : { status: "error", error: bodyError };
    try {
      const pendingEnd = pendingCallback(end(outcome));
      if (pendingEnd !== null) await pendingEnd;
    } catch (endError) {
      if (bodyFailed) {
        throw new AggregateError(
          [bodyError, endError],
          "Display execution and backend boundary cleanup both failed."
        );
      }
      throw endError;
    }
    if (bodyFailed) throw bodyError;
  }
}

function assertResolverIndex(index: number, count: number, path: string): void {
  if (!Number.isSafeInteger(index) || index < 0 || index >= count) {
    failPatternResolution(path, `index ${index} is outside 0..${count - 1}`);
  }
}

function readResolverTransform(page: HeprPageData, index: number, path: string): PdfMatrix {
  const count = page.stores.transforms.values.length / 6;
  assertResolverIndex(index, count, path);
  const offset = index * 6;
  const transform: PdfMatrix = [
    page.stores.transforms.values[offset],
    page.stores.transforms.values[offset + 1],
    page.stores.transforms.values[offset + 2],
    page.stores.transforms.values[offset + 3],
    page.stores.transforms.values[offset + 4],
    page.stores.transforms.values[offset + 5]
  ];
  if (transform.some((value) => !Number.isFinite(value))) {
    failPatternResolution(path, "transform contains a non-finite value");
  }
  return Object.freeze(transform) as PdfMatrix;
}

function failPatternResolution(path: string, message: string): never {
  throw new HeprDisplayExecutionError(
    HEPR_DISPLAY_EXECUTION_CODES.InvalidResource,
    `${path}: ${message}`,
    { path }
  );
}

function validateBackend(backend: HeprDisplayBackend): void {
  if (
    typeof backend !== "object" ||
    backend === null ||
    typeof backend.drawRun !== "function" ||
    typeof backend.beginCompositeGroup !== "function" ||
    typeof backend.endCompositeGroup !== "function"
  ) {
    throw new TypeError(
      "HEPR display backend must implement drawRun(), beginCompositeGroup(), and endCompositeGroup()."
    );
  }
}

function validatePageForExecution(page: HeprPageData): void {
  try {
    validateHeprPageData(page);
  } catch (error) {
    if (!(error instanceof HeprDataValidationError)) throw error;
    let code: HeprDisplayExecutionCode = HEPR_DISPLAY_EXECUTION_CODES.InvalidPage;
    if (error.code === HEPR_DATA_VALIDATION_CODES.ResourceCycle) {
      code = HEPR_DISPLAY_EXECUTION_CODES.ResourceCycle;
    } else if (error.code === HEPR_DATA_VALIDATION_CODES.ResourceLimit) {
      code = HEPR_DISPLAY_EXECUTION_CODES.ResourceLimit;
    } else if (error.code === HEPR_DATA_VALIDATION_CODES.InvalidReference) {
      code = HEPR_DISPLAY_EXECUTION_CODES.InvalidResource;
    } else if (error.path.includes(".commands[") && error.path.endsWith(".source")) {
      code = HEPR_DISPLAY_EXECUTION_CODES.UnsupportedDrawSource;
    } else if (error.path.includes(".commands[") && error.path.endsWith(".kind")) {
      code = HEPR_DISPLAY_EXECUTION_CODES.UnsupportedCommand;
    } else if (error.path.endsWith(".blendMode")) {
      code = HEPR_DISPLAY_EXECUTION_CODES.UnsupportedBlendMode;
    }
    throw new HeprDisplayExecutionError(code, error.message, {
      path: error.path,
      cause: error
    });
  }
}

function assertKnownDrawSource(command: DrawRun, path: string): void {
  switch (command.source) {
    case "paths":
    case "fill-paths":
    case "stroke-segments":
    case "glyphs":
    case "images":
    case "meshes":
    case "gradients":
    case "patterns":
      return;
    default:
      throw new HeprDisplayExecutionError(
        HEPR_DISPLAY_EXECUTION_CODES.UnsupportedDrawSource,
        `${path}: unsupported draw source ${String((command as { source?: unknown }).source)}`,
        { path: `${path}.source` }
      );
  }
}

function assertKnownBlendMode(blendMode: PdfBlendMode, path: string): void {
  switch (blendMode) {
    case "Normal":
    case "Multiply":
    case "Screen":
    case "Overlay":
    case "Darken":
    case "Lighten":
    case "ColorDodge":
    case "ColorBurn":
    case "HardLight":
    case "SoftLight":
    case "Difference":
    case "Exclusion":
    case "Hue":
    case "Saturation":
    case "Color":
    case "Luminosity":
      return;
    default:
      throw new HeprDisplayExecutionError(
        HEPR_DISPLAY_EXECUTION_CODES.UnsupportedBlendMode,
        `${path}: unsupported blend mode ${String(blendMode)}`,
        { path }
      );
  }
}

function composeHeprMatrices(outer: PdfMatrix, local: PdfMatrix): PdfMatrix {
  if (isIdentityMatrix(local)) return outer;
  if (isIdentityMatrix(outer)) return local;
  return multiplyHeprMatrices(outer, local);
}

function isIdentityMatrix(matrix: PdfMatrix): boolean {
  return matrix[0] === 1 && matrix[1] === 0 && matrix[2] === 0 &&
    matrix[3] === 1 && matrix[4] === 0 && matrix[5] === 0;
}

function normalizeLimits(
  limits: Partial<HeprDisplayExecutionLimits> | undefined
): Readonly<HeprDisplayExecutionLimits> {
  const normalized = {
    ...DEFAULT_HEPR_DISPLAY_EXECUTION_LIMITS,
    ...limits
  };
  for (const [name, value] of Object.entries(normalized)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(`${name} must be a non-negative safe integer.`);
    }
  }
  return Object.freeze(normalized);
}

function pendingCallback(value: MaybePromise<void> | undefined): PromiseLike<void> | null {
  if (value != null && typeof (value as PromiseLike<void>).then === "function") {
    return value as PromiseLike<void>;
  }
  return null;
}
