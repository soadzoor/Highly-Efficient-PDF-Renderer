// Small Type 1 programs assembled independently from the Adobe Type 1 Font
// Format specification, chapters 2, 6, 7 and 8:
// https://adobe-type-tools.github.io/font-tech-notes/pdfs/T1_SPEC.pdf
const encoder = new TextEncoder();

const operators = {
  hstem: [1], vstem: [3], vmoveto: [4], rlineto: [5], hlineto: [6],
  vlineto: [7], rrcurveto: [8], closepath: [9], callsubr: [10], return: [11],
  hsbw: [13], endchar: [14], rmoveto: [21], hmoveto: [22],
  vhcurveto: [30], hvcurveto: [31], dotsection: [12, 0],
  vstem3: [12, 1], hstem3: [12, 2], seac: [12, 6], sbw: [12, 7],
  div: [12, 12], callothersubr: [12, 16], pop: [12, 17],
  setcurrentpoint: [12, 33]
};

export function type1CharString(...tokens) {
  return Uint8Array.from(tokens.flatMap(token => {
    if (typeof token === "string") {
      if (!operators[token]) throw new Error(`Unknown fixture operator ${token}`);
      return operators[token];
    }
    if (!Number.isSafeInteger(token) || token < -0x80000000 || token > 0x7fffffff) {
      throw new RangeError("Type 1 charstring constants must be signed 32-bit integers.");
    }
    if (token >= -107 && token <= 107) return [token + 139];
    if (token >= 108 && token <= 1131) return [247 + ((token - 108) >> 8), (token - 108) & 255];
    if (token <= -108 && token >= -1131) return [251 + ((-token - 108) >> 8), (-token - 108) & 255];
    return [255, (token >>> 24) & 255, (token >>> 16) & 255, (token >>> 8) & 255, token & 255];
  }));
}

export function concatType1Bytes(...parts) {
  const bytes = parts.map(part => typeof part === "string" ? encoder.encode(part) : part);
  const result = new Uint8Array(bytes.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of bytes) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

export function encryptType1Bytes(plaintext, initialKey) {
  const ciphertext = new Uint8Array(plaintext.length);
  let key = initialKey;
  for (let index = 0; index < plaintext.length; index++) {
    const byte = plaintext[index] ^ (key >>> 8);
    ciphertext[index] = byte;
    key = ((byte + key) * 52845 + 22719) & 65535;
  }
  return ciphertext;
}

export function buildType1Fixture({
  fontName = "FixtureType1",
  glyphs = [
    [".notdef", type1CharString(0, 500, "hsbw", "endchar")],
    ["A", type1CharString(50, 600, "hsbw", 0, 0, "rmoveto",
      200, 0, "rlineto", 0, 300, "rlineto", -200, 0, "rlineto", "closepath", "endchar")],
    ["B", type1CharString(20, 700, "hsbw", 10, 20, "rmoveto",
      120, 0, "rlineto", 0, 80, "rlineto", "closepath", "endchar")]
  ],
  subrs = [],
  encoding = [[1, "A"], [2, "B"], [65, "A"], [66, "B"]],
  fontMatrix = [0.001, 0, 0, 0.001, 0, 0],
  lenIV = 4,
  omitLenIV = false,
  container = "binary",
  stringForm = "binary",
  clearExtra = "",
  privateExtra = "",
  paintType = 0,
  fontType = 1,
  rdName = "RD",
  ndName = "ND",
  npName = "NP"
} = {}) {
  const encodeProgram = bytes => lenIV < 0 ? bytes : encryptType1Bytes(
    concatType1Bytes(new Uint8Array(lenIV), bytes), 4330);
  const encodingProgram = typeof encoding === "string" ? `/Encoding ${encoding} def` : [
    "/Encoding 256 array",
    "0 1 255 {1 index exch /.notdef put} for",
    ...encoding.map(([code, name]) => `dup ${code} /${name} put`),
    "readonly def"
  ].join("\n");
  const cleartext = encoder.encode([
    `%!PS-AdobeFont-1.0: ${fontName} 1.0`,
    "11 dict begin",
    `/FontName /${fontName} def`,
    `/FontType ${fontType} def`,
    `/PaintType ${paintType} def`,
    `/FontMatrix [${fontMatrix.join(" ")}] readonly def`,
    "/FontBBox [0 -100 1000 1000] readonly def",
    encodingProgram,
    clearExtra,
    "currentdict end",
    "currentfile eexec\n"
  ].join("\n"));
  const privateParts = [
    "dup /Private 12 dict dup begin\n",
    `/${rdName} {string currentfile exch readstring pop} executeonly def\n`,
    `/${ndName} {noaccess def} executeonly def\n`,
    `/${npName} {noaccess put} executeonly def\n`,
    "/password 5839 def /MinFeature {16 16} def /BlueValues [] def\n",
    omitLenIV ? "" : `/lenIV ${lenIV} def\n`,
    privateExtra,
    `\n/Subrs ${subrs.length} array\n`
  ];
  const appendString = (prefix, bytes, terminator) => {
    if (stringForm === "hex") {
      privateParts.push(`${prefix}<${[...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("")}> ${terminator}\n`);
    } else if (stringForm === "literal") {
      // Octal escapes exercise the PostScript string decoder without relying
      // on an accidental absence of parentheses, backslashes or line endings.
      privateParts.push(`${prefix}(${[...bytes].map(byte => `\\${byte.toString(8).padStart(3, "0")}`).join("")}) ${terminator}\n`);
    } else {
      privateParts.push(`${prefix}${bytes.length} ${rdName} `, bytes, ` ${terminator}\n`);
    }
  };
  subrs.forEach((subr, index) => {
    if (subr === null) return;
    const bytes = encodeProgram(subr);
    appendString(`dup ${index} `, bytes, npName);
  });
  privateParts.push(`${ndName}\n`,
    `2 index /CharStrings ${glyphs.length} dict dup begin\n`);
  for (const [name, program] of glyphs) {
    const bytes = encodeProgram(program);
    appendString(`/${name} `, bytes, ndName);
  }
  privateParts.push("end readonly put\nend readonly put\ndup /FontName get exch definefont pop\nmark currentfile closefile\n");
  const privatePlaintext = concatType1Bytes(...privateParts);
  const encrypted = encryptType1Bytes(concatType1Bytes(new Uint8Array(4), privatePlaintext), 55665);
  const trailer = encoder.encode(`\n${"0".repeat(512)}\ncleartomark\n`);
  let bytes;
  let encodedEncrypted = encrypted;
  if (container === "hex") {
    const hex = [...encrypted].map(byte => byte.toString(16).padStart(2, "0")).join("");
    encodedEncrypted = encoder.encode(hex.match(/.{1,64}/g).join("\n") + "\n");
    bytes = concatType1Bytes(cleartext, encodedEncrypted, trailer);
  } else if (container === "pfb") {
    // Multiple records of both types exercise concatenation across token and
    // encrypted-byte boundaries, rather than relying on a single segment.
    bytes = concatType1Bytes(
      pfbRecord(1, cleartext.subarray(0, 37)), pfbRecord(1, cleartext.subarray(37)),
      pfbRecord(2, encrypted.subarray(0, 17)), pfbRecord(2, encrypted.subarray(17)),
      pfbRecord(1, trailer), Uint8Array.of(0x80, 3));
  } else {
    bytes = concatType1Bytes(cleartext, encrypted, trailer);
  }
  return {
    bytes, cleartext, encrypted, privatePlaintext,
    length1: cleartext.length, length2: encodedEncrypted.length, length3: trailer.length
  };
}

function pfbRecord(type, bytes) {
  const header = Uint8Array.of(0x80, type, 0, 0, 0, 0);
  new DataView(header.buffer).setUint32(2, bytes.length, true);
  return concatType1Bytes(header, bytes);
}
