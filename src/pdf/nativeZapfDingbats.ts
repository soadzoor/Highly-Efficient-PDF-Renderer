/**
 * Compact ITC Zapf Dingbats glyph-name shard.
 *
 * Generated from Adobe's `zapfdingbats.txt`, table version 2.0, pinned at
 * commit 4036a9ca80a62f64f9de4f7321a9a045ad0ecfd6. Entry N maps glyph name
 * `aN`; zero denotes an intentionally unmapped name. Adobe's BSD-3-Clause
 * notice is reproduced in THIRD_PARTY_NOTICES.
 */
const CODE_POINTS = Uint16Array.from(
  (
  "2701,2702,2704,260E,2706,271D,271E,271F,2720,2721,261B,261E,270C,270D,270E,270F," +
  "2711,2712,2713,2714,2715,2716,2717,2718,2719,271A,271B,271C,2722,2723,2724,2725," +
  "2726,2727,2605,2729,272A,272B,272C,272D,272E,272F,2730,2731,2732,2733,2734,2735," +
  "2736,2737,2738,2739,273A,273B,273C,273D,273E,273F,2740,2741,2742,2743,2744,2745," +
  "2746,2747,2748,2749,274A,274B,25CF,274D,25A0,274F,2751,25B2,25BC,25C6,2756,0," +
  "25D7,2758,2759,275A,276F,2771,2772,2773,2768,2769,276C,276D,276A,276B,2774,2775," +
  "275B,275C,275D,275E,2761,2762,2763,2764,2710,2765,2766,2767,2660,2665,2666,2663," +
  "0,0,0,0,2709,2708,2707,2460,2461,2462,2463,2464,2465,2466,2467,2468,2469,2776," +
  "2777,2778,2779,277A,277B,277C,277D,277E,277F,2780,2781,2782,2783,2784,2785,2786," +
  "2787,2788,2789,278A,278B,278C,278D,278E,278F,2790,2791,2792,2793,2794,2192,27A3," +
  "2194,2195,2799,279B,279C,279D,279E,279F,27A0,27A1,27A2,27A4,27A5,27A6,27A7,27A8," +
  "27A9,27AB,27AD,27AF,27B2,27B3,27B5,27B8,27BA,27BB,27BC,27BD,27BE,279A,27AA,27B6," +
  "27B9,2798,27B4,27B7,27AC,27AE,27B1,2703,2750,2752,276E,2770"
  ).split(","),
  (value) => Number.parseInt(value, 16)
);

// ISO 32000 Appendix D's ZapfDingbats encoding, stored from code 32 onward.
const ENCODING = (
  "space,a1,a2,a202,a3,a4,a5,a119,a118,a117,a11,a12,a13,a14,a15,a16,a105,a17,a18,a19," +
  "a20,a21,a22,a23,a24,a25,a26,a27,a28,a6,a7,a8,a9,a10,a29,a30,a31,a32,a33,a34,a35," +
  "a36,a37,a38,a39,a40,a41,a42,a43,a44,a45,a46,a47,a48,a49,a50,a51,a52,a53,a54,a55," +
  "a56,a57,a58,a59,a60,a61,a62,a63,a64,a65,a66,a67,a68,a69,a70,a71,a72,a73,a74,a203," +
  "a75,a204,a76,a77,a78,a79,a81,a82,a83,a84,a97,a98,a99,a100,_,a89,a90,a93,a94,a91," +
  "a92,a205,a85,a206,a86,a87,a88,a95,a96,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_," +
  "a101,a102,a103,a104,a106,a107,a108,a112,a111,a110,a109,a120,a121,a122,a123,a124," +
  "a125,a126,a127,a128,a129,a130,a131,a132,a133,a134,a135,a136,a137,a138,a139,a140," +
  "a141,a142,a143,a144,a145,a146,a147,a148,a149,a150,a151,a152,a153,a154,a155,a156," +
  "a157,a158,a159,a160,a161,a163,a164,a196,a165,a192,a166,a167,a168,a169,a170,a171," +
  "a172,a173,a162,a174,a175,a176,a177,a178,a179,a193,a180,a199,a181,a200,a182,_,a201," +
  "a183,a184,a197,a185,a194,a198,a186,a195,a187,a188,a189,a190,a191,_"
).split(",");

export function zapfDingbatEncodingGlyphName(code: number): string | null {
  if (!Number.isInteger(code) || code < 32 || code >= 32 + ENCODING.length) return null;
  const name = ENCODING[code - 32];
  return name === "_" ? null : name;
}

/** Map an Adobe Zapf glyph name (`a1` ... `a206`) to Unicode. */
export function zapfDingbatGlyphNameToUnicode(rawName: string): string | null {
  const name = rawName.split(".", 1)[0];
  const match = /^a([1-9][0-9]{0,2})$/.exec(name);
  if (!match) return null;
  const index = Number(match[1]) - 1;
  if (index < 0 || index >= CODE_POINTS.length) return null;
  const codePoint = CODE_POINTS[index];
  return codePoint === 0 ? null : String.fromCodePoint(codePoint);
}
