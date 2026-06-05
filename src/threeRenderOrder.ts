// HEPR material layers draw before ordinary scene objects, whose default
// renderOrder is 0. The page depth pre-pass must come first.
export const HEPR_THREE_RENDER_ORDER_PAGE_DEPTH = -1_000_000;
export const HEPR_THREE_RENDER_ORDER_PAGE_BACKGROUND = -999_990;
export const HEPR_THREE_RENDER_ORDER_RASTER = -999_980;
export const HEPR_THREE_RENDER_ORDER_FILL = -999_970;
export const HEPR_THREE_RENDER_ORDER_STROKE = -999_960;
export const HEPR_THREE_RENDER_ORDER_TEXT = -999_950;
