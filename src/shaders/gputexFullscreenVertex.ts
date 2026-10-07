// Copyright (c) 2026 GPUtex contributors. MIT license; see THIRD_PARTY_NOTICES.
// Vendored from verekia/gputex 9ec9330dcf377c00e43f9fcc8ec9e6536911033c
// library/src/webgl/glsl/fullscreen.vert.glsl (unchanged kernel).
export const GPUTEX_FULLSCREEN_VERTEX = String.raw`#version 300 es
// Fullscreen-triangle vertex shader for the WebGL block encoders.
//
// Draws a single oversized triangle covering the viewport from gl_VertexID
// alone — no vertex buffers / attributes needed (drawArrays(TRIANGLES, 0, 3)).
// The encoder sets the viewport to (blocks_x × blocks_y), so each rasterised
// fragment corresponds to exactly one 4×4 output block.
//
//   id 0 -> (-1,-1)   id 1 -> ( 3,-1)   id 2 -> (-1, 3)

void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;
