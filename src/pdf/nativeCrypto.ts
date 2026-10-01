/**
 * Dependency-free cryptographic primitives required by the PDF Standard
 * security handler (ISO 32000-2, 7.6.4): MD5, RC4, AES-128/256-CBC and
 * SHA-256/384/512. They run synchronously on the parser worker, which has no
 * guaranteed WebCrypto (insecure contexts) and needs unpadded AES modes that
 * WebCrypto does not expose.
 *
 * These implementations only decrypt documents; they are not hardened against
 * timing side channels and must not be used for secret-protecting work.
 */

const MD5_SHIFTS = new Uint8Array([
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
]);

// RFC 1321: T[i] = floor(abs(sin(i + 1)) * 2^32).
const MD5_TABLE = Int32Array.from({ length: 64 }, (_, index) =>
  (Math.abs(Math.sin(index + 1)) * 0x1_0000_0000) | 0);

/** RFC 1321 MD5 of the concatenated parts. */
export function md5(...parts: readonly Uint8Array[]): Uint8Array {
  const input = concatBytes(parts);
  const paddedLength = ((input.length + 72) >>> 6) << 6;
  const padded = new Uint8Array(paddedLength);
  padded.set(input);
  padded[input.length] = 0x80;
  const bitLength = input.length * 8;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, bitLength >>> 0, true);
  view.setUint32(paddedLength - 4, Math.floor(bitLength / 0x1_0000_0000), true);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89 | 0;
  let h2 = 0x98badcfe | 0;
  let h3 = 0x10325476;
  const words = new Int32Array(16);
  for (let block = 0; block < paddedLength; block += 64) {
    for (let index = 0; index < 16; index += 1) words[index] = view.getInt32(block + index * 4, true);
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    for (let index = 0; index < 64; index += 1) {
      let f: number;
      let g: number;
      if (index < 16) {
        f = (b & c) | (~b & d);
        g = index;
      } else if (index < 32) {
        f = (d & b) | (~d & c);
        g = (5 * index + 1) & 15;
      } else if (index < 48) {
        f = b ^ c ^ d;
        g = (3 * index + 5) & 15;
      } else {
        f = c ^ (b | ~d);
        g = (7 * index) & 15;
      }
      const next = d;
      d = c;
      c = b;
      const sum = (a + f + MD5_TABLE[index] + words[g]) | 0;
      const shift = MD5_SHIFTS[index];
      b = (b + ((sum << shift) | (sum >>> (32 - shift)))) | 0;
      a = next;
    }
    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
  }
  const output = new Uint8Array(16);
  const outputView = new DataView(output.buffer);
  outputView.setInt32(0, h0, true);
  outputView.setInt32(4, h1, true);
  outputView.setInt32(8, h2, true);
  outputView.setInt32(12, h3, true);
  return output;
}

/** RC4 keystream XOR. Encryption and decryption are the same operation. */
export function rc4(key: Uint8Array, input: Uint8Array): Uint8Array {
  if (key.length === 0 || key.length > 256) throw new RangeError("RC4 keys must have 1 to 256 bytes.");
  const state = new Uint8Array(256);
  for (let index = 0; index < 256; index += 1) state[index] = index;
  for (let index = 0, j = 0; index < 256; index += 1) {
    const value = state[index];
    j = (j + value + key[index % key.length]) & 0xff;
    state[index] = state[j];
    state[j] = value;
  }
  const output = new Uint8Array(input.length);
  for (let index = 0, i = 0, j = 0; index < input.length; index += 1) {
    i = (i + 1) & 0xff;
    const value = state[i];
    j = (j + value) & 0xff;
    state[i] = state[j];
    state[j] = value;
    output[index] = input[index] ^ state[(state[i] + value) & 0xff];
  }
  return output;
}

interface AesTables {
  readonly sbox: Uint8Array;
  readonly inverseSbox: Uint8Array;
  /** FIPS-197 round tables combining SubBytes, ShiftRows and MixColumns. */
  readonly encrypt: readonly [Uint32Array, Uint32Array, Uint32Array, Uint32Array];
  /** Inverse round tables combining InvSubBytes and InvMixColumns. */
  readonly decrypt: readonly [Uint32Array, Uint32Array, Uint32Array, Uint32Array];
}

let aesTables: AesTables | undefined;

function getAesTables(): AesTables {
  if (aesTables) return aesTables;
  // GF(2^8) exponent/logarithm tables for the generator 3.
  const exponent = new Uint8Array(255);
  const logarithm = new Uint8Array(256);
  for (let power = 0, value = 1; power < 255; power += 1) {
    exponent[power] = value;
    logarithm[value] = power;
    value ^= (value << 1) ^ (value & 0x80 ? 0x11b : 0);
  }
  const multiply = (left: number, right: number): number =>
    left === 0 || right === 0 ? 0 : exponent[(logarithm[left] + logarithm[right]) % 255];
  const rotateByte = (value: number, bits: number): number => ((value << bits) | (value >> (8 - bits))) & 0xff;
  const word = (b0: number, b1: number, b2: number, b3: number): number =>
    ((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0;

  const sbox = new Uint8Array(256);
  const inverseSbox = new Uint8Array(256);
  for (let value = 0; value < 256; value += 1) {
    // SubBytes: the multiplicative inverse followed by the affine transform.
    const inverse = value === 0 ? 0 : exponent[(255 - logarithm[value]) % 255];
    const substituted = inverse ^ rotateByte(inverse, 1) ^ rotateByte(inverse, 2) ^
      rotateByte(inverse, 3) ^ rotateByte(inverse, 4) ^ 0x63;
    sbox[value] = substituted;
    inverseSbox[substituted] = value;
  }
  const encrypt = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)] as const;
  const decrypt = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)] as const;
  for (let value = 0; value < 256; value += 1) {
    const s = sbox[value];
    const s2 = multiply(s, 2);
    const s3 = multiply(s, 3);
    encrypt[0][value] = word(s2, s, s, s3);
    encrypt[1][value] = word(s3, s2, s, s);
    encrypt[2][value] = word(s, s3, s2, s);
    encrypt[3][value] = word(s, s, s3, s2);
    const i = inverseSbox[value];
    const i9 = multiply(i, 0x09);
    const ib = multiply(i, 0x0b);
    const id = multiply(i, 0x0d);
    const ie = multiply(i, 0x0e);
    decrypt[0][value] = word(ie, i9, id, ib);
    decrypt[1][value] = word(ib, ie, i9, id);
    decrypt[2][value] = word(id, ib, ie, i9);
    decrypt[3][value] = word(i9, id, ib, ie);
  }
  aesTables = { sbox, inverseSbox, encrypt, decrypt };
  return aesTables;
}

/** An expanded AES-128 or AES-256 key for whole-block CBC operations. */
export class AesKey {
  private readonly rounds: number;
  private readonly encryptKeys: Uint32Array;
  private readonly decryptKeys: Uint32Array;

  constructor(key: Uint8Array) {
    if (key.length !== 16 && key.length !== 32) {
      throw new RangeError("AES keys must have 16 or 32 bytes.");
    }
    const { sbox, decrypt } = getAesTables();
    const keyWords = key.length / 4;
    this.rounds = keyWords + 6;
    const totalWords = 4 * (this.rounds + 1);
    // FIPS-197 KeyExpansion.
    const encryptKeys = new Uint32Array(totalWords);
    for (let index = 0; index < keyWords; index += 1) {
      encryptKeys[index] = readUint32BigEndian(key, index * 4);
    }
    const subWord = (value: number): number =>
      ((sbox[value >>> 24] << 24) | (sbox[(value >>> 16) & 0xff] << 16) |
        (sbox[(value >>> 8) & 0xff] << 8) | sbox[value & 0xff]) >>> 0;
    for (let index = keyWords, roundConstant = 1; index < totalWords; index += 1) {
      let temporary = encryptKeys[index - 1];
      if (index % keyWords === 0) {
        temporary = (subWord(((temporary << 8) | (temporary >>> 24)) >>> 0) ^ (roundConstant << 24)) >>> 0;
        roundConstant = (roundConstant << 1) ^ (roundConstant & 0x80 ? 0x11b : 0);
      } else if (keyWords > 6 && index % keyWords === 4) {
        temporary = subWord(temporary);
      }
      encryptKeys[index] = encryptKeys[index - keyWords] ^ temporary;
    }
    // The equivalent inverse cipher uses the round keys in reverse order with
    // InvMixColumns applied to every inner round key. decrypt[n][sbox[b]]
    // cancels InvSubBytes, leaving InvMixColumns of the key bytes.
    const decryptKeys = new Uint32Array(totalWords);
    for (let round = 0; round <= this.rounds; round += 1) {
      for (let column = 0; column < 4; column += 1) {
        const value = encryptKeys[(this.rounds - round) * 4 + column];
        decryptKeys[round * 4 + column] = round === 0 || round === this.rounds
          ? value
          : decrypt[0][sbox[value >>> 24]] ^ decrypt[1][sbox[(value >>> 16) & 0xff]] ^
            decrypt[2][sbox[(value >>> 8) & 0xff]] ^ decrypt[3][sbox[value & 0xff]];
      }
    }
    this.encryptKeys = encryptKeys;
    this.decryptKeys = decryptKeys;
  }

  /** CBC-encrypt whole 16-byte blocks without padding. */
  encryptCbc(input: Uint8Array, iv: Uint8Array): Uint8Array {
    if (input.length % 16 !== 0 || iv.length !== 16) {
      throw new RangeError("Unpadded AES-CBC requires whole blocks and a 16-byte IV.");
    }
    const output = new Uint8Array(input.length);
    const block = new Uint32Array(4);
    for (let index = 0; index < 4; index += 1) block[index] = readUint32BigEndian(iv, index * 4);
    for (let offset = 0; offset < input.length; offset += 16) {
      for (let index = 0; index < 4; index += 1) block[index] ^= readUint32BigEndian(input, offset + index * 4);
      this.encryptBlock(block);
      for (let index = 0; index < 4; index += 1) writeUint32BigEndian(output, offset + index * 4, block[index]);
    }
    return output;
  }

  /** CBC-decrypt whole 16-byte blocks without removing padding. */
  decryptCbc(input: Uint8Array, iv: Uint8Array): Uint8Array {
    if (input.length % 16 !== 0 || iv.length !== 16) {
      throw new RangeError("Unpadded AES-CBC requires whole blocks and a 16-byte IV.");
    }
    const output = new Uint8Array(input.length);
    const block = new Uint32Array(4);
    let p0 = readUint32BigEndian(iv, 0);
    let p1 = readUint32BigEndian(iv, 4);
    let p2 = readUint32BigEndian(iv, 8);
    let p3 = readUint32BigEndian(iv, 12);
    for (let offset = 0; offset < input.length; offset += 16) {
      const c0 = readUint32BigEndian(input, offset);
      const c1 = readUint32BigEndian(input, offset + 4);
      const c2 = readUint32BigEndian(input, offset + 8);
      const c3 = readUint32BigEndian(input, offset + 12);
      block[0] = c0;
      block[1] = c1;
      block[2] = c2;
      block[3] = c3;
      this.decryptBlock(block);
      writeUint32BigEndian(output, offset, block[0] ^ p0);
      writeUint32BigEndian(output, offset + 4, block[1] ^ p1);
      writeUint32BigEndian(output, offset + 8, block[2] ^ p2);
      writeUint32BigEndian(output, offset + 12, block[3] ^ p3);
      p0 = c0;
      p1 = c1;
      p2 = c2;
      p3 = c3;
    }
    return output;
  }

  private encryptBlock(state: Uint32Array): void {
    const { sbox, encrypt: [t0, t1, t2, t3] } = getAesTables();
    const keys = this.encryptKeys;
    let s0 = state[0] ^ keys[0];
    let s1 = state[1] ^ keys[1];
    let s2 = state[2] ^ keys[2];
    let s3 = state[3] ^ keys[3];
    let key = 4;
    for (let round = 1; round < this.rounds; round += 1, key += 4) {
      const n0 = t0[s0 >>> 24] ^ t1[(s1 >>> 16) & 0xff] ^ t2[(s2 >>> 8) & 0xff] ^ t3[s3 & 0xff] ^ keys[key];
      const n1 = t0[s1 >>> 24] ^ t1[(s2 >>> 16) & 0xff] ^ t2[(s3 >>> 8) & 0xff] ^ t3[s0 & 0xff] ^ keys[key + 1];
      const n2 = t0[s2 >>> 24] ^ t1[(s3 >>> 16) & 0xff] ^ t2[(s0 >>> 8) & 0xff] ^ t3[s1 & 0xff] ^ keys[key + 2];
      const n3 = t0[s3 >>> 24] ^ t1[(s0 >>> 16) & 0xff] ^ t2[(s1 >>> 8) & 0xff] ^ t3[s2 & 0xff] ^ keys[key + 3];
      s0 = n0;
      s1 = n1;
      s2 = n2;
      s3 = n3;
    }
    // The final round has no MixColumns.
    state[0] = substituteRow(sbox, s0, s1, s2, s3) ^ keys[key];
    state[1] = substituteRow(sbox, s1, s2, s3, s0) ^ keys[key + 1];
    state[2] = substituteRow(sbox, s2, s3, s0, s1) ^ keys[key + 2];
    state[3] = substituteRow(sbox, s3, s0, s1, s2) ^ keys[key + 3];
  }

  private decryptBlock(state: Uint32Array): void {
    const { inverseSbox, decrypt: [t0, t1, t2, t3] } = getAesTables();
    const keys = this.decryptKeys;
    let s0 = state[0] ^ keys[0];
    let s1 = state[1] ^ keys[1];
    let s2 = state[2] ^ keys[2];
    let s3 = state[3] ^ keys[3];
    let key = 4;
    for (let round = 1; round < this.rounds; round += 1, key += 4) {
      const n0 = t0[s0 >>> 24] ^ t1[(s3 >>> 16) & 0xff] ^ t2[(s2 >>> 8) & 0xff] ^ t3[s1 & 0xff] ^ keys[key];
      const n1 = t0[s1 >>> 24] ^ t1[(s0 >>> 16) & 0xff] ^ t2[(s3 >>> 8) & 0xff] ^ t3[s2 & 0xff] ^ keys[key + 1];
      const n2 = t0[s2 >>> 24] ^ t1[(s1 >>> 16) & 0xff] ^ t2[(s0 >>> 8) & 0xff] ^ t3[s3 & 0xff] ^ keys[key + 2];
      const n3 = t0[s3 >>> 24] ^ t1[(s2 >>> 16) & 0xff] ^ t2[(s1 >>> 8) & 0xff] ^ t3[s0 & 0xff] ^ keys[key + 3];
      s0 = n0;
      s1 = n1;
      s2 = n2;
      s3 = n3;
    }
    // InvShiftRows reads the following columns in the opposite direction.
    state[0] = substituteRow(inverseSbox, s0, s3, s2, s1) ^ keys[key];
    state[1] = substituteRow(inverseSbox, s1, s0, s3, s2) ^ keys[key + 1];
    state[2] = substituteRow(inverseSbox, s2, s1, s0, s3) ^ keys[key + 2];
    state[3] = substituteRow(inverseSbox, s3, s2, s1, s0) ^ keys[key + 3];
  }
}

/** One output column of a final (Inv)SubBytes and (Inv)ShiftRows round. */
function substituteRow(box: Uint8Array, first: number, second: number, third: number, fourth: number): number {
  return ((box[first >>> 24] << 24) | (box[(second >>> 16) & 0xff] << 16) |
    (box[(third >>> 8) & 0xff] << 8) | box[fourth & 0xff]) >>> 0;
}

interface Sha2Constants {
  readonly sha256Rounds: Uint32Array;
  readonly sha256Initial: Uint32Array;
  /** 64-bit round constants as interleaved high/low 32-bit words. */
  readonly sha512Rounds: Uint32Array;
  readonly sha512Initial: Uint32Array;
  readonly sha384Initial: Uint32Array;
}

let sha2Constants: Sha2Constants | undefined;

/**
 * FIPS 180-4 constants are the leading fractional bits of square and cube
 * roots of the first primes. Deriving them exactly with BigInt avoids
 * transcribing 200 hexadecimal literals.
 */
function getSha2Constants(): Sha2Constants {
  if (sha2Constants) return sha2Constants;
  const primes: number[] = [];
  for (let candidate = 2; primes.length < 80; candidate += 1) {
    if (primes.every((prime) => candidate % prime !== 0)) primes.push(candidate);
  }
  const fraction = (prime: number, degree: 2 | 3, bits: 32 | 64): bigint => {
    const root = integerRoot(BigInt(prime) << BigInt(degree * bits), degree);
    return BigInt.asUintN(bits, root);
  };
  const interleave = (values: readonly bigint[]): Uint32Array => {
    const words = new Uint32Array(values.length * 2);
    values.forEach((value, index) => {
      words[index * 2] = Number(value >> 32n);
      words[index * 2 + 1] = Number(BigInt.asUintN(32, value));
    });
    return words;
  };
  sha2Constants = {
    sha256Rounds: Uint32Array.from(primes.slice(0, 64), (prime) => Number(fraction(prime, 3, 32))),
    sha256Initial: Uint32Array.from(primes.slice(0, 8), (prime) => Number(fraction(prime, 2, 32))),
    sha512Rounds: interleave(primes.map((prime) => fraction(prime, 3, 64))),
    sha512Initial: interleave(primes.slice(0, 8).map((prime) => fraction(prime, 2, 64))),
    sha384Initial: interleave(primes.slice(8, 16).map((prime) => fraction(prime, 2, 64)))
  };
  return sha2Constants;
}

function integerRoot(value: bigint, degree: 2 | 3): bigint {
  const power = BigInt(degree);
  let estimate = 1n << BigInt(Math.ceil(value.toString(2).length / degree));
  while (true) {
    const next = ((power - 1n) * estimate + value / estimate ** (power - 1n)) / power;
    if (next >= estimate) return estimate;
    estimate = next;
  }
}

/** FIPS 180-4 SHA-256. */
export function sha256(input: Uint8Array): Uint8Array {
  const { sha256Rounds: rounds, sha256Initial } = getSha2Constants();
  const padded = padSha2(input, 64);
  const view = new DataView(padded.buffer);
  const hash = Uint32Array.from(sha256Initial);
  const words = new Uint32Array(64);
  for (let block = 0; block < padded.length; block += 64) {
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(block + index * 4);
    for (let index = 16; index < 64; index += 1) {
      const w15 = words[index - 15];
      const w2 = words[index - 2];
      const s0 = rotr32(w15, 7) ^ rotr32(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr32(w2, 17) ^ rotr32(w2, 19) ^ (w2 >>> 10);
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) | 0;
    }
    let a = hash[0];
    let b = hash[1];
    let c = hash[2];
    let d = hash[3];
    let e = hash[4];
    let f = hash[5];
    let g = hash[6];
    let h = hash[7];
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + choice + rounds[index] + words[index]) | 0;
      const s0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + majority) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }
    hash[0] += a;
    hash[1] += b;
    hash[2] += c;
    hash[3] += d;
    hash[4] += e;
    hash[5] += f;
    hash[6] += g;
    hash[7] += h;
  }
  const output = new Uint8Array(32);
  const outputView = new DataView(output.buffer);
  for (let index = 0; index < 8; index += 1) outputView.setUint32(index * 4, hash[index]);
  return output;
}

/** FIPS 180-4 SHA-384. */
export function sha384(input: Uint8Array): Uint8Array {
  return sha512Family(input, getSha2Constants().sha384Initial, 48);
}

/** FIPS 180-4 SHA-512. */
export function sha512(input: Uint8Array): Uint8Array {
  return sha512Family(input, getSha2Constants().sha512Initial, 64);
}

function sha512Family(input: Uint8Array, initial: Uint32Array, outputLength: 48 | 64): Uint8Array {
  const rounds = getSha2Constants().sha512Rounds;
  const padded = padSha2(input, 128);
  const view = new DataView(padded.buffer);
  const hash = Uint32Array.from(initial);
  // 64-bit words are stored as [high, low] 32-bit pairs.
  const words = new Uint32Array(160);
  const state = new Uint32Array(16);
  for (let block = 0; block < padded.length; block += 128) {
    for (let index = 0; index < 32; index += 1) words[index] = view.getUint32(block + index * 4);
    for (let index = 16; index < 80; index += 1) {
      const xh = words[(index - 15) * 2];
      const xl = words[(index - 15) * 2 + 1];
      // sigma0 = ROTR1 ^ ROTR8 ^ SHR7
      const s0h = ((xh >>> 1) | (xl << 31)) ^ ((xh >>> 8) | (xl << 24)) ^ (xh >>> 7);
      const s0l = ((xl >>> 1) | (xh << 31)) ^ ((xl >>> 8) | (xh << 24)) ^ ((xl >>> 7) | (xh << 25));
      const yh = words[(index - 2) * 2];
      const yl = words[(index - 2) * 2 + 1];
      // sigma1 = ROTR19 ^ ROTR61 ^ SHR6
      const s1h = ((yh >>> 19) | (yl << 13)) ^ ((yl >>> 29) | (yh << 3)) ^ (yh >>> 6);
      const s1l = ((yl >>> 19) | (yh << 13)) ^ ((yh >>> 29) | (yl << 3)) ^ ((yl >>> 6) | (yh << 26));
      const low = (s0l >>> 0) + (s1l >>> 0) + words[(index - 16) * 2 + 1] + words[(index - 7) * 2 + 1];
      words[index * 2 + 1] = low;
      words[index * 2] = s0h + s1h + words[(index - 16) * 2] + words[(index - 7) * 2] +
        Math.floor(low / 0x1_0000_0000);
    }
    state.set(hash);
    for (let index = 0; index < 80; index += 1) {
      const ah = state[0];
      const al = state[1];
      const eh = state[8];
      const el = state[9];
      // Sigma1(e) = ROTR14 ^ ROTR18 ^ ROTR41
      const sigma1h = ((eh >>> 14) | (el << 18)) ^ ((eh >>> 18) | (el << 14)) ^ ((el >>> 9) | (eh << 23));
      const sigma1l = ((el >>> 14) | (eh << 18)) ^ ((el >>> 18) | (eh << 14)) ^ ((eh >>> 9) | (el << 23));
      const choiceH = (eh & state[10]) ^ (~eh & state[12]);
      const choiceL = (el & state[11]) ^ (~el & state[13]);
      const temp1l = state[15] + (sigma1l >>> 0) + (choiceL >>> 0) + rounds[index * 2 + 1] + words[index * 2 + 1];
      const temp1h = state[14] + sigma1h + choiceH + rounds[index * 2] + words[index * 2] +
        Math.floor(temp1l / 0x1_0000_0000);
      // Sigma0(a) = ROTR28 ^ ROTR34 ^ ROTR39
      const sigma0h = ((ah >>> 28) | (al << 4)) ^ ((al >>> 2) | (ah << 30)) ^ ((al >>> 7) | (ah << 25));
      const sigma0l = ((al >>> 28) | (ah << 4)) ^ ((ah >>> 2) | (al << 30)) ^ ((ah >>> 7) | (al << 25));
      const majorityH = (ah & state[2]) ^ (ah & state[4]) ^ (state[2] & state[4]);
      const majorityL = (al & state[3]) ^ (al & state[5]) ^ (state[3] & state[5]);
      const temp2l = (sigma0l >>> 0) + (majorityL >>> 0);
      const temp2h = sigma0h + majorityH + Math.floor(temp2l / 0x1_0000_0000);
      state.copyWithin(2, 0, 14);
      const eLow = state[9] + (temp1l >>> 0);
      state[9] = eLow;
      state[8] = state[8] + temp1h + Math.floor(eLow / 0x1_0000_0000);
      const aLow = (temp1l >>> 0) + (temp2l >>> 0);
      state[1] = aLow;
      state[0] = temp1h + temp2h + Math.floor(aLow / 0x1_0000_0000);
    }
    for (let index = 0; index < 16; index += 2) {
      const low = hash[index + 1] + state[index + 1];
      hash[index + 1] = low;
      hash[index] = hash[index] + state[index] + Math.floor(low / 0x1_0000_0000);
    }
  }
  const output = new Uint8Array(64);
  const outputView = new DataView(output.buffer);
  for (let index = 0; index < 16; index += 1) outputView.setUint32(index * 4, hash[index]);
  return output.subarray(0, outputLength);
}

function padSha2(input: Uint8Array, blockSize: 64 | 128): Uint8Array {
  const lengthBytes = blockSize / 8;
  const paddedLength = Math.ceil((input.length + 1 + lengthBytes) / blockSize) * blockSize;
  const padded = new Uint8Array(paddedLength);
  padded.set(input);
  padded[input.length] = 0x80;
  const bitLength = input.length * 8;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);
  return padded;
}

function rotr32(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

function readUint32BigEndian(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function writeUint32BigEndian(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value >>> 24;
  bytes[offset + 1] = value >>> 16;
  bytes[offset + 2] = value >>> 8;
  bytes[offset + 3] = value;
}

export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  if (parts.length === 1) return parts[0];
  let length = 0;
  for (const part of parts) length += part.length;
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}
