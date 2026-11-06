import vm from "node:vm";

/** Defaults for unrelated controllers in tests of extracted UI orchestration.
 * Each controller has its own direct tests; callers override any collaborator
 * whose behavior is part of the scenario they are exercising. */
export function editorUiTestContext(values = {}) {
  if (values.host && !values.host.sceneToClientPoint) values.host.sceneToClientPoint = () => null;
  if (values.session && !values.session.isObjectLocked) values.session.isObjectLocked = () => false;
  if (values.session && !values.session.exportClipboard) values.session.exportClipboard = async () => null;
  return vm.createContext({
    disposed: false, running: false, structuralRunning: false, savePreparing: false, AbortSignal, AbortController,
    async waitForLoad(promise, signal) { signal?.throwIfAborted(); const value = await promise; signal?.throwIfAborted(); return value; },
    async runPresentationChange(change) { await change(); },
    overlay: {}, lifetime: new AbortController(), updateClipboardButtons() {},
    review: { flushDraft: () => true, updateOverlay() {}, preview: () => null, setTool() {}, setActive() {}, cancelGesture() {},
      dispose() {}, clearSelection() {}, getTextSelection: () => null, isSelecting: () => false, hasDraftChanges: () => false },
    links: { flushDraft: () => true, isOpen: () => false, hasOpenDialog: () => false, isBusy: () => false, isPicking: () => false,
      canEditSelection: () => false, canRemoveSelection: () => false, editSelection: () => false, removeSelection: () => false,
      getDraft: () => null, restoreDraft() {}, hasDraftChanges: () => false, cancelPick() {}, setActive() {}, dispose() {}, pickTarget() {} },
    updateLinkButtons() {},
    isEditorReviewTool: tool => ["select-text", "comment"].includes(tool),
    reviewDefaults: new Map(), selectionLocked: () => false, canEditComment: () => false,
    tool: "select", activeText: null, pendingTextPaints: new Set(), releaseTextPaints() {}, appearanceControls: { refresh() {} }, latestScene: {}, toolbar: { querySelectorAll: () => [] },
    alignmentSnap: null, requestedGuides: [], createEditorAlignmentSnap: () => null,
    recovery: null, recoveryKey: "", recoveryReady: Promise.resolve(), recoveryOffered: false,
    recoveryDialog: null, pageNumberingDialog: null, recoveryRunning: false, discardRecovery: false, exportedRevision: null,
    cameraPan: { cancel() {}, isPanning: () => false, setActive() {}, dispose() {} },
    toolbarReservation: { update() {}, dispose() {} }, pasteCursor: null, contextPasteClient: null,
    tabClipboard: { beginCopy: () => Date.now(), hasValue: () => false, getId: () => null, get: () => null, publish: () => null, clear() {} }, clipboardTransferId: null, updateFonts() {},
    fieldValueLocked: () => false,
    fieldActivation: { pointerDown() {}, pointerMove() {}, pointerUp: () => null, reset() {} }, canActivateField: () => false,
    textActivation: { pointerDown() {}, pointerMove() {}, pointerUp: () => null, reset() {} }, canActivateText: () => false,
    textAtClientPoint: () => null, updateTextEditButton() {},
    fieldDialog: null, fieldDialogCreating: false, fieldDefaults: { fieldType: "text" }, selectedEditorField: () => null,
    fieldObjectOwner: id => `annotation:${id}`,
    colorDraft: null, colorChangeHandled: new WeakSet(), stageColorDraft: () => false, flushColorDraft() {},
    queueColorPreview() {}, stopColorPreview() {}, colorPreviewApplied: false, colorPreviewFallback: false, colorPreviewRestore: null,
    committedPageChanges: undefined, captureEditorPageChanges: () => undefined, changedEditorPages: () => undefined,
    updateAppearanceControls() {}, ...values
  });
}
