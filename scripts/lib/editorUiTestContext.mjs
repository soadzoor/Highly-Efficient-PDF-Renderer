import vm from "node:vm";

/** Defaults for unrelated controllers in tests of extracted UI orchestration.
 * Each controller has its own direct tests; callers override any collaborator
 * whose behavior is part of the scenario they are exercising. */
export function editorUiTestContext(values = {}) {
  if (values.host && !values.host.sceneToClientPoint) values.host.sceneToClientPoint = () => null;
  if (values.session && !values.session.isObjectLocked) values.session.isObjectLocked = () => false;
  return vm.createContext({
    disposed: false, running: false, structuralRunning: false, savePreparing: false, AbortSignal, AbortController,
    async waitForLoad(promise, signal) { signal?.throwIfAborted(); const value = await promise; signal?.throwIfAborted(); return value; },
    overlay: {}, lifetime: new AbortController(), updateClipboardButtons() {},
    review: { flushDraft: () => true, updateOverlay() {}, preview: () => null, setTool() {}, setActive() {}, cancelGesture() {},
      dispose() {}, isSelecting: () => false, hasDraftChanges: () => false },
    links: { flushDraft: () => true, isOpen: () => false, hasOpenDialog: () => false, isBusy: () => false, isPicking: () => false,
      canEditSelection: () => false, canRemoveSelection: () => false, editSelection: () => false, removeSelection: () => false,
      getDraft: () => null, restoreDraft() {}, hasDraftChanges: () => false, cancelPick() {}, setActive() {}, dispose() {}, pickTarget() {} },
    updateLinkButtons() {},
    isEditorReviewTool: tool => ["highlight", "underline-text", "strikeout-text", "comment"].includes(tool),
    reviewDefaults: new Map(), selectionLocked: () => false, canEditComment: () => false,
    tool: "select", appearanceControls: { refresh() {} }, latestScene: {}, toolbar: { querySelectorAll: () => [] },
    alignmentSnap: null, requestedGuides: [], createEditorAlignmentSnap: () => null,
    recovery: null, recoveryReady: Promise.resolve(), recoveryOffered: false,
    recoveryDialog: null, recoveryRunning: false, discardRecovery: false, exportedRevision: null,
    cameraPan: { cancel() {}, isPanning: () => false, setActive() {}, dispose() {} },
    fieldActivation: { pointerDown() {}, pointerMove() {}, pointerUp: () => null, reset() {} }, canActivateField: () => false,
    updateAppearanceControls() {}, ...values
  });
}
