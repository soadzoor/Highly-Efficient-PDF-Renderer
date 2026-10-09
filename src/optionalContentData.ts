/** JavaScript array capacity and signed Int32 condition-reference capacity. */
export const MAX_OPTIONAL_CONTENT_GROUPS = 0xffffffff;
export const MAX_OPTIONAL_CONTENT_CONDITIONS = 2 ** 31;

/** Document-local layer identity; store the document/artifact identity separately. */
export interface OptionalContentGroup {
  readonly id: string;
  readonly name: string;
  readonly defaultVisible: boolean;
  readonly locked: boolean;
  /** False when the PDF's default View configuration does not select this group's intent. */
  readonly usedInView: boolean;
  /**
   * Set on a HEPR annotation layer: the `SceneAnnotation.id` whose compiled
   * appearance this group shows or hides. It is not a PDF layer, so layer
   * APIs and panels omit it. It is stored locked and outside the view intent,
   * so readers without annotation layers cannot hide it through layer controls.
   */
  readonly annotationId?: string;
}

/** Acyclic condition graph. Operands address entries in SceneOptionalContent.conditions. */
export type OptionalContentCondition =
  | { readonly kind: "group"; readonly groupId: string }
  | { readonly kind: "and" | "or"; readonly operands: readonly number[] }
  | { readonly kind: "not"; readonly operand: number }
  | { readonly kind: "constant"; readonly value: boolean };

export type OptionalContentOrderNode =
  | { readonly kind: "group"; readonly groupId: string; readonly children?: readonly OptionalContentOrderNode[] }
  | { readonly kind: "label"; readonly label: string; readonly children: readonly OptionalContentOrderNode[] };

export interface SceneOptionalContent {
  readonly groups: readonly OptionalContentGroup[];
  readonly conditions: readonly OptionalContentCondition[];
  readonly order: readonly OptionalContentOrderNode[];
  readonly radioGroups: readonly (readonly string[])[];
}
