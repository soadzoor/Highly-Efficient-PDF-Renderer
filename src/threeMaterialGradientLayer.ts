import { buildVectorFillBandIndex, vectorFillBandStore, type VectorFillBandStore } from "./vectorFillBands";
import { pdfShapeCoverageGlsl } from "./pdfShapeCoverage";
import { buildGradientMeshRenderData } from "./gradientMesh";
import { GRADIENT_PARAMETER_GLSL, GRADIENT_BACKGROUND_GLSL } from "./gradientSampling";
import type { PrimitiveColorUpdate } from "./primitiveAppearance";
import * as THREE from "three";
import { createDefaultOptionalContentSnapshot, type OptionalContentSnapshot } from "./optionalContent";
import { ScenePaintVisibility } from "./scenePaintVisibility";
import { createThreeVectorClipTexture, initializeThreeVectorClip, createThreeVectorClipMaterial } from "./threeVectorClips";

import {
  CORE_FILL_FRAGMENT_SHADER_SOURCE,
  CORE_FILL_VERTEX_SHADER_SOURCE,
  CORE_STROKE_FRAGMENT_SHADER_SOURCE,
  CORE_STROKE_VERTEX_SHADER_SOURCE
} from "./coreShaders";
import type { VectorDrawRun, VectorScene } from "./pdfVectorExtractor";
import { configureStraightAlphaBlending } from "./threeMaterialBlending";
import type { ThreePdfOrderedPaintMesh } from "./threePdfPaintOrder";
import { normalizeThreeRawShaderSource } from "./threeRawShaderColorSpace";
import {
  createThreeWebGpuGradientFillMaterial,
  createThreeWebGpuGradientStrokeMaterial,
  type ThreeWebGpuGradientFillMaterialState,
  type ThreeWebGpuGradientStrokeMaterialState
} from "./threeWebGpuGradientMaterial";
import type { ThreeColorCompositing } from "./threeWebGpuColorSpace";
import type { ViewState } from "./webGlFloorplanRenderer";

interface GradientLayerOptions {
  materialBackend?: "webgl" | "webgpu";
  colorCompositing?: ThreeColorCompositing;
  strokeCurveEnabled: boolean;
  vectorOverride: [number, number, number, number];
}

interface ViewportPixels {
  width: number;
  height: number;
}

interface GradientVectorSceneContract {
  gradientCount?: number;
  gradientMetaA?: Float32Array;
  gradientMetaB?: Float32Array;
  gradientMetaC?: Float32Array;
  gradientMetaD?: Float32Array;
  gradientMetaE?: Float32Array;
  gradientLut?: Uint8Array<ArrayBufferLike>;
  gradientFillPathCount?: number;
  gradientFillSegmentCount?: number;
  gradientFillPathMetaA?: Float32Array;
  gradientFillPathMetaB?: Float32Array;
  gradientFillPathMetaC?: Float32Array;
  gradientFillPaintMeta?: Float32Array;
  gradientFillSegmentsA?: Float32Array;
  gradientFillSegmentsB?: Float32Array;
  gradientStrokeRunCount?: number;
  gradientStrokeSegmentCount?: number;
  gradientStrokeRunMetaA?: Float32Array;
  gradientStrokeRunMetaB?: Float32Array;
  gradientStrokeEndpoints?: Float32Array;
  gradientStrokePrimitiveMeta?: Float32Array;
  gradientStrokePrimitiveBounds?: Float32Array;
  gradientStrokeStyles?: Float32Array;
}

interface GradientTextureSet {
  metaA: THREE.DataTexture;
  metaB: THREE.DataTexture;
  metaC: THREE.DataTexture;
  metaD: THREE.DataTexture;
  metaE: THREE.DataTexture;
  lut: THREE.DataTexture;
  metaWidth: number;
}

interface GradientLayerEntry extends ThreePdfOrderedPaintMesh {
  primitiveKind: "gradient-fill" | "gradient-stroke";
  primitiveIndex: number;
  primitiveColor: THREE.Vector4;
  material: THREE.Material;
  geometry: THREE.BufferGeometry;
  fillState?: ThreeWebGpuGradientFillMaterialState;
  strokeState?: ThreeWebGpuGradientStrokeMaterialState;
}

const GRADIENT_LUT_WIDTH = 1024;

export class ThreeMaterialGradientLayer {
  private readonly scene: VectorScene;
  private readonly visibility: ScenePaintVisibility;
  private readonly fillRuns: (VectorDrawRun | undefined)[];
  private readonly strokeRuns: (VectorDrawRun | undefined)[];
  readonly group: THREE.Group;
  private readonly vectorClipTexture: THREE.DataTexture | null;
  private readonly fillClipIndices: number[];
  private readonly strokeClipIndices: number[];

  private readonly entries: GradientLayerEntry[] = [];
  private readonly ownedTextures: THREE.DataTexture[] = [];
  private readonly viewportUniform = new THREE.Vector2(1, 1);
  private readonly cameraCenterUniform = new THREE.Vector2();
  private readonly zoomUniform = { value: 1 };
  private readonly useLocalToClipUniform = { value: 0 };
  private readonly localToClipUniform = new THREE.Matrix4();
  private readonly localUnitsPerPixelUniform = { value: 1 };
  private readonly curveUniform: { value: number };
  private readonly vectorOverrideUniform: THREE.Vector4;
  private readonly colorCompositing: ThreeColorCompositing;

  constructor(scene: VectorScene, options: GradientLayerOptions) {
    this.scene = scene;
    this.visibility = new ScenePaintVisibility(scene);
    this.fillRuns = Array(scene.gradientFillPathCount);
    this.strokeRuns = Array(scene.gradientStrokeRunCount);
    this.group = new THREE.Group();
    this.group.visible = false;
    this.colorCompositing = options.colorCompositing ?? "linear";
    this.curveUniform = { value: options.strokeCurveEnabled ? 1 : 0 };
    this.vectorOverrideUniform = new THREE.Vector4(...options.vectorOverride);
    this.vectorClipTexture = null;
    this.fillClipIndices = Array(scene.gradientFillPathCount).fill(-1);
    this.strokeClipIndices = Array(scene.gradientStrokeRunCount).fill(-1);
    for (const run of scene.drawRuns ?? []) {
      const indices = run.kind === "gradient-fill" ? this.fillClipIndices
        : run.kind === "gradient-stroke" ? this.strokeClipIndices : undefined;
      if (indices && run.clipIndex !== undefined) indices.fill(run.clipIndex, run.first, run.first + run.count);
      const runs = run.kind === "gradient-fill" ? this.fillRuns : run.kind === "gradient-stroke" ? this.strokeRuns : undefined;
      runs?.fill(run, run.first, run.first + run.count);
    }

    const source = scene as VectorScene & GradientVectorSceneContract;
    const gradientCount = normalizeCount(source.gradientCount);
    if (
      normalizeCount(source.gradientFillPathCount) <= 0 &&
      normalizeCount(source.gradientStrokeRunCount) <= 0
    ) {
      return;
    }

    this.vectorClipTexture = this.own(createThreeVectorClipTexture(scene));
    const gradientTextures = this.createGradientTextures(source, gradientCount);
    const materialBackend = options.materialBackend ?? "webgl";
    this.createFillEntries(source, gradientTextures, materialBackend);
    this.createStrokeEntries(source, gradientTextures, materialBackend, options.strokeCurveEnabled);
    this.setOptionalContentVisibility(createDefaultOptionalContentSnapshot(scene));
  }

  setOptionalContentVisibility(snapshot: OptionalContentSnapshot): void {
    this.visibility.setVisibility(snapshot);
    for (const entry of this.entries) {
      const run = (entry.primitiveKind === "gradient-fill" ? this.fillRuns : this.strokeRuns)[entry.primitiveIndex];
      entry.mesh.visible = !run || (this.visibility.requiresCompositing
        ? run.optionalContent === undefined || snapshot.conditions[run.optionalContent] !== 0
        : this.visibility.isRunVisible(run));
    }
  }

  getOrderedPaintMeshes(): readonly ThreePdfOrderedPaintMesh[] {
    return this.entries;
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  setStrokeCurveEnabled(enabled: boolean): void {
    this.curveUniform.value = enabled ? 1 : 0;
    for (const entry of this.entries) {
      if (entry.strokeState) {
        entry.strokeState.curveUniform.value = this.curveUniform.value;
      }
    }
  }

  setVectorOverride(red: number, green: number, blue: number, opacity: number): void {
    this.vectorOverrideUniform.set(red, green, blue, opacity);
  }

  setPrimitiveColorUpdates(updates: readonly PrimitiveColorUpdate[]): void {
    let fills: Map<number, PrimitiveColorUpdate["color"]> | undefined;
    let strokes: Map<number, PrimitiveColorUpdate["color"]> | undefined;
    for (const update of updates) {
      if (update.ref.kind === "gradient-fill") (fills ??= new Map()).set(update.ref.index, update.color);
      else if (update.ref.kind === "gradient-stroke") (strokes ??= new Map()).set(update.ref.index, update.color);
    }
    if (!fills && !strokes) return;
    for (const entry of this.entries) {
      const color = (entry.primitiveKind === "gradient-fill" ? fills : strokes)?.get(entry.primitiveIndex);
      if (color === undefined) continue;
      if (color) entry.primitiveColor.set(...color, 1);
      else entry.primitiveColor.set(0, 0, 0, 0);
    }
  }

  setScreenSpaceTransform(): void {
    this.useLocalToClipUniform.value = 0;
    for (const entry of this.entries) {
      entry.fillState && (entry.fillState.useLocalToClipUniform.value = 0);
      entry.strokeState && (entry.strokeState.useLocalToClipUniform.value = 0);
    }
  }

  setLocalToClipTransform(localToClip: THREE.Matrix4, localUnitsPerPixel: number): void {
    this.useLocalToClipUniform.value = 1;
    this.localToClipUniform.copy(localToClip);
    this.localUnitsPerPixelUniform.value =
      Number.isFinite(localUnitsPerPixel) && localUnitsPerPixel > 1e-8
        ? localUnitsPerPixel
        : 1;
    for (const entry of this.entries) {
      entry.fillState && (entry.fillState.useLocalToClipUniform.value = 1);
      if (entry.strokeState) {
        entry.strokeState.useLocalToClipUniform.value = 1;
        entry.strokeState.localUnitsPerPixelUniform.value = this.localUnitsPerPixelUniform.value;
      }
    }
  }

  updateFrame(viewState: ViewState, viewport: ViewportPixels): void {
    this.viewportUniform.set(Math.max(1, viewport.width), Math.max(1, viewport.height));
    this.cameraCenterUniform.set(viewState.cameraCenterX, viewState.cameraCenterY);
    this.zoomUniform.value = Math.max(1e-6, viewState.zoom);
    for (const entry of this.entries) {
      entry.fillState && (entry.fillState.zoomUniform.value = this.zoomUniform.value);
      entry.strokeState && (entry.strokeState.zoomUniform.value = this.zoomUniform.value);
    }
  }

  dispose(): void {
    for (const entry of this.entries) {
      this.group.remove(entry.mesh);
      entry.geometry.dispose();
      entry.material.dispose();
    }
    this.entries.length = 0;
    for (const texture of this.ownedTextures) {
      texture.dispose();
    }
    this.ownedTextures.length = 0;
  }

  private createGradientTextures(
    scene: GradientVectorSceneContract,
    gradientCount: number
  ): GradientTextureSet {
    const size = chooseTextureSize(gradientCount);
    const metaA = this.own(createFloatTexture(scene.gradientMetaA, gradientCount, size.width, size.height));
    const metaB = this.own(createFloatTexture(scene.gradientMetaB, gradientCount, size.width, size.height));
    const metaC = this.own(createFloatTexture(scene.gradientMetaC, gradientCount, size.width, size.height));
    const metaD = this.own(createFloatTexture(scene.gradientMetaD, gradientCount, size.width, size.height));
    const metaE = this.own(createFloatTexture(scene.gradientMetaE, gradientCount, size.width, size.height));
    const lut = this.own(createGradientLutTexture(scene.gradientLut, gradientCount));
    return { metaA, metaB, metaC, metaD, metaE, lut, metaWidth: size.width };
  }

  private createFillEntries(
    scene: GradientVectorSceneContract,
    gradients: GradientTextureSet,
    materialBackend: "webgl" | "webgpu"
  ): void {
    const pathCount = Math.min(
      normalizeCount(scene.gradientFillPathCount),
      quadCount(scene.gradientFillPathMetaA),
      quadCount(scene.gradientFillPathMetaB),
      quadCount(scene.gradientFillPathMetaC),
      quadCount(scene.gradientFillPaintMeta)
    );
    const segmentCount = Math.min(
      normalizeCount(scene.gradientFillSegmentCount),
      quadCount(scene.gradientFillSegmentsA),
      quadCount(scene.gradientFillSegmentsB)
    );
    if (pathCount <= 0 || segmentCount <= 0) {
      return;
    }

    const pathSize = chooseTextureSize(pathCount);
    const bands = vectorFillBandStore(scene.gradientFillSegmentsA!, segmentCount, buildVectorFillBandIndex({
      pathCount, segmentCount, pathMetaA: scene.gradientFillPathMetaA!, pathMetaB: scene.gradientFillPathMetaB!,
      segmentsA: scene.gradientFillSegmentsA!, segmentsB: scene.gradientFillSegmentsB!
    }));
    const segmentSize = chooseTextureSize(bands.texels);
    const pathMetaA = this.own(createFloatTexture(scene.gradientFillPathMetaA, pathCount, pathSize.width, pathSize.height));
    const pathMetaB = this.own(createFloatTexture(scene.gradientFillPathMetaB, pathCount, pathSize.width, pathSize.height));
    const pathMetaC = this.own(createFloatTexture(scene.gradientFillPathMetaC, pathCount, pathSize.width, pathSize.height));
    const segmentA = this.own(createFloatTexture(bands.data, bands.texels, segmentSize.width, segmentSize.height));
    const segmentB = this.own(createFloatTexture(scene.gradientFillSegmentsB, segmentCount, segmentSize.width, segmentSize.height));

    const meshes = this.scene.gradientMeshIndices?.length ? buildGradientMeshRenderData(this.scene) : null;
    for (let pathIndex = 0; pathIndex < pathCount; pathIndex += 1) {
      const paintOffset = pathIndex * 4;
      const sourceGradientIndex = readIndex(scene.gradientFillPaintMeta, paintOffset, -1);
      const maskGradientIndex = readIndex(scene.gradientFillPaintMeta, paintOffset + 1, -1);
      const paintOrder = readFinite(scene.gradientFillPaintMeta?.[paintOffset + 2], pathIndex);
      const pageIndex = readFinite(scene.gradientFillPaintMeta?.[paintOffset + 3], 0);
      const meshCount = meshes?.ranges[pathIndex * 2 + 1] ?? 0;
      const geometry = meshCount ? createMeshGeometry(meshes!.vertices, meshes!.ranges[pathIndex * 2], meshCount, pathIndex) : createFillGeometry(pathIndex);
      const primitiveColor = new THREE.Vector4(0, 0, 0, 0);

      let material: THREE.Material;
      let fillState: ThreeWebGpuGradientFillMaterialState | undefined;
      if (materialBackend === "webgpu") {
        fillState = createThreeWebGpuGradientFillMaterial({
          mesh: meshCount > 0,
          fillPathMetaTextureA: pathMetaA,
          fillPathMetaTextureB: pathMetaB,
          fillPathMetaTextureC: pathMetaC,
          fillSegmentTextureA: segmentA,
          fillSegmentTextureB: segmentB,
          fillPathTextureWidth: pathSize.width,
          fillSegmentTextureWidth: segmentSize.width,
          fillBandBase: bands.pathBase,
          fillBandEntries: bands.entryBase,
          ...this.createWebGpuCommonOptions(gradients, sourceGradientIndex, maskGradientIndex),
          primitiveColor
        });
        material = fillState.material;
      } else {
        material = this.createWebGlFillMaterial(
          pathMetaA,
          pathMetaB,
          pathMetaC,
          segmentA,
          segmentB,
          pathSize,
          segmentSize,
          gradients,
          sourceGradientIndex,
          maskGradientIndex,
          bands
        );
        if (meshCount) {
          const raw = material as THREE.RawShaderMaterial;
          raw.vertexShader = raw.vertexShader
            .replace("layout(location = 0) in vec2 aCorner;", "in vec2 aMeshPosition;\nin vec4 aMeshColor;\nout vec4 vMeshColor;\nlayout(location = 0) in vec2 aCorner;")
            .replace("void main() {", "void main() {\n  vMeshColor = aMeshColor;")
            .replace("vec2 world = mix(minBounds - margin, maxBounds + margin, corner01);", "vec2 world = aMeshPosition;");
          raw.fragmentShader = raw.fragmentShader
            .replace("uniform vec4 uVectorOverride;", "in vec4 vMeshColor;\nuniform vec4 uVectorOverride;")
            .replace("vec4 sourcePaint = heprSamplePdfGradient(vLocal, uSourceGradientIndex);", "vec4 sourcePaint = vMeshColor * heprSamplePdfGradient(vLocal, uSourceGradientIndex).a;");
        }
      }

      if (material instanceof THREE.RawShaderMaterial) {
        material.uniforms.uPrimitiveColor = { value: primitiveColor };
        material.uniforms.uPdfShapeOnly = { value: 0 };
        material.vertexShader = pdfShapeCoverageGlsl(material.vertexShader);
        material.fragmentShader = pdfShapeCoverageGlsl(material.fragmentShader)
          .replace(/sourcePaint.a \* maskPaint.a/g, "sourcePaint.a * mix(maskPaint.a, 1.0, uPdfShapeOnly)");
      }
      material = this.clipMaterial(material, this.fillClipIndices[pathIndex]);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;
      mesh.userData.heprDrawRun = { kind: "gradient-fill", first: pathIndex, count: 1, clipIndex: this.fillClipIndices[pathIndex] };
      const entry: GradientLayerEntry = {
        mesh,
        geometry,
        material,
        fillState,
        primitiveKind: "gradient-fill",
        primitiveIndex: pathIndex,
        primitiveColor,
        paintOrder,
        pageIndex
      };
      this.entries.push(entry);
      this.group.add(mesh);
    }
  }

  private createStrokeEntries(
    scene: GradientVectorSceneContract,
    gradients: GradientTextureSet,
    materialBackend: "webgl" | "webgpu",
    strokeCurveEnabled: boolean
  ): void {
    const runCount = Math.min(
      normalizeCount(scene.gradientStrokeRunCount),
      quadCount(scene.gradientStrokeRunMetaA),
      quadCount(scene.gradientStrokeRunMetaB)
    );
    const segmentCount = Math.min(
      normalizeCount(scene.gradientStrokeSegmentCount),
      quadCount(scene.gradientStrokeEndpoints),
      quadCount(scene.gradientStrokePrimitiveMeta),
      quadCount(scene.gradientStrokePrimitiveBounds),
      quadCount(scene.gradientStrokeStyles)
    );
    if (runCount <= 0 || segmentCount <= 0) {
      return;
    }

    const size = chooseTextureSize(segmentCount);
    const segmentA = this.own(createFloatTexture(scene.gradientStrokeEndpoints, segmentCount, size.width, size.height));
    const segmentB = this.own(createFloatTexture(scene.gradientStrokePrimitiveMeta, segmentCount, size.width, size.height));
    const segmentBounds = this.own(createFloatTexture(scene.gradientStrokePrimitiveBounds, segmentCount, size.width, size.height));
    const segmentStyles = this.own(createFloatTexture(scene.gradientStrokeStyles, segmentCount, size.width, size.height));

    for (let runIndex = 0; runIndex < runCount; runIndex += 1) {
      const runOffset = runIndex * 4;
      const start = Math.max(0, readIndex(scene.gradientStrokeRunMetaA, runOffset, 0));
      const count = Math.min(
        Math.max(0, readIndex(scene.gradientStrokeRunMetaA, runOffset + 1, 0)),
        Math.max(0, segmentCount - start)
      );
      if (count <= 0) {
        continue;
      }
      const sourceGradientIndex = readIndex(scene.gradientStrokeRunMetaA, runOffset + 2, -1);
      const maskGradientIndex = readIndex(scene.gradientStrokeRunMetaA, runOffset + 3, -1);
      const paintOrder = readFinite(scene.gradientStrokeRunMetaB?.[runOffset], runIndex);
      const pageIndex = readFinite(scene.gradientStrokeRunMetaB?.[runOffset + 1], 0);
      const geometry = createStrokeGeometry(start, count);
      const primitiveColor = new THREE.Vector4(0, 0, 0, 0);

      let material: THREE.Material;
      let strokeState: ThreeWebGpuGradientStrokeMaterialState | undefined;
      if (materialBackend === "webgpu") {
        strokeState = createThreeWebGpuGradientStrokeMaterial({
          segmentTextureA: segmentA,
          segmentTextureB: segmentB,
          segmentStyleTexture: segmentStyles,
          segmentBoundsTexture: segmentBounds,
          segmentTextureWidth: size.width,
          strokeCurveEnabled,
          ...this.createWebGpuCommonOptions(gradients, sourceGradientIndex, maskGradientIndex),
          primitiveColor
        });
        material = strokeState.material;
      } else {
        material = this.createWebGlStrokeMaterial(
          segmentA,
          segmentB,
          segmentStyles,
          segmentBounds,
          size,
          gradients,
          sourceGradientIndex,
          maskGradientIndex
        );
      }

      if (material instanceof THREE.RawShaderMaterial) {
        material.uniforms.uPrimitiveColor = { value: primitiveColor };
        material.uniforms.uPdfShapeOnly = { value: 0 };
        material.vertexShader = pdfShapeCoverageGlsl(material.vertexShader);
        material.fragmentShader = pdfShapeCoverageGlsl(material.fragmentShader)
          .replace(/sourcePaint.a \* maskPaint.a/g, "sourcePaint.a * mix(maskPaint.a, 1.0, uPdfShapeOnly)");
      }
      material = this.clipMaterial(material, this.strokeClipIndices[runIndex]);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;
      mesh.userData.heprDrawRun = { kind: "gradient-stroke", first: runIndex, count: 1, clipIndex: this.strokeClipIndices[runIndex] };
      const entry: GradientLayerEntry = {
        mesh,
        geometry,
        material,
        strokeState,
        primitiveKind: "gradient-stroke",
        primitiveIndex: runIndex,
        primitiveColor,
        paintOrder,
        pageIndex
      };
      this.entries.push(entry);
      this.group.add(mesh);
    }
  }

  private clipMaterial(material: THREE.Material, clipIndex: number): THREE.Material {
    initializeThreeVectorClip(material, this.vectorClipTexture!);
    const clipped = createThreeVectorClipMaterial(material, clipIndex);
    if (clipped !== material) material.dispose();
    return clipped;
  }

  private createWebGpuCommonOptions(
    gradients: GradientTextureSet,
    sourceGradientIndex: number,
    maskGradientIndex: number
  ) {
    return {
      gradientMetaTextureA: gradients.metaA,
      gradientMetaTextureB: gradients.metaB,
      gradientMetaTextureC: gradients.metaC,
      gradientMetaTextureD: gradients.metaD,
      gradientMetaTextureE: gradients.metaE,
      gradientLutTexture: gradients.lut,
      gradientMetaTextureWidth: gradients.metaWidth,
      sourceGradientIndex,
      maskGradientIndex,
      viewport: this.viewportUniform,
      cameraCenter: this.cameraCenterUniform,
      localToClip: this.localToClipUniform,
      vectorOverride: this.vectorOverrideUniform,
      colorCompositing: this.colorCompositing
    };
  }

  private createWebGlFillMaterial(
    pathMetaA: THREE.DataTexture,
    pathMetaB: THREE.DataTexture,
    pathMetaC: THREE.DataTexture,
    segmentA: THREE.DataTexture,
    segmentB: THREE.DataTexture,
    pathSize: { width: number; height: number },
    segmentSize: { width: number; height: number },
    gradients: GradientTextureSet,
    sourceGradientIndex: number,
    maskGradientIndex: number,
    bands: VectorFillBandStore
  ): THREE.RawShaderMaterial {
    const material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: normalizeThreeRawShaderSource(CORE_FILL_VERTEX_SHADER_SOURCE),
      fragmentShader: normalizeThreeRawShaderSource(buildGradientFillFragmentShader(), true),
      transparent: false,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
      uniforms: {
        uFillPathMetaTexA: { value: pathMetaA },
        uFillPathMetaTexB: { value: pathMetaB },
        uFillPathMetaTexC: { value: pathMetaC },
        uFillBandBase: { value: bands.pathBase },
        uFillBandEntries: { value: bands.entryBase },
        uFillSegmentTexA: { value: segmentA },
        uFillSegmentTexB: { value: segmentB },
        uFillPathMetaTexSize: { value: new Int32Array([pathSize.width, pathSize.height]) },
        uFillSegmentTexSize: { value: new Int32Array([segmentSize.width, segmentSize.height]) },
        uViewport: { value: this.viewportUniform },
        uCameraCenter: { value: this.cameraCenterUniform },
        uZoom: this.zoomUniform,
        uUseLocalToClip: this.useLocalToClipUniform,
        uLocalToClip: { value: this.localToClipUniform },
        uFillAAScreenPx: { value: 1 },
        uVectorOverride: { value: this.vectorOverrideUniform },
        ...createWebGlGradientUniforms(gradients, sourceGradientIndex, maskGradientIndex)
      }
    });
    configureStraightAlphaBlending(material);
    return material;
  }

  private createWebGlStrokeMaterial(
    segmentA: THREE.DataTexture,
    segmentB: THREE.DataTexture,
    segmentStyles: THREE.DataTexture,
    segmentBounds: THREE.DataTexture,
    size: { width: number; height: number },
    gradients: GradientTextureSet,
    sourceGradientIndex: number,
    maskGradientIndex: number
  ): THREE.RawShaderMaterial {
    const material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: normalizeThreeRawShaderSource(CORE_STROKE_VERTEX_SHADER_SOURCE),
      fragmentShader: normalizeThreeRawShaderSource(buildGradientStrokeFragmentShader(), true),
      transparent: false,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
      uniforms: {
        uSegmentTexA: { value: segmentA },
        uSegmentTexB: { value: segmentB },
        uSegmentStyleTex: { value: segmentStyles },
        uSegmentBoundsTex: { value: segmentBounds },
        uSegmentTexSize: { value: new Int32Array([size.width, size.height]) },
        uViewport: { value: this.viewportUniform },
        uCameraCenter: { value: this.cameraCenterUniform },
        uZoom: this.zoomUniform,
        uUseLocalToClip: this.useLocalToClipUniform,
        uLocalToClip: { value: this.localToClipUniform },
        uLocalUnitsPerPixel: this.localUnitsPerPixelUniform,
        uAAScreenPx: { value: 1 },
        uStrokeCurveEnabled: this.curveUniform,
        uVectorOverride: { value: this.vectorOverrideUniform },
        ...createWebGlGradientUniforms(gradients, sourceGradientIndex, maskGradientIndex)
      }
    });
    configureStraightAlphaBlending(material);
    return material;
  }

  private own(texture: THREE.DataTexture): THREE.DataTexture {
    this.ownedTextures.push(texture);
    return texture;
  }
}

function createWebGlGradientUniforms(
  gradients: GradientTextureSet,
  sourceGradientIndex: number,
  maskGradientIndex: number
): Record<string, { value: unknown }> {
  return {
    uGradientMetaTexA: { value: gradients.metaA },
    uGradientMetaTexB: { value: gradients.metaB },
    uGradientMetaTexC: { value: gradients.metaC },
    uGradientMetaTexD: { value: gradients.metaD },
    uGradientMetaTexE: { value: gradients.metaE },
    uGradientLutTex: { value: gradients.lut },
    uGradientMetaTexSize: { value: new Int32Array([gradients.metaWidth, gradients.metaA.image.height]) },
    uSourceGradientIndex: { value: sourceGradientIndex },
    uMaskGradientIndex: { value: maskGradientIndex }
  };
}

const GLSL_GRADIENT_DECLARATIONS = `
${GRADIENT_PARAMETER_GLSL}
${GRADIENT_BACKGROUND_GLSL}
uniform sampler2D uGradientMetaTexA;
uniform sampler2D uGradientMetaTexB;
uniform sampler2D uGradientMetaTexC;
uniform sampler2D uGradientMetaTexD;
uniform sampler2D uGradientMetaTexE;
uniform sampler2D uGradientLutTex;
uniform ivec2 uGradientMetaTexSize;
uniform float uSourceGradientIndex;
uniform float uMaskGradientIndex;
uniform vec4 uPrimitiveColor;

vec4 heprSamplePdfGradient(vec2 world, float gradientIndexInput) {
  if (gradientIndexInput < -0.5) {
    return vec4(1.0);
  }
  int gradientIndex = int(gradientIndexInput + 0.5);
  ivec2 coord = ivec2(gradientIndex % uGradientMetaTexSize.x, gradientIndex / uGradientMetaTexSize.x);
  vec4 metaA = texelFetch(uGradientMetaTexA, coord, 0);
  vec4 metaB = texelFetch(uGradientMetaTexB, coord, 0);
  vec4 metaC = texelFetch(uGradientMetaTexC, coord, 0);
  vec4 metaD = texelFetch(uGradientMetaTexD, coord, 0);
  vec4 metaE = texelFetch(uGradientMetaTexE, coord, 0);
  vec2 q = vec2(
    metaB.x * world.x + metaB.z * world.y + metaC.x,
    metaB.y * world.x + metaB.w * world.y + metaC.y
  );
  if (metaA.y >= 0.5 && (q.x < metaE.x || q.y < metaE.y || q.x > metaE.z || q.y > metaE.w)) {
    return vec4(0.0);
  }
  if (metaA.x > 1.5) return vec4(1.0);
  vec2 parameter = heprGradientParameter(metaA, metaC, metaD, q);
  if (parameter.y < 0.5) return heprGradientBackground(metaA.w);
  float t = parameter.x;
  float sampleX = clamp(t, 0.0, 1.0) * 1023.0;
  int x0 = int(floor(sampleX));
  int x1 = min(x0 + 1, 1023);
  float amount = sampleX - float(x0);
  vec4 color0 = texelFetch(uGradientLutTex, ivec2(x0, gradientIndex), 0);
  vec4 color1 = texelFetch(uGradientLutTex, ivec2(x1, gradientIndex), 0);
  return mix(color0, color1, amount);
}
`;

// Gradient edges often come from the PDF clip instead of the paint path.
// Evaluate their pixel footprint before the core shader's early discards.
function withAntialiasedGradientClip(source: string): string {
  return source
    .replace("void main() {", `void main() {
  float clipPixelX = length(vec2(dFdx(vLocal.x), dFdy(vLocal.x)));
  float clipPixelY = length(vec2(dFdx(vLocal.y), dFdy(vLocal.y)));
  float clipAAWidth = max(max(clipPixelX, clipPixelY), 1e-4);`)
    .replaceAll("outColor *= heprVectorClip(vLocal);", "outColor.a *= heprVectorClipAA(vLocal, clipAAWidth);");
}

function buildGradientFillFragmentShader(): string {
  return withAntialiasedGradientClip(CORE_FILL_FRAGMENT_SHADER_SOURCE)
    .replace("uniform vec4 uVectorOverride;", `uniform vec4 uVectorOverride;\n${GLSL_GRADIENT_DECLARATIONS}`)
    .replace(
      "  vec3 color = mix(vColor, uVectorOverride.rgb, clamp(uVectorOverride.a, 0.0, 1.0));",
      `  vec4 sourcePaint = heprSamplePdfGradient(vLocal, uSourceGradientIndex);\n` +
      `  vec4 maskPaint = heprSamplePdfGradient(vLocal, uMaskGradientIndex);\n` +
      `  vec3 baseColor = uSourceGradientIndex >= -0.5 ? sourcePaint.rgb : vColor;\n` +
      `  float paintAlpha = sourcePaint.a * maskPaint.a;\n` +
      `  baseColor = mix(baseColor, uPrimitiveColor.rgb, uPrimitiveColor.a);\n` +
      `  vec3 color = mix(baseColor, uVectorOverride.rgb, clamp(uVectorOverride.a, 0.0, 1.0));`
    )
    .replace(/float alpha = (heprThreeLinearCoverageToOutputAlpha\(coverage\) \* [^;]+);/,
      "float alpha = $1 * paintAlpha;");
}

function buildGradientStrokeFragmentShader(): string {
  return withAntialiasedGradientClip(CORE_STROKE_FRAGMENT_SHADER_SOURCE)
    .replace("uniform vec4 uVectorOverride;", `uniform vec4 uVectorOverride;\n${GLSL_GRADIENT_DECLARATIONS}`)
    .replace(
      "  vec3 color = mix(vColor, uVectorOverride.rgb, clamp(uVectorOverride.a, 0.0, 1.0));\n  outColor = heprThreeEncodeOutputColor(vec4(color, alpha));",
      `  vec4 sourcePaint = heprSamplePdfGradient(vLocal, uSourceGradientIndex);\n` +
      `  vec4 maskPaint = heprSamplePdfGradient(vLocal, uMaskGradientIndex);\n` +
      `  vec3 baseColor = uSourceGradientIndex >= -0.5 ? sourcePaint.rgb : vColor;\n` +
      `  baseColor = mix(baseColor, uPrimitiveColor.rgb, uPrimitiveColor.a);\n` +
      `  vec3 color = mix(baseColor, uVectorOverride.rgb, clamp(uVectorOverride.a, 0.0, 1.0));\n` +
      `  float paintedAlpha = alpha * sourcePaint.a * maskPaint.a;\n` +
      `  if (paintedAlpha <= 0.001) { discard; }\n` +
      `  outColor = heprThreeEncodeOutputColor(vec4(color, paintedAlpha));`
    );
}

function createMeshGeometry(vertices: Float32Array, first: number, count: number, pathIndex: number): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const buffer = new THREE.InterleavedBuffer(vertices.subarray(first * 6, (first + count) * 6), 6);
  geometry.setAttribute("aMeshPosition", new THREE.InterleavedBufferAttribute(buffer, 2, 0));
  geometry.setAttribute("aMeshColor", new THREE.InterleavedBufferAttribute(buffer, 4, 2));
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute("aFillPathIndex", new THREE.Float32BufferAttribute(new Float32Array(count).fill(pathIndex), 1));
  return geometry;
}

function createFillGeometry(pathIndex: number): THREE.InstancedBufferGeometry {
  const geometry = createQuadGeometry();
  geometry.setAttribute(
    "aFillPathIndex",
    new THREE.InstancedBufferAttribute(new Float32Array([pathIndex]), 1)
  );
  geometry.instanceCount = 1;
  return geometry;
}

function createStrokeGeometry(start: number, count: number): THREE.InstancedBufferGeometry {
  const geometry = createQuadGeometry();
  const ids = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    ids[i] = start + i;
  }
  geometry.setAttribute("aSegmentIndex", new THREE.InstancedBufferAttribute(ids, 1));
  geometry.instanceCount = count;
  return geometry;
}

function createQuadGeometry(): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute(
    "aCorner",
    new THREE.Float32BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2)
  );
  geometry.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));
  return geometry;
}

function createFloatTexture(
  source: Float32Array | undefined,
  count: number,
  width: number,
  height: number
): THREE.DataTexture {
  const data = new Float32Array(width * height * 4);
  if (source) {
    data.set(source.subarray(0, Math.min(source.length, count * 4)));
  }
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType);
  configureDataTexture(texture, THREE.NearestFilter);
  return texture;
}

function createGradientLutTexture(
  source: Uint8Array<ArrayBufferLike> | undefined,
  gradientCount: number
): THREE.DataTexture {
  const rowCount = Math.max(1, gradientCount);
  const expectedLength = GRADIENT_LUT_WIDTH * rowCount * 4;
  const data = new Uint8Array(expectedLength);
  data.fill(255);
  if (source) {
    data.set(
      source.subarray(0, Math.min(source.length, GRADIENT_LUT_WIDTH * gradientCount * 4))
    );
  }
  const texture = new THREE.DataTexture(
    data,
    GRADIENT_LUT_WIDTH,
    rowCount,
    THREE.RGBAFormat,
    THREE.UnsignedByteType
  );
  configureDataTexture(texture, THREE.NearestFilter);
  return texture;
}

function configureDataTexture(
  texture: THREE.DataTexture,
  filter: THREE.MinificationTextureFilter
): void {
  texture.magFilter = filter as THREE.MagnificationTextureFilter;
  texture.minFilter = filter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.flipY = false;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
}

function chooseTextureSize(count: number): { width: number; height: number } {
  const width = Math.max(1, Math.ceil(Math.sqrt(Math.max(1, count))));
  return { width, height: Math.max(1, Math.ceil(Math.max(1, count) / width)) };
}

function normalizeCount(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

function quadCount(value: Float32Array | undefined): number {
  return value ? Math.floor(value.length / 4) : 0;
}

function readIndex(source: Float32Array | undefined, offset: number, fallback: number): number {
  return Math.trunc(readFinite(source?.[offset], fallback));
}

function readFinite(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
