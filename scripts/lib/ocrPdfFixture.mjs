import { tinyPdfStream, writeTinyPdf } from "./tinyPdfWriter.mjs";
import { buildTinySfnt } from "./tinySfnt.mjs";

export function createOcrPdfFixture({ poisonImage = false, form = false, glyphless = true, scan = true,
  imageWidth = 1, imageHeight = 1, imageMatrix = [200, 0, 0, 100, 0, 0], toUnicode = true,
  extGState = "",
  pageCount = 1,
  content = "BT /F1 10 Tf 3 Tr 20 30 Td <00010002> Tj ET" } = {}) {
  const fontName = glyphless ? "GlyphLessFont" : "UsefulFont";
  const pageBody = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 5 0 R >> /XObject << /Scan 6 0 R /Text 12 0 R >> /Properties << /Hidden 13 0 R >> ${extGState ? `/ExtGState << ${extGState} >>` : ""} >> /Contents 4 0 R >>`;
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [13 0 R] /D << /OFF [13 0 R] >> >> >>" },
    { number: 2, body: `<< /Type /Pages /Kids [3 0 R ${Array.from({ length: pageCount - 1 }, (_, i) => `${i + 20} 0 R`).join(" ")}] /Count ${pageCount} >>` },
    { number: 3, body: pageBody },
    { number: 4, body: tinyPdfStream("", `${scan ? `q ${imageMatrix.join(" ")} cm /Scan Do Q\n` : ""}${form ? "/Text Do" : content}`) },
    { number: 5, body: `<< /Type /Font /Subtype /Type0 /BaseFont /${fontName} /Encoding /Identity-H /DescendantFonts [7 0 R]${toUnicode ? " /ToUnicode 8 0 R" : ""} >>` },
    { number: 6, body: tinyPdfStream(`/Type /XObject /Subtype /Image /Width ${imageWidth} /Height ${imageHeight} /BitsPerComponent 8 /ColorSpace /DeviceGray${poisonImage ? " /Filter /DefinitelyUnsupported" : ""}`, new Uint8Array(imageWidth * imageHeight)) },
    { number: 7, body: `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${fontName} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 9 0 R /DW 600 /CIDToGIDMap 11 0 R >>` },
    { number: 8, body: tinyPdfStream("", "begincmap 1 begincodespacerange <0000> <FFFF> endcodespacerange 2 beginbfchar <0001> <0041> <0002> <0042> endbfchar endcmap") },
    { number: 9, body: `<< /Type /FontDescriptor /FontName /${fontName} /Flags 4 /FontBBox [0 -200 1000 800] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 /FontFile2 10 0 R >>` },
    { number: 10, body: tinyPdfStream("", buildTinySfnt()) },
    { number: 11, body: tinyPdfStream("", glyphless ? new Uint8Array(6) : Uint8Array.of(0, 0, 0, 1, 0, 2)) },
    { number: 12, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 200 100] /Resources << /Font << /F1 5 0 R >> >>", content) },
    { number: 13, body: "<< /Type /OCG /Name (Hidden) >>" },
    ...Array.from({ length: pageCount - 1 }, (_, i) => ({ number: i + 20, body: pageBody }))
  ] });
}
