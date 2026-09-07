import {
  HEPR_PATH_VERB,
  type HeprPathStore
} from "./heprDocumentData";

/** Allocation-free path visitor shared by reference and GPU backends. */
export interface HeprPathVisitor {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticTo(controlX: number, controlY: number, x: number, y: number): void;
  cubicTo(
    control1X: number,
    control1Y: number,
    control2X: number,
    control2Y: number,
    x: number,
    y: number
  ): void;
  close(): void;
}

/** Visit one validated generic path without materializing command objects. */
export function visitHeprPath(
  paths: HeprPathStore,
  pathIndex: number,
  visitor: HeprPathVisitor
): void {
  const verbStart = paths.pathVerbOffsets[pathIndex];
  const verbEnd = paths.pathVerbOffsets[pathIndex + 1];
  for (let verbIndex = verbStart; verbIndex < verbEnd; verbIndex += 1) {
    const offset = paths.verbCoordinateOffsets[verbIndex];
    switch (paths.verbs[verbIndex]) {
      case HEPR_PATH_VERB.MoveTo:
        visitor.moveTo(paths.coordinates[offset], paths.coordinates[offset + 1]);
        break;
      case HEPR_PATH_VERB.LineTo:
        visitor.lineTo(paths.coordinates[offset], paths.coordinates[offset + 1]);
        break;
      case HEPR_PATH_VERB.QuadraticTo:
        visitor.quadraticTo(
          paths.coordinates[offset],
          paths.coordinates[offset + 1],
          paths.coordinates[offset + 2],
          paths.coordinates[offset + 3]
        );
        break;
      case HEPR_PATH_VERB.CubicTo:
        visitor.cubicTo(
          paths.coordinates[offset],
          paths.coordinates[offset + 1],
          paths.coordinates[offset + 2],
          paths.coordinates[offset + 3],
          paths.coordinates[offset + 4],
          paths.coordinates[offset + 5]
        );
        break;
      case HEPR_PATH_VERB.Close:
        visitor.close();
        break;
    }
  }
}
