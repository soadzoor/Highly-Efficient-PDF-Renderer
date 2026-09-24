import { HEPR_PAINT_KIND, type HeprDisplayCommand, type HeprPageData } from "./heprDocumentData";

interface Dependencies { conditions: Set<number>; backdrop: boolean; all: boolean }
const empty = (): Dependencies => ({ conditions: new Set(), backdrop: false, all: false });
function merge(target: Dependencies, source: Dependencies): void {
  for (const condition of source.conditions) target.conditions.add(condition);
  target.backdrop ||= source.backdrop;
  target.all ||= source.all;
}

/** Visibility dependencies of reusable programs, including masks and pattern cells. */
export class RetainedSpanDependencies {
  private readonly page: HeprPageData;
  private readonly commands = new WeakMap<HeprDisplayCommand, Dependencies>();
  private readonly resources = new Map<string, Dependencies>();
  private readonly active = new Set<string>();

  constructor(page: HeprPageData) { this.page = page; }

  span(first: number, count: number): Uint32Array {
    const root = this.page.displayProgram.groups[this.page.displayProgram.rootGroupIndex];
    const result = empty();
    if (!root || first < 0 || count < 1 || first + count > root.commands.length) result.all = true;
    else {
      for (let index = first; index < first + count; index++) merge(result, this.command(root.commands[index]));
      if (root.softMaskGroupIndex >= 0) merge(result, this.group(root.softMaskGroupIndex));
      // A corrected blend uses the prefix as its backdrop, even if the span's
      // own commands mention no OCG. Plain source-over islands need no prefix.
      if (result.backdrop) for (let index = 0; index < first; index++) merge(result, this.command(root.commands[index]));
    }
    return result.all
      ? Uint32Array.from({ length: this.page.stores.optionalContent.defaultVisible.length }, (_, index) => index)
      : Uint32Array.from(result.conditions);
  }

  private resource(key: string, collect: (result: Dependencies) => void): Dependencies {
    const cached = this.resources.get(key);
    if (cached) return cached;
    const result = empty();
    // Valid pages are acyclic and bounded; retain conservative invalidation if
    // a host supplies an unclassified or recursive resource graph.
    if (this.active.has(key) || this.active.size > 64) { result.all = true; return result; }
    this.active.add(key);
    collect(result);
    this.active.delete(key);
    this.resources.set(key, result);
    return result;
  }

  private group(index: number): Dependencies {
    return this.resource(`group:${index}`, result => {
      const group = this.page.displayProgram.groups[index];
      if (!group) { result.all = true; return; }
      result.backdrop = group.blendMode !== "Normal" || group.knockout || group.backdropPaintIndex >= 0 || !group.isolated;
      if (group.softMaskGroupIndex >= 0) merge(result, this.group(group.softMaskGroupIndex));
      for (const command of group.commands) merge(result, this.command(command));
    });
  }

  private program(index: number): Dependencies {
    return this.resource(`program:${index}`, result => {
      const program = this.page.displayProgram.programs[index];
      if (!program) { result.all = true; return; }
      for (const command of program.commands) merge(result, this.command(command));
    });
  }

  private pattern(index: number): Dependencies {
    return this.resource(`pattern:${index}`, result => {
      const program = this.page.stores.patterns.programIndices[index];
      if (program === undefined) result.all = true;
      else if (program >= 0) merge(result, this.program(program));
    });
  }

  private paint(index: number): Dependencies {
    return this.resource(`paint:${index}`, result => {
      if (this.page.stores.paints.kinds[index] === HEPR_PAINT_KIND.Pattern) {
        merge(result, this.pattern(this.page.stores.paints.resourceIndices[index]));
      }
    });
  }

  private command(command: HeprDisplayCommand): Dependencies {
    const cached = this.commands.get(command);
    if (cached) return cached;
    const result = empty();
    if (command.optionalContentIndex >= 0) result.conditions.add(command.optionalContentIndex);
    if (command.kind === "invoke-group") merge(result, this.group(command.groupIndex));
    else if (command.kind === "invoke-program") {
      merge(result, this.program(command.programIndex));
      if (command.type3PaintIndex >= 0) merge(result, this.paint(command.type3PaintIndex));
    } else {
      if ("paintIndex" in command && command.paintIndex >= 0) merge(result, this.paint(command.paintIndex));
      if ("fillPaintIndex" in command) {
        if (command.fillPaintIndex >= 0) merge(result, this.paint(command.fillPaintIndex));
        if (command.strokePaintIndex >= 0) merge(result, this.paint(command.strokePaintIndex));
      }
      if (command.source === "patterns") {
        for (let index = command.first; index < command.first + command.count; index++) merge(result, this.pattern(index));
      } else if (command.source === "glyphs") {
        // CharProcs can contain OCGs. Resolve their shared resource definitions
        // once; including other glyphs' programs is conservative and inexpensive.
        merge(result, this.resource("glyph-programs", glyphs => {
          for (const index of new Set(this.page.stores.fonts.type3ProgramIndices)) {
            if (index >= 0) merge(glyphs, this.program(index));
          }
        }));
      }
    }
    this.commands.set(command, result);
    return result;
  }
}
