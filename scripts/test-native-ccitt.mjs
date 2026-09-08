import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !specifier.endsWith(".ts")) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  }
});

const { decodeNativeCcittFax } = await import("../src/pdf/nativeCcitt.ts");

function testGroup3OneDimensional() {
  const white = decode(bits("10011"), {
    Columns: 8,
    Rows: 1,
    EndOfBlock: false
  });
  assertResult(white, [0xff], 8, 1, "rows");

  // T.4 table 2: white(0), black(8).
  const black = decode(bits("00110101 000101"), {
    Columns: 8,
    Rows: 1,
    EndOfBlock: false
  });
  assert.deepEqual([...black.bytes], [0x00]);
  assert.deepEqual(
    [...decode(bits("00110101 000101"), {
      Columns: 8,
      Rows: 1,
      EndOfBlock: false,
      BlackIs1: true
    }).bytes],
    [0xff]
  );

  // Alternating black/white pixels. Every code below is a terminating code;
  // the fixture does not reuse the decoder's private tables.
  const alternating = decode(bits(
    "00110101 " + `${"010 000111 ".repeat(4)}`
  ), {
    Columns: 8,
    Rows: 1,
    EndOfBlock: false,
    BlackIs1: true
  });
  assert.deepEqual([...alternating.bytes], [0xaa]);

  const twoRows = decode(bits("10011 00110101 000101"), {
    Columns: 8,
    Rows: 2,
    EndOfBlock: false
  });
  assertResult(twoRows, [0xff, 0x00], 8, 2, "rows");

  // Rows=0 is terminated by physical EOD when EndOfBlock is false.
  const physicalEnd = decode(bits("10011 00110101 000101"), {
    Columns: 8,
    EndOfBlock: false
  });
  assertResult(physicalEnd, [0xff, 0x00], 8, 2, "end-of-data");
}

function testCompleteHuffmanTables() {
  assert.equal(WHITE_TERMINATING.length, 64);
  assert.equal(BLACK_TERMINATING.length, 64);

  for (let run = 0; run < 64; run += 1) {
    const whiteSource = run === 0
      ? `${WHITE_TERMINATING[0]} ${BLACK_TERMINATING[1]}`
      : WHITE_TERMINATING[run];
    const whiteWidth = Math.max(1, run);
    const whiteExpected = run === 0
      ? packedSolid(1, true)
      : packedSolid(run, false);
    assert.deepEqual(
      [...decode(bits(whiteSource), {
        Columns: whiteWidth,
        Rows: 1,
        EndOfBlock: false,
        BlackIs1: true
      }).bytes],
      whiteExpected,
      `white terminating run ${run}`
    );

    const blackSource = run === 0
      ? `${WHITE_TERMINATING[0]} ${BLACK_TERMINATING[0]} ${WHITE_TERMINATING[1]}`
      : `${WHITE_TERMINATING[0]} ${BLACK_TERMINATING[run]}`;
    assert.deepEqual(
      [...decode(bits(blackSource), {
        Columns: Math.max(1, run),
        Rows: 1,
        EndOfBlock: false,
        BlackIs1: true
      }).bytes],
      run === 0 ? packedSolid(1, false) : packedSolid(run, true),
      `black terminating run ${run}`
    );
  }

  for (const [run, code] of WHITE_MAKEUP_VECTORS) {
    assert.deepEqual(
      [...decode(bits(`${code} ${WHITE_TERMINATING[0]}`), {
        Columns: run,
        Rows: 1,
        EndOfBlock: false,
        BlackIs1: true
      }).bytes],
      packedSolid(run, false),
      `white makeup run ${run}`
    );
  }
  for (const [run, code] of BLACK_MAKEUP_VECTORS) {
    assert.deepEqual(
      [...decode(bits(
        `${WHITE_TERMINATING[0]} ${code} ${BLACK_TERMINATING[0]}`
      ), {
        Columns: run,
        Rows: 1,
        EndOfBlock: false,
        BlackIs1: true
      }).bytes],
      packedSolid(run, true),
      `black makeup run ${run}`
    );
  }
  for (const [run, code] of SHARED_MAKEUP_VECTORS) {
    assert.deepEqual(
      [...decode(bits(`${code} ${WHITE_TERMINATING[0]}`), {
        Columns: run,
        Rows: 1,
        EndOfBlock: false,
        BlackIs1: true
      }).bytes],
      packedSolid(run, false),
      `shared white makeup run ${run}`
    );
    assert.deepEqual(
      [...decode(bits(
        `${WHITE_TERMINATING[0]} ${code} ${BLACK_TERMINATING[0]}`
      ), {
        Columns: run,
        Rows: 1,
        EndOfBlock: false,
        BlackIs1: true
      }).bytes],
      packedSolid(run, true),
      `shared black makeup run ${run}`
    );
  }
}

function testMakeupAndPackedRows() {
  // T.4 table 3a: white makeup 64 followed by white terminating 0.
  assert.deepEqual(
    [...decode(bits("11011 00110101"), {
      Columns: 64,
      Rows: 1,
      EndOfBlock: false
    }).bytes],
    Array(8).fill(0xff)
  );

  // Black makeup 64 plus its required terminating 0.
  assert.deepEqual(
    [...decode(bits("00110101 0000001111 0000110111"), {
      Columns: 64,
      Rows: 1,
      EndOfBlock: false
    }).bytes],
    Array(8).fill(0x00)
  );

  // T.4 table 3b permits repeated 2560 makeup codes for long runs.
  const longWhite = decode(bits("000000011111 11011 00110101"), {
    Columns: 2624,
    Rows: 1,
    EndOfBlock: false
  });
  assert.equal(longWhite.bytes.length, 328);
  assert.ok(longWhite.bytes.every((value) => value === 0xff));

  // Packed rows are MSB-first and unused low bits are deterministically zero.
  assert.deepEqual(
    [...decode(bits("1100"), {
      Columns: 5,
      Rows: 1,
      EndOfBlock: false
    }).bytes],
    [0xf8]
  );
  assert.deepEqual(
    [...decode(bits("1100"), {
      Columns: 5,
      Rows: 1,
      EndOfBlock: false,
      BlackIs1: true
    }).bytes],
    [0x00]
  );
}

function testEolRtcAndByteAlignment() {
  const eol = "000000000001";
  const rtc = eol.repeat(6);
  const framed = decode(bits(`${eol} 1100 ${rtc}`), {
    Columns: 5,
    EndOfLine: true,
    EndOfBlock: true
  });
  assertResult(framed, [0xf8], 5, 1, "end-of-block");
  assert.equal(framed.bitsConsumed % 8, 0);

  // EOL must also be accepted when EndOfLine is false.
  assert.deepEqual(
    [...decode(bits(`${eol} 1100 ${rtc}`), {
      Columns: 5,
      EndOfBlock: true
    }).bytes],
    [0xf8]
  );

  // EOL + white(1) ends at bit 18. Six zero fill bits align the following RTC.
  const aligned = decode(bits(`${eol} 000111 000000 ${rtc}`), {
    Columns: 1,
    EndOfLine: true,
    EncodedByteAlign: true,
    EndOfBlock: true
  });
  assertResult(aligned, [0x80], 1, 1, "end-of-block");

  assert.throws(
    () => decode(bits("000111 10 000111"), {
      Columns: 1,
      Rows: 2,
      EncodedByteAlign: true,
      EndOfBlock: false
    }),
    hasPdfError("invalid-object", /nonzero bit/)
  );
}

function testMixedGroup3() {
  const eol = "000000000001";
  const oneDimensional = "0111 011 0111"; // white(2), black(4), white(2)
  const twoDimensional = "1 1 1"; // V(0), V(0), V(0)
  const rtc = `${eol}1`.repeat(6);
  const mixed = decode(bits(
    `${eol}1 ${oneDimensional} ${eol}0 ${twoDimensional} ${rtc}`
  ), {
    K: 2,
    Columns: 8,
    EndOfLine: true,
    EndOfBlock: true
  });
  assertResult(mixed, [0xc3, 0xc3], 8, 2, "end-of-block");
  assert.deepEqual(
    [...decode(bits(`${eol}1 ${oneDimensional} ${eol}0 ${twoDimensional} ${rtc}`), {
      K: 99,
      Columns: 8,
      EndOfLine: true,
      EndOfBlock: true
    }).bytes],
    [...mixed.bytes],
    "PDF decoders distinguish only the sign of positive K values"
  );

  const unframed = decode(bits(`1 ${oneDimensional} 0 ${twoDimensional}`), {
    K: 1,
    Columns: 8,
    Rows: 2,
    EndOfBlock: false
  });
  assertResult(unframed, [0xc3, 0xc3], 8, 2, "rows");

  assert.throws(
    () => decode(bits(`${eol}0 1 ${rtc}`), {
      K: 1,
      Columns: 8,
      EndOfLine: true,
      EndOfBlock: true
    }),
    hasPdfError("invalid-object", /first mixed Group 3 row/)
  );
}

function testGroup4ModesAndEofb() {
  const eofb = "000000000001000000000001";

  const empty = decode(bits(eofb), { K: -1, Columns: 8, EndOfBlock: true });
  assertResult(empty, [], 8, 0, "end-of-block");

  const byteAligned = decode(bits(`1 0000000 1 0000000 ${eofb}`), {
    K: -1,
    Columns: 1,
    EncodedByteAlign: true,
    EndOfBlock: true
  });
  assertResult(byteAligned, [0x80, 0x80], 1, 2, "end-of-block");

  // First row: H + white(0) + black(8). Second row uses V(0) twice.
  const blackRows = decode(bits(
    `001 00110101 000101 1 1 ${eofb}`
  ), { K: -1, Columns: 8, EndOfBlock: true });
  assertResult(blackRows, [0x00, 0x00], 8, 2, "end-of-block");

  // Reference row has black spans [0,2) and [4,6). The next all-white row
  // crosses both reference spans with two pass modes, then V(0) to Columns.
  const pass = decode(bits(
    `001 00110101 11 001 0111 11 1 0001 0001 1 ${eofb}`
  ), { K: -1, Columns: 8, EndOfBlock: true, BlackIs1: true });
  assertResult(pass, [0xcc, 0x00], 8, 2, "end-of-block");

  // Exercise all six nonzero vertical modes. The black interval changes as:
  // [4,12), [5,13), [3,11), [6,14), [5,13), [7,15), [4,12).
  // The interval stays wider than the displacement, keeping each b1 strictly
  // ahead of a0 as required by the normative two-dimensional algorithm.
  const horizontalReference = "001 1011 000101 1";
  const verticalRows = [
    "011 011 1",             // V_R(1)
    "000010 000010 1",       // V_L(2)
    "0000011 0000011 1",     // V_R(3)
    "010 010 1",             // V_L(1)
    "000011 000011 1",       // V_R(2)
    "0000010 0000010 1"      // V_L(3)
  ].join(" ");
  const vertical = decode(bits(`${horizontalReference} ${verticalRows} ${eofb}`), {
    K: -1,
    Columns: 24,
    EndOfBlock: true,
    BlackIs1: true
  });
  assert.deepEqual([...vertical.bytes], [
    0x0f, 0xf0, 0x00,
    0x07, 0xf8, 0x00,
    0x1f, 0xe0, 0x00,
    0x03, 0xfc, 0x00,
    0x07, 0xf8, 0x00,
    0x01, 0xfe, 0x00,
    0x0f, 0xf0, 0x00
  ]);

  // T.6 defines b1 as the first changing element on the reference line
  // strictly to the right of a0, where a0 starts every row on the imaginary
  // changing element positioned just before column 0. Here the reference row
  // changes to black exactly at column 3 and the coding row reaches column 3
  // in white, so b1 must skip that coincident element rather than return a0
  // itself. Reference row: H + white(3) + black(1) + V(0), black span [3,4).
  // Coding row: V_L(2), V_L(1), V_L(1), V(0), black spans [1,3) and [7,8).
  const coincidentReferenceElement = decode(bits(
    `001 1000 010 1 000010 010 010 1 ${eofb}`
  ), { K: -1, Columns: 8, EndOfBlock: true, BlackIs1: true });
  assertResult(coincidentReferenceElement, [0x10, 0x61], 8, 2, "end-of-block");

  assert.throws(
    () => decode(bits("1"), { K: -1, Columns: 8, EndOfBlock: true }),
    hasPdfError("invalid-object", /without an EOFB/)
  );
  assert.throws(
    () => decode(bits(`0000001 000 ${eofb}`), {
      K: -1,
      Columns: 8,
      EndOfBlock: true
    }),
    hasPdfError("unsupported-filter", /extension/)
  );
}

function testDamagedRowRecovery() {
  const eol = "000000000001";
  const black = "00110101 000101";
  const damaged = "00000000";

  const recovered = decode(bits(`${eol} ${damaged} ${eol} ${black}`), {
    Columns: 8,
    Rows: 2,
    EndOfLine: true,
    EndOfBlock: false,
    DamagedRowsBeforeError: 1
  });
  assertResult(recovered, [0xff, 0x00], 8, 2, "rows");
  assert.equal(recovered.damagedRows, 1);

  // A damaged row copies the preceding good row. A second consecutive damaged
  // row would instead use white, as required by PDF table 11.
  const copied = decode(bits(
    `${eol} ${black} ${eol} ${damaged} ${eol} 10011`
  ), {
    Columns: 8,
    Rows: 3,
    EndOfLine: true,
    EndOfBlock: false,
    DamagedRowsBeforeError: 1
  });
  assert.deepEqual([...copied.bytes], [0x00, 0x00, 0xff]);

  const consecutive = decode(bits(
    `${eol} ${damaged} ${eol} ${damaged} ${eol} ${black}`
  ), {
    Columns: 8,
    Rows: 3,
    EndOfLine: true,
    EndOfBlock: false,
    DamagedRowsBeforeError: 2
  });
  assert.deepEqual([...consecutive.bytes], [0xff, 0xff, 0x00]);
  assert.equal(consecutive.damagedRows, 2);

  assert.throws(
    () => decode(bits(`${eol} ${damaged} ${eol} ${black}`), {
      Columns: 8,
      Rows: 2,
      EndOfLine: true,
      EndOfBlock: false
    }),
    hasPdfError("invalid-object", /Malformed CCITT white run code/)
  );
  assert.throws(
    () => decode(bits(`${eol} ${damaged} ${eol} ${damaged} ${eol} ${black}`), {
      Columns: 8,
      Rows: 3,
      EndOfLine: true,
      EndOfBlock: false,
      DamagedRowsBeforeError: 1
    }),
    hasPdfError("invalid-object", /tolerance was exceeded/)
  );
}

function testMalformedInputs() {
  assert.throws(
    () => decode(bits("10011"), { Columns: 4, Rows: 1, EndOfBlock: false }),
    hasPdfError("invalid-object", /oversubscribes/)
  );
  assert.throws(
    () => decode(bits("00000000"), { Columns: 8, Rows: 1, EndOfBlock: false }),
    hasPdfError("invalid-object", /Truncated CCITT white run code/)
  );
  assert.throws(
    () => decode(bits("000000001 111"), { Columns: 8, Rows: 1, EndOfBlock: false }),
    hasPdfError("unsupported-filter", /one-dimensional extension/)
  );
  assert.throws(
    () => decode(bits("00000001"), { Columns: 8, Rows: 1, EndOfBlock: false }),
    hasPdfError("invalid-object", /Truncated CCITT white run code/)
  );
  assert.throws(
    () => decode(bits("10011"), {
      Columns: 8,
      Rows: 1,
      EndOfLine: true,
      EndOfBlock: false
    }),
    hasPdfError("invalid-object", /missing its required EOL/)
  );
  assert.throws(
    () => decode(new Uint8Array(0), { K: -1, EndOfLine: true }),
    hasPdfError("invalid-object", /not defined for Group 4/)
  );
  assert.throws(
    () => decode(new Uint8Array(0), {
      K: -1,
      DamagedRowsBeforeError: 1
    }),
    hasPdfError("invalid-object", /requires EndOfLine/)
  );
  assert.throws(
    () => decode(new Uint8Array(0), { Columns: 0 }),
    hasPdfError("invalid-object", /Columns/)
  );
  assert.throws(
    () => decode(new Uint8Array(0), { Rows: -1 }),
    hasPdfError("invalid-object", /Rows/)
  );
  assert.throws(
    () => decode(new Uint8Array(0), { EndOfBlock: "yes" }),
    hasPdfError("invalid-object", /EndOfBlock/)
  );
}

function testLimitsAndCancellation() {
  assert.throws(
    () => decode(new Uint8Array(0), { Columns: 9 }, {
      limits: { maxColumns: 8 }
    }),
    hasPdfError("resource-limit", /dimension ceiling/)
  );
  assert.throws(
    () => decode(bits("10011"), { Columns: 8, Rows: 2, EndOfBlock: false }, {
      limits: { maxPixels: 8 }
    }),
    hasPdfError("resource-limit", /pixel count/)
  );
  assert.throws(
    () => decode(bits("10011"), { Columns: 9, Rows: 1, EndOfBlock: false }, {
      limits: { maxOutputBytes: 1 }
    }),
    hasPdfError("resource-limit", /byte ceiling/)
  );
  assert.throws(
    () => decode(Uint8Array.of(0), { EndOfBlock: false }, {
      limits: { maxScanBits: 7 }
    }),
    hasPdfError("resource-limit", /scan ceiling/)
  );
  assert.throws(
    () => decode(bits("00110101 010 000111 010 000111"), {
      Columns: 4,
      Rows: 1,
      EndOfBlock: false
    }, {
      limits: { maxTransitions: 2 }
    }),
    hasPdfError("resource-limit", /transition work/)
  );
  assert.throws(
    () => decode(bits("10011 10011"), { Columns: 8, EndOfBlock: false }, {
      limits: { maxRows: 1 }
    }),
    hasPdfError("resource-limit", /row count/)
  );
  assert.throws(
    () => decode(new Uint8Array(0), {
      EndOfLine: true,
      DamagedRowsBeforeError: 2
    }, {
      limits: { maxDamagedRows: 1 }
    }),
    hasPdfError("resource-limit", /tolerance exceeds/)
  );
  assert.throws(
    () => decode(new Uint8Array(0), {}, { limits: { maxRows: 0 } }),
    RangeError
  );

  const controller = new AbortController();
  controller.abort(new Error("fixture cancellation"));
  assert.throws(
    () => decode(bits("10011"), { Columns: 8, Rows: 1, EndOfBlock: false }, {
      signal: controller.signal
    }),
    hasPdfError("aborted", /aborted/)
  );

  let cancellationPolls = 0;
  const midDecodeSignal = {
    get aborted() {
      cancellationPolls += 1;
      return cancellationPolls >= 4;
    },
    reason: new Error("mid-decode fixture cancellation")
  };
  assert.throws(
    () => decode(bits(
      `${WHITE_TERMINATING[0]} 000000011111 0000001111 ${BLACK_TERMINATING[0]}`
    ), {
      Columns: 2624,
      Rows: 1,
      EndOfBlock: false
    }, {
      signal: midDecodeSignal
    }),
    hasPdfError("aborted", /aborted/)
  );
}

function testDeterministicMutations() {
  let state = 0x63_43_49_54;
  for (let fixture = 0; fixture < 256; fixture += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const input = new Uint8Array(1 + (state & 7));
    for (let index = 0; index < input.length; index += 1) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      input[index] = state >>> 24;
    }
    const parameters = {
      K: fixture % 3 - 1,
      Columns: 1 + (fixture % 64),
      Rows: 1,
      EndOfBlock: false
    };
    const first = captureDecode(input, parameters);
    const second = captureDecode(input, parameters);
    assert.deepEqual(second, first, `mutation ${fixture} must be deterministic`);
  }
}

function captureDecode(input, parameters) {
  try {
    const result = decode(input, parameters, {
      limits: { maxScanBits: 4096, maxTransitions: 4096 }
    });
    return {
      ok: true,
      rows: result.rows,
      bytes: [...result.bytes],
      bitsConsumed: result.bitsConsumed,
      terminatedBy: result.terminatedBy
    };
  } catch (error) {
    assert.equal(error?.name, "PdfError");
    return {
      ok: false,
      code: error.code,
      message: error.message,
      offset: error.offset ?? null,
      details: error.details ?? null
    };
  }
}

function decode(input, parameters, options) {
  return decodeNativeCcittFax(input, parameters, options);
}

function bits(source) {
  const normalized = source.replace(/\s+/g, "");
  assert.match(normalized, /^[01]*$/);
  const output = new Uint8Array(Math.ceil(normalized.length / 8));
  for (let index = 0; index < normalized.length; index += 1) {
    if (normalized.charCodeAt(index) === 49) output[index >>> 3] |= 1 << (7 - (index & 7));
  }
  return output;
}

function assertResult(result, bytes, columns, rows, terminatedBy) {
  assert.deepEqual([...result.bytes], bytes);
  assert.equal(result.columns, columns);
  assert.equal(result.rows, rows);
  assert.equal(result.rowStride, Math.ceil(columns / 8));
  assert.equal(result.terminatedBy, terminatedBy);
}

function packedSolid(columns, black) {
  const output = Array(Math.ceil(columns / 8)).fill(black ? 0xff : 0x00);
  if (black && columns % 8 !== 0) {
    output[output.length - 1] &= (0xff << (8 - (columns % 8))) & 0xff;
  }
  return output;
}

function hasPdfError(code, message) {
  return (error) => {
    assert.equal(error?.name, "PdfError");
    assert.equal(error?.code, code);
    assert.match(error?.message ?? "", message);
    return true;
  };
}

// Independent transcription of ITU-T T.4 tables 2, 3a, and 3b. The tests
// associate each code word with an expected pixel run, so a swapped or mistyped
// decoder entry fails even when its prefix remains syntactically valid.
const WHITE_TERMINATING = [
  "00110101", "000111", "0111", "1000", "1011", "1100", "1110", "1111",
  "10011", "10100", "00111", "01000", "001000", "000011", "110100", "110101",
  "101010", "101011", "0100111", "0001100", "0001000", "0010111", "0000011",
  "0000100", "0101000", "0101011", "0010011", "0100100", "0011000", "00000010",
  "00000011", "00011010", "00011011", "00010010", "00010011", "00010100",
  "00010101", "00010110", "00010111", "00101000", "00101001", "00101010",
  "00101011", "00101100", "00101101", "00000100", "00000101", "00001010",
  "00001011", "01010010", "01010011", "01010100", "01010101", "00100100",
  "00100101", "01011000", "01011001", "01011010", "01011011", "01001010",
  "01001011", "00110010", "00110011", "00110100"
];

const BLACK_TERMINATING = [
  "0000110111", "010", "11", "10", "011", "0011", "0010", "00011",
  "000101", "000100", "0000100", "0000101", "0000111", "00000100", "00000111",
  "000011000", "0000010111", "0000011000", "0000001000", "00001100111",
  "00001101000", "00001101100", "00000110111", "00000101000", "00000010111",
  "00000011000", "000011001010", "000011001011", "000011001100", "000011001101",
  "000001101000", "000001101001", "000001101010", "000001101011", "000011010010",
  "000011010011", "000011010100", "000011010101", "000011010110", "000011010111",
  "000001101100", "000001101101", "000011011010", "000011011011", "000001010100",
  "000001010101", "000001010110", "000001010111", "000001100100", "000001100101",
  "000001010010", "000001010011", "000000100100", "000000110111", "000000111000",
  "000000100111", "000000101000", "000001011000", "000001011001", "000000101011",
  "000000101100", "000001011010", "000001100110", "000001100111"
];

const WHITE_MAKEUP_VECTORS = [
  [64, "11011"], [128, "10010"], [192, "010111"], [256, "0110111"],
  [320, "00110110"], [384, "00110111"], [448, "01100100"], [512, "01100101"],
  [576, "01101000"], [640, "01100111"], [704, "011001100"], [768, "011001101"],
  [832, "011010010"], [896, "011010011"], [960, "011010100"], [1024, "011010101"],
  [1088, "011010110"], [1152, "011010111"], [1216, "011011000"], [1280, "011011001"],
  [1344, "011011010"], [1408, "011011011"], [1472, "010011000"], [1536, "010011001"],
  [1600, "010011010"], [1664, "011000"], [1728, "010011011"]
];

const BLACK_MAKEUP_VECTORS = [
  [64, "0000001111"], [128, "000011001000"], [192, "000011001001"],
  [256, "000001011011"], [320, "000000110011"], [384, "000000110100"],
  [448, "000000110101"], [512, "0000001101100"], [576, "0000001101101"],
  [640, "0000001001010"], [704, "0000001001011"], [768, "0000001001100"],
  [832, "0000001001101"], [896, "0000001110010"], [960, "0000001110011"],
  [1024, "0000001110100"], [1088, "0000001110101"], [1152, "0000001110110"],
  [1216, "0000001110111"], [1280, "0000001010010"], [1344, "0000001010011"],
  [1408, "0000001010100"], [1472, "0000001010101"], [1536, "0000001011010"],
  [1600, "0000001011011"], [1664, "0000001100100"], [1728, "0000001100101"]
];

const SHARED_MAKEUP_VECTORS = [
  [1792, "00000001000"], [1856, "00000001100"], [1920, "00000001101"],
  [1984, "000000010010"], [2048, "000000010011"], [2112, "000000010100"],
  [2176, "000000010101"], [2240, "000000010110"], [2304, "000000010111"],
  [2368, "000000011100"], [2432, "000000011101"], [2496, "000000011110"],
  [2560, "000000011111"]
];

try {
  testGroup3OneDimensional();
  testCompleteHuffmanTables();
  testMakeupAndPackedRows();
  testEolRtcAndByteAlignment();
  testMixedGroup3();
  testGroup4ModesAndEofb();
  testDamagedRowRecovery();
  testMalformedInputs();
  testLimitsAndCancellation();
  testDeterministicMutations();
} finally {
  hooks.deregister();
}

console.log("native CCITTFaxDecode tests passed");
