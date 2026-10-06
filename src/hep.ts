// Keep the established source-module API while loaders use the reader directly.
export { loadSceneFromHep } from "./hepReader";
export { prepareSceneForHepRendering, listSceneRasterLayers } from "./hepShared";
export { buildHepBlobForLayout } from "./hepWriter";
export type {
  SceneTextureStats,
  TextureLayout,
  BuildHepBlobOptions,
  HepBuildProgress,
  LoadHepOptions,
  HepBlobResult
} from "./hepTypes";
