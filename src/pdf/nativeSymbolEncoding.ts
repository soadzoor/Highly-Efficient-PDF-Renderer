/**
 * Compact ISO 32000 Symbol encoding and Adobe Glyph List shard.
 *
 * The name-to-Unicode values were generated from Adobe `glyphlist.txt` at
 * commit 4036a9ca80a62f64f9de4f7321a9a045ad0ecfd6. The separate selection
 * scalar replaces historical AGL private-use construction glyphs only when
 * selecting an outline from a modern Unicode substitute. Text semantics keep
 * the canonical Adobe mapping.
 */
const NAMES = (
  "space,exclam,universal,numbersign,existential,percent,ampersand,suchthat,parenleft," +
  "parenright,asteriskmath,plus,comma,minus,period,slash,zero,one,two,three,four,five," +
  "six,seven,eight,nine,colon,semicolon,less,equal,greater,question,congruent,Alpha,Beta," +
  "Chi,Delta,Epsilon,Phi,Gamma,Eta,Iota,theta1,Kappa,Lambda,Mu,Nu,Omicron,Pi,Theta,Rho," +
  "Sigma,Tau,Upsilon,sigma1,Omega,Xi,Psi,Zeta,bracketleft,therefore,bracketright," +
  "perpendicular,underscore,radicalex,alpha,beta,chi,delta,epsilon,phi,gamma,eta,iota," +
  "phi1,kappa,lambda,mu,nu,omicron,pi,theta,rho,sigma,tau,upsilon,omega1,omega,xi,psi," +
  "zeta,braceleft,bar,braceright,similar,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_," +
  "_,_,_,_,_,_,_,_,_,_,_,_,_,Euro,Upsilon1,minute,lessequal,fraction,infinity,florin," +
  "club,diamond,heart,spade,arrowboth,arrowleft,arrowup,arrowright,arrowdown,degree," +
  "plusminus,second,greaterequal,multiply,proportional,partialdiff,bullet,divide,notequal," +
  "equivalence,approxequal,ellipsis,arrowvertex,arrowhorizex,carriagereturn,aleph,Ifraktur," +
  "Rfraktur,weierstrass,circlemultiply,circleplus,emptyset,intersection,union," +
  "propersuperset,reflexsuperset,notsubset,propersubset,reflexsubset,element,notelement," +
  "angle,gradient,registerserif,copyrightserif,trademarkserif,product,radical,dotmath," +
  "logicalnot,logicaland,logicalor,arrowdblboth,arrowdblleft,arrowdblup,arrowdblright," +
  "arrowdbldown,lozenge,angleleft,registersans,copyrightsans,trademarksans,summation," +
  "parenlefttp,parenleftex,parenleftbt,bracketlefttp,bracketleftex,bracketleftbt," +
  "bracelefttp,braceleftmid,braceleftbt,braceex,_,angleright,integral,integraltp," +
  "integralex,integralbt,parenrighttp,parenrightex,parenrightbt,bracketrighttp," +
  "bracketrightex,bracketrightbt,bracerighttp,bracerightmid,bracerightbt,_"
).split(",");

const UNICODE = Uint16Array.from(
  (
    "0020,0021,2200,0023,2203,0025,0026,220B,0028,0029,2217,002B,002C,2212,002E,002F," +
    "0030,0031,0032,0033,0034,0035,0036,0037,0038,0039,003A,003B,003C,003D,003E,003F," +
    "2245,0391,0392,03A7,2206,0395,03A6,0393,0397,0399,03D1,039A,039B,039C,039D,039F," +
    "03A0,0398,03A1,03A3,03A4,03A5,03C2,2126,039E,03A8,0396,005B,2234,005D,22A5,005F," +
    "F8E5,03B1,03B2,03C7,03B4,03B5,03C6,03B3,03B7,03B9,03D5,03BA,03BB,00B5,03BD,03BF," +
    "03C0,03B8,03C1,03C3,03C4,03C5,03D6,03C9,03BE,03C8,03B6,007B,007C,007D,223C," +
    "0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0," +
    "20AC,03D2,2032,2264,2044,221E,0192,2663,2666,2665,2660,2194,2190,2191,2192,2193," +
    "00B0,00B1,2033,2265,00D7,221D,2202,2022,00F7,2260,2261,2248,2026,F8E6,F8E7,21B5," +
    "2135,2111,211C,2118,2297,2295,2205,2229,222A,2283,2287,2284,2282,2286,2208,2209," +
    "2220,2207,F6DA,F6D9,F6DB,220F,221A,22C5,00AC,2227,2228,21D4,21D0,21D1,21D2,21D3," +
    "25CA,2329,F8E8,F8E9,F8EA,2211,F8EB,F8EC,F8ED,F8EE,F8EF,F8F0,F8F1,F8F2,F8F3,F8F4," +
    "0,232A,222B,2320,F8F5,2321,F8F6,F8F7,F8F8,F8F9,F8FA,F8FB,F8FC,F8FD,F8FE,0"
  ).split(","),
  (value) => Number.parseInt(value, 16)
);

const SUBSTITUTE_SELECTION: Readonly<Record<number, number>> = Object.freeze({
  0xf8e5: 0x23b7,
  0xf8e6: 0x23d0,
  0xf8e7: 0x23af,
  0xf6da: 0x00ae,
  0xf6d9: 0x00a9,
  0xf6db: 0x2122,
  0xf8e8: 0x00ae,
  0xf8e9: 0x00a9,
  0xf8ea: 0x2122,
  0xf8eb: 0x239b,
  0xf8ec: 0x239c,
  0xf8ed: 0x239d,
  0xf8ee: 0x23a1,
  0xf8ef: 0x23a2,
  0xf8f0: 0x23a3,
  0xf8f1: 0x23a7,
  0xf8f2: 0x23a8,
  0xf8f3: 0x23a9,
  0xf8f4: 0x23aa,
  0xf8f5: 0x23ae,
  0xf8f6: 0x239e,
  0xf8f7: 0x239f,
  0xf8f8: 0x23a0,
  0xf8f9: 0x23a4,
  0xf8fa: 0x23a5,
  0xf8fb: 0x23a6,
  0xf8fc: 0x23ab,
  0xf8fd: 0x23ac,
  0xf8fe: 0x23ad
});

export interface NativeSymbolEncodingEntry {
  readonly glyphName: string;
  readonly unicode: string;
  readonly selectionUnicode: string;
}

export function nativeSymbolEncodingEntry(code: number): NativeSymbolEncodingEntry | null {
  if (!Number.isInteger(code) || code < 32 || code >= 32 + NAMES.length) return null;
  return entryAt(code - 32);
}

export function nativeSymbolGlyphNameEntry(rawName: string): NativeSymbolEncodingEntry | null {
  const name = rawName.split(".", 1)[0];
  return entryAt(NAMES.indexOf(name));
}

function entryAt(index: number): NativeSymbolEncodingEntry | null {
  if (index < 0 || index >= NAMES.length) return null;
  const glyphName = NAMES[index];
  const scalar = UNICODE[index];
  if (glyphName === "_" || scalar === 0) return null;
  return {
    glyphName,
    unicode: String.fromCodePoint(scalar),
    selectionUnicode: String.fromCodePoint(SUBSTITUTE_SELECTION[scalar] ?? scalar)
  };
}
