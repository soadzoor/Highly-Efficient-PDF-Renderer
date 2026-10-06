import * as THREE from "three";
import { NodeMaterial, TSL } from "three/webgpu";
import { pdfCompositeFunctions } from "./pdfCompositeShaders";

interface TextureBinding { value: THREE.Texture }

function callNode(fn: unknown, params: Record<string, unknown>): never {
  return (fn as (params: Record<string, unknown>) => unknown)(params) as never;
}

/**
 * Three keys a texture uniform by the bound texture's UUID, so several texture
 * nodes that hold the same texture when the shader is built collapse onto one
 * binding. Every composite input starts on the shared placeholder, and
 * `current`/`initial` legitimately name one surface in the final pass, so the
 * pass shader was generated with a single texture that all seven inputs read:
 * the composite math then saw its own source in every channel and resolved to
 * nothing. Pin each input to its own hash so the seven bindings stay separate
 * whatever they point at, and name them after the GLSL uniforms they mirror.
 */
function bindCompositeTexture(node: unknown, name: string): TextureBinding {
  const uniform = node as { name: string; getUniformHash: () => string };
  uniform.name = name;
  uniform.getUniformHash = () => `hepr-composite-${name}`;
  return node as TextureBinding;
}

const compositeNodeFn: unknown = TSL.wgslFn(`
fn heprComposite(source:vec4f, shape:vec4f, current:vec4f, stats:vec4f, initial:vec4f,
  mask:vec4f, transferTex:texture_2d<f32>, p:vec4f, q:vec4f, backdrop:vec3f) -> vec4f {
  if (p.x==4.0) {
    var value=source.a;
    if (q.y>0.5) { value=pdfLum(source.rgb+(1.0-source.a)*backdrop); }
    value=clamp(value,0.0,1.0);
    if (q.z>1.0) {
      let at=value*(q.z-1.0); let first=i32(floor(at));
      let width=i32(textureDimensions(transferTex).x); let next=min(first+1,i32(q.z)-1);
      value=mix(textureLoad(transferTex,vec2i(first%width,first/width),0).r,
        textureLoad(transferTex,vec2i(next%width,next/width),0).r,fract(at));
    }
    return vec4f(value);
  }
  return pdfCompositePass(source,shape,current,stats,initial,mask,p,q);
}`, [TSL.wgslFn(pdfCompositeFunctions("wgsl"))] as never);

const presentNodeFn: unknown = TSL.wgslFn(`
fn heprPresentComposite(color:vec4f) -> vec4f {
  return vec4f(color.rgb/max(color.a,0.0000001),color.a);
}`);

export function createThreeWebGpuPaintCompositorMaterials(options: {
  zero: THREE.DataTexture;
  presentZero: THREE.DataTexture;
  params: THREE.Vector4;
  extra: THREE.Vector4;
  backdropColor: THREE.Vector3;
  passRect: THREE.Vector4;
  pageDepth: THREE.Vector3;
  geometry: THREE.BufferGeometry;
  bindings: TextureBinding[];
}): { passMaterial: THREE.Material; presentationBinding: TextureBinding;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material> } {
  const names = ["uSource", "uShape", "uCurrent", "uStats", "uInitial", "uMask", "uTransfer"];
  const material = new NodeMaterial();
  const textures = names.slice(0, 6).map(name => {
    const texture = TSL.textureLoad(options.zero, TSL.screenCoordinate);
    // Missing inputs use 1×1 neutral textures. Integer texture loads do
    // not apply sampler clamping, so keep every pixel inside its input.
    const dimensions = TSL.vec2(TSL.textureSize(texture) as never);
    texture.uvNode = TSL.clamp(TSL.screenCoordinate, TSL.vec2(0), dimensions.sub(1));
    return bindCompositeTexture(texture, name);
  });
  options.bindings.push(...textures);
  const rect = TSL.uniform(options.passRect);
  material.vertexNode = TSL.vec4(TSL.mix(rect.xy as never, rect.zw as never, TSL.positionLocal.xy as never) as never, 0, 1);
  // A texture-valued function argument must stay a texture node rather than a sampled vec4.
  const transfer = bindCompositeTexture(TSL.textureLoad(options.zero), names[6]);
  options.bindings.push(transfer);
  material.fragmentNode = callNode(compositeNodeFn, { source: textures[0], shape: textures[1], current: textures[2],
    stats: textures[3], initial: textures[4], mask: textures[5], transferTex: transfer,
    p: TSL.uniform(options.params), q: TSL.uniform(options.extra), backdrop: TSL.uniform(options.backdropColor) });

  const present = new NodeMaterial();
  present.vertexNode = callNode(TSL.wgslFn(`fn heprPagePresentPosition(position: vec3f, depth: vec3f) -> vec4f {
    return vec4f(position.xy, dot(depth, vec3f(position.xy, 1.0)), 1.0);
  }`), { position: TSL.positionLocal, depth: TSL.uniform(options.pageDepth) });
  const texture = TSL.texture(options.presentZero, TSL.uv().flipY());
  // Three applies the host output transfer to straight color before blending.
  present.fragmentNode = callNode(presentNodeFn, { color: texture });

  return { passMaterial: material, presentationBinding: texture as unknown as TextureBinding,
    mesh: new THREE.Mesh(options.geometry, present) };
}
