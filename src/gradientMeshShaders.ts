import { GRADIENT_FILL_VERTEX_SHADER_SOURCE, GRADIENT_FILL_FRAGMENT_SHADER_SOURCE } from "./nativeGradientWebGlShaders";
import { GRADIENT_FILL_WGSL } from "./nativeGradientWebGpuShaders";

// Share exact paint-path coverage, geometric clipping, mask alpha and temporary RGB styling.
export const GRADIENT_MESH_VERTEX_GLSL = GRADIENT_FILL_VERTEX_SHADER_SOURCE
  .replace("uniform sampler2D uPathMetaTexA;", `layout(location=0) in vec2 aMeshPosition;
layout(location=1) in vec4 aMeshColor;
uniform int uMeshPathIndex;
out vec4 vMeshColor;
uniform sampler2D uPathMetaTexA;`)
  .replace("int pathIndex = gl_VertexID / 4;", "vMeshColor = aMeshColor;\n  int pathIndex = uMeshPathIndex;")
  .replace("vec2 world = mix(low, high, corner01);", "vec2 world = aMeshPosition;");

export const GRADIENT_MESH_FRAGMENT_GLSL = GRADIENT_FILL_FRAGMENT_SHADER_SOURCE
  .replace("uniform sampler2D uSegmentTexA;", "in vec4 vMeshColor;\nuniform sampler2D uSegmentTexA;")
  .replace(`vec4 source = vSourceGradientIndex >= 0
    ? samplePdfGradient(vSourceGradientIndex, vLocal)
    : vec4(vSolidColor, 1.0);`, `vec4 source = vMeshColor;
  ivec2 meshCoord = gradientCoord(vSourceGradientIndex);
  vec4 meshA = texelFetch(uGradientMetaTexA, meshCoord, 0);
  vec4 meshB = texelFetch(uGradientMetaTexB, meshCoord, 0);
  vec4 meshC = texelFetch(uGradientMetaTexC, meshCoord, 0);
  vec4 meshE = texelFetch(uGradientMetaTexE, meshCoord, 0);
  vec2 meshPoint = mat2(meshB.x, meshB.y, meshB.z, meshB.w) * vLocal + meshC.xy;
  if (meshA.y >= 0.5 && (meshPoint.x < meshE.x || meshPoint.y < meshE.y || meshPoint.x > meshE.z || meshPoint.y > meshE.w)) discard;`);

export const GRADIENT_MESH_WGSL = GRADIENT_FILL_WGSL
  .replace("struct FillOut {", "struct FillOut {\n  @location(9) meshColor : vec4f,")
  .replace("fn vsMain(@builtin(vertex_index) vertexIndex : u32) -> FillOut {",
    `fn vsMain(@builtin(vertex_index) vertexIndex : u32, @builtin(instance_index) paintIndex : u32,
    @location(0) meshPosition : vec2f, @location(1) meshColor : vec4f) -> FillOut {`)
  .replace("let pathIndex = i32(vertexIndex / 4u);", "let pathIndex = i32(paintIndex);")
  .replace("var out : FillOut;", "var out : FillOut;\n  out.meshColor = meshColor;")
  .replace("let world = mix(low, high, corner);", "let world = meshPosition;")
  .replace("let source = select(vec4f(inData.solidColor, 1.0), samplePdfGradient(inData.sourceGradient, inData.local), inData.sourceGradient >= 0);", `let source = inData.meshColor;
  let meshCoord = gradientCoord(inData.sourceGradient);
  let meshA = textureLoad(uGradientMetaA, meshCoord, 0);
  let meshB = textureLoad(uGradientMetaB, meshCoord, 0);
  let meshC = textureLoad(uGradientMetaC, meshCoord, 0);
  let meshE = textureLoad(uGradientMetaE, meshCoord, 0);
  let meshPoint = mat2x2f(meshB.xy, meshB.zw) * inData.local + meshC.xy;
  if (meshA.y >= 0.5 && (meshPoint.x < meshE.x || meshPoint.y < meshE.y || meshPoint.x > meshE.z || meshPoint.y > meshE.w)) { discard; }`);

export const GRADIENT_MESH_VERTEX_LAYOUT = [{ arrayStride: 24, attributes: [
  { shaderLocation: 0, offset: 0, format: "float32x2" },
  { shaderLocation: 1, offset: 8, format: "float32x4" }
] }];
