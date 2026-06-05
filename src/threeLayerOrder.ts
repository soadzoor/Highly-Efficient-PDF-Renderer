// Coarse three.js layer ordering for the current material-layer pipeline.
//
// This is intentionally not a PDF paint-order model. PDF paint order comes
// from the operator stream and can interleave fills, strokes, text, and images.
// The current extracted scene stores those primitives in separate GPU-friendly
// buffers, so these values only keep the page depth pre-pass and broad HEPR
// layers ordered before ordinary scene objects.
export const HEPR_THREE_LAYER_ORDER_PAGE_DEPTH = -1_000_000;
export const HEPR_THREE_LAYER_ORDER_PAGE_BACKGROUND = -999_990;
export const HEPR_THREE_LAYER_ORDER_RASTER = -999_980;
export const HEPR_THREE_LAYER_ORDER_FILL = -999_970;
export const HEPR_THREE_LAYER_ORDER_STROKE = -999_960;
export const HEPR_THREE_LAYER_ORDER_TEXT = -999_950;
