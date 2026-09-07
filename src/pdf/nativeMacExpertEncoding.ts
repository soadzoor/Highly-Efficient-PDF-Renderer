/**
 * Dependency-free MacExpertEncoding and its Adobe Glyph List semantics.
 *
 * The authoritative 256-slot glyph-name vector is derived from Adobe AFDKO's
 * `c/shared/resource/macexprt.h` at commit
 * a843a0a87d9db0ea62d5ce719900acf5749c143e (Apache-2.0, source SHA-256
 * b7c30ca40c251eacff5ec247f1209b33ecfe80f37bf22362e6aa97556a6efd46).
 * Unicode values are the exact Adobe Glyph List values from `glyphlist.txt`
 * at commit 4036a9ca80a62f64f9de4f7321a9a045ad0ecfd6 (BSD-3-Clause, source
 * SHA-256 a3b2f61ced9f3644cc0d4ecde5c59df34ca286c689d9484a43a710a81c466789).
 *
 * Adobe's historical AGL semantics intentionally assign many expert glyphs
 * to the Private Use Area. `selectionUnicode` is kept separate: it is a
 * deterministic, shape-oriented approximation used only to select an outline
 * from a modern Unicode substitute when the original font is unavailable.
 */

const GLYPH_NAMES_FROM_CODE_32 = (
  "space,exclamsmall,Hungarumlautsmall,centoldstyle,dollaroldstyle,dollarsuperior," +
  "ampersandsmall,Acutesmall,parenleftsuperior,parenrightsuperior,twodotenleader," +
  "onedotenleader,comma,hyphen,period,fraction," +
  "zerooldstyle,oneoldstyle,twooldstyle,threeoldstyle,fouroldstyle,fiveoldstyle," +
  "sixoldstyle,sevenoldstyle,eightoldstyle,nineoldstyle,colon,semicolon,_," +
  "threequartersemdash,_,questionsmall," +
  "_,_,_,_,Ethsmall,_,_,onequarter,onehalf,threequarters,oneeighth,threeeighths," +
  "fiveeighths,seveneighths,onethird,twothirds," +
  "_,_,_,_,_,_,ff,fi,fl,ffi,ffl,parenleftinferior,_,parenrightinferior," +
  "Circumflexsmall,hypheninferior," +
  "Gravesmall,Asmall,Bsmall,Csmall,Dsmall,Esmall,Fsmall,Gsmall,Hsmall,Ismall,Jsmall," +
  "Ksmall,Lsmall,Msmall,Nsmall,Osmall," +
  "Psmall,Qsmall,Rsmall,Ssmall,Tsmall,Usmall,Vsmall,Wsmall,Xsmall,Ysmall,Zsmall," +
  "colonmonetary,onefitted,rupiah,Tildesmall,_," +
  "_,asuperior,centsuperior,_,_,_,_,Aacutesmall,Agravesmall,Acircumflexsmall," +
  "Adieresissmall,Atildesmall,Aringsmall,Ccedillasmall,Eacutesmall,Egravesmall," +
  "Ecircumflexsmall,Edieresissmall,Iacutesmall,Igravesmall,Icircumflexsmall," +
  "Idieresissmall,Ntildesmall,Oacutesmall,Ogravesmall,Ocircumflexsmall," +
  "Odieresissmall,Otildesmall,Uacutesmall,Ugravesmall,Ucircumflexsmall," +
  "Udieresissmall," +
  "_,eightsuperior,fourinferior,threeinferior,sixinferior,eightinferior," +
  "seveninferior,Scaronsmall,_,centinferior,twoinferior,_,Dieresissmall,_," +
  "Caronsmall,osuperior," +
  "fiveinferior,_,commainferior,periodinferior,Yacutesmall,_,dollarinferior,_,_," +
  "Thornsmall,_,nineinferior,zeroinferior,Zcaronsmall,AEsmall,Oslashsmall," +
  "questiondownsmall,oneinferior,Lslashsmall,_,_,_,_,_,_,Cedillasmall,_,_,_,_,_," +
  "OEsmall," +
  "figuredash,hyphensuperior,_,_,_,_,exclamdownsmall,_,Ydieresissmall,_," +
  "onesuperior,twosuperior,threesuperior,foursuperior,fivesuperior,sixsuperior," +
  "sevensuperior,ninesuperior,zerosuperior,_,esuperior,rsuperior,tsuperior,_,_," +
  "isuperior,ssuperior,dsuperior,_,_,_,_," +
  "_,lsuperior,Ogoneksmall,Brevesmall,Macronsmall,bsuperior,nsuperior,msuperior," +
  "commasuperior,periodsuperior,Dotaccentsmall,Ringsmall,_,_,_,_"
).split(",");

const AGL_SCALARS_FROM_CODE_32 = Uint16Array.from(
  (
    "0020,F721,F6F8,F7A2,F724,F6E4,F726,F7B4,207D,207E,2025,2024,002C,002D,002E,2044," +
    "F730,F731,F732,F733,F734,F735,F736,F737,F738,F739,003A,003B,0,F6DE,0,F73F," +
    "0,0,0,0,F7F0,0,0,00BC,00BD,00BE,215B,215C,215D,215E,2153,2154," +
    "0,0,0,0,0,0,FB00,FB01,FB02,FB03,FB04,208D,0,208E,F6F6,F6E5," +
    "F760,F761,F762,F763,F764,F765,F766,F767,F768,F769,F76A,F76B,F76C,F76D,F76E,F76F," +
    "F770,F771,F772,F773,F774,F775,F776,F777,F778,F779,F77A,20A1,F6DC,F6DD,F6FE,0," +
    "0,F6E9,F6E0,0,0,0,0,F7E1,F7E0,F7E2,F7E4,F7E3,F7E5,F7E7,F7E9,F7E8," +
    "F7EA,F7EB,F7ED,F7EC,F7EE,F7EF,F7F1,F7F3,F7F2,F7F4,F7F6,F7F5,F7FA,F7F9,F7FB,F7FC," +
    "0,2078,2084,2083,2086,2088,2087,F6FD,0,F6DF,2082,0,F7A8,0,F6F5,F6F0," +
    "2085,0,F6E1,F6E7,F7FD,0,F6E3,0,0,F7FE,0,2089,2080,F6FF,F7E6,F7F8," +
    "F7BF,2081,F6F9,0,0,0,0,0,0,F7B8,0,0,0,0,0,F6FA," +
    "2012,F6E6,0,0,0,0,F7A1,0,F7FF,0,00B9,00B2,00B3,2074,2075,2076," +
    "2077,2079,2070,0,F6EC,F6F1,F6F3,0,0,F6ED,F6F2,F6EB,0,0,0,0," +
    "0,F6EE,F6FB,F6F4,F7AF,F6EA,207F,F6EF,F6E2,F6E8,F6F7,F6FC,0,0,0,0"
  ).split(","),
  (value) => Number.parseInt(value, 16)
);

/**
 * Outline-selection approximations for AGL private-use semantics only.
 * These values never replace `unicode` in text extraction or indexing.
 */
const PUA_SUBSTITUTE_SELECTION: Readonly<Record<string, string>> = Object.freeze({
  exclamsmall: "!",
  Hungarumlautsmall: "\u02dd",
  centoldstyle: "\u00a2",
  dollaroldstyle: "$",
  dollarsuperior: "$",
  ampersandsmall: "&",
  Acutesmall: "\u00b4",
  zerooldstyle: "0",
  oneoldstyle: "1",
  twooldstyle: "2",
  threeoldstyle: "3",
  fouroldstyle: "4",
  fiveoldstyle: "5",
  sixoldstyle: "6",
  sevenoldstyle: "7",
  eightoldstyle: "8",
  nineoldstyle: "9",
  threequartersemdash: "\u2014",
  questionsmall: "?",
  Ethsmall: "\u00d0",
  Circumflexsmall: "\u02c6",
  hypheninferior: "-",
  Gravesmall: "`",
  Asmall: "A",
  Bsmall: "B",
  Csmall: "C",
  Dsmall: "D",
  Esmall: "E",
  Fsmall: "F",
  Gsmall: "G",
  Hsmall: "H",
  Ismall: "I",
  Jsmall: "J",
  Ksmall: "K",
  Lsmall: "L",
  Msmall: "M",
  Nsmall: "N",
  Osmall: "O",
  Psmall: "P",
  Qsmall: "Q",
  Rsmall: "R",
  Ssmall: "S",
  Tsmall: "T",
  Usmall: "U",
  Vsmall: "V",
  Wsmall: "W",
  Xsmall: "X",
  Ysmall: "Y",
  Zsmall: "Z",
  onefitted: "1",
  // Unicode has no rupiah-sign scalar; R is the stable first-glyph fallback.
  rupiah: "R",
  Tildesmall: "\u02dc",
  asuperior: "a",
  centsuperior: "\u00a2",
  Aacutesmall: "\u00c1",
  Agravesmall: "\u00c0",
  Acircumflexsmall: "\u00c2",
  Adieresissmall: "\u00c4",
  Atildesmall: "\u00c3",
  Aringsmall: "\u00c5",
  Ccedillasmall: "\u00c7",
  Eacutesmall: "\u00c9",
  Egravesmall: "\u00c8",
  Ecircumflexsmall: "\u00ca",
  Edieresissmall: "\u00cb",
  Iacutesmall: "\u00cd",
  Igravesmall: "\u00cc",
  Icircumflexsmall: "\u00ce",
  Idieresissmall: "\u00cf",
  Ntildesmall: "\u00d1",
  Oacutesmall: "\u00d3",
  Ogravesmall: "\u00d2",
  Ocircumflexsmall: "\u00d4",
  Odieresissmall: "\u00d6",
  Otildesmall: "\u00d5",
  Uacutesmall: "\u00da",
  Ugravesmall: "\u00d9",
  Ucircumflexsmall: "\u00db",
  Udieresissmall: "\u00dc",
  Scaronsmall: "\u0160",
  centinferior: "\u00a2",
  Dieresissmall: "\u00a8",
  Caronsmall: "\u02c7",
  osuperior: "o",
  commainferior: ",",
  periodinferior: ".",
  Yacutesmall: "\u00dd",
  dollarinferior: "$",
  Thornsmall: "\u00de",
  Zcaronsmall: "\u017d",
  AEsmall: "\u00c6",
  Oslashsmall: "\u00d8",
  questiondownsmall: "\u00bf",
  Lslashsmall: "\u0141",
  Cedillasmall: "\u00b8",
  OEsmall: "\u0152",
  hyphensuperior: "-",
  exclamdownsmall: "\u00a1",
  Ydieresissmall: "\u0178",
  esuperior: "e",
  rsuperior: "r",
  tsuperior: "t",
  isuperior: "i",
  ssuperior: "s",
  dsuperior: "d",
  lsuperior: "l",
  Ogoneksmall: "\u02db",
  Brevesmall: "\u02d8",
  Macronsmall: "\u00af",
  bsuperior: "b",
  msuperior: "m",
  commasuperior: ",",
  periodsuperior: ".",
  Dotaccentsmall: "\u02d9",
  Ringsmall: "\u02da"
});

export interface NativeMacExpertEncodingEntry {
  readonly glyphName: string;
  /** Exact Adobe Glyph List text semantics, including historical PUA values. */
  readonly unicode: string;
  /** Approximate scalar used only to select an outline from a substitute font. */
  readonly selectionUnicode: string;
}

export const NATIVE_MAC_EXPERT_ENCODING_SIZE = 256;
export const NATIVE_MAC_EXPERT_ASSIGNED_COUNT = 165;

if (
  GLYPH_NAMES_FROM_CODE_32.length !== NATIVE_MAC_EXPERT_ENCODING_SIZE - 32 ||
  AGL_SCALARS_FROM_CODE_32.length !== NATIVE_MAC_EXPERT_ENCODING_SIZE - 32
) {
  throw new Error("The generated MacExpertEncoding table has an invalid length.");
}

const ENTRIES: readonly (NativeMacExpertEncodingEntry | null)[] = Object.freeze(
  Array.from({ length: NATIVE_MAC_EXPERT_ENCODING_SIZE }, (_, code) => {
    if (code < 32) return null;
    const index = code - 32;
    const glyphName = GLYPH_NAMES_FROM_CODE_32[index];
    const scalar = AGL_SCALARS_FROM_CODE_32[index];
    if (glyphName === "_" || scalar === 0) return null;
    const unicode = String.fromCodePoint(scalar);
    const selectionUnicode = PUA_SUBSTITUTE_SELECTION[glyphName] ?? unicode;
    if (isPrivateUseScalar(scalar) && selectionUnicode === unicode) {
      throw new Error(`MacExpertEncoding /${glyphName} lacks a substitute selection mapping.`);
    }
    return Object.freeze({ glyphName, unicode, selectionUnicode });
  })
);

const ENTRIES_BY_GLYPH_NAME: ReadonlyMap<string, NativeMacExpertEncodingEntry> = new Map(
  ENTRIES.flatMap((entry) => entry ? [[entry.glyphName, entry] as const] : [])
);

/** Resolve one byte through the exact ISO/Adobe MacExpertEncoding vector. */
export function nativeMacExpertEncodingEntry(
  code: number
): NativeMacExpertEncodingEntry | null {
  if (!Number.isInteger(code) || code < 0 || code >= NATIVE_MAC_EXPERT_ENCODING_SIZE) {
    return null;
  }
  return ENTRIES[code];
}

/** Resolve a MacExpert glyph name, ignoring a PDF glyph-name suffix. */
export function nativeMacExpertGlyphNameEntry(
  rawName: string
): NativeMacExpertEncodingEntry | null {
  const name = rawName.split(".", 1)[0];
  return ENTRIES_BY_GLYPH_NAME.get(name) ?? null;
}

function isPrivateUseScalar(scalar: number): boolean {
  return scalar >= 0xe000 && scalar <= 0xf8ff;
}
