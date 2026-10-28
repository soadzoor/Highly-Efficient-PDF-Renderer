const AUTO_FONT_SIZES = [4, 6, 8, 9, 10, 12, 14, 18, 20, 25, 30, 35, 40, 45, 50, 55, 60, 70, 80, 90, 100, 110, 120, 130, 144] as const;

/** PDFium's discrete auto-size choices; multiline fields use its first quarter. */
export function choosePdfFormAutoFontSize(multiline: boolean, fits: (size: number) => boolean, maximum = 144): number {
  if (!Number.isFinite(maximum) || maximum <= 0) throw new RangeError("maximum must be a positive finite font size.");
  const limit = Math.min(maximum, multiline ? 12 : 144);
  for (let index = AUTO_FONT_SIZES.length - 1; index >= 0; index--) {
    const size = AUTO_FONT_SIZES[index];
    if (size <= limit && fits(size)) return size;
  }
  // Keep overfull fields usable: callers clip the smallest permitted text.
  return Math.min(AUTO_FONT_SIZES[0], limit);
}
