export function encodeByteShuffledFloat32(source: Float32Array): Uint8Array {
  const floatCount = source.length;
  if (floatCount === 0) {
    return new Uint8Array(0);
  }

  const sourceBytes = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  const out = new Uint8Array(sourceBytes.length);

  for (let lane = 0; lane < 4; lane += 1) {
    const laneOffset = lane * floatCount;
    let srcIndex = lane;
    for (let i = 0; i < floatCount; i += 1) {
      out[laneOffset + i] = sourceBytes[srcIndex];
      srcIndex += 4;
    }
  }

  return out;
}

export function decodeByteShuffledFloat32(bytes: Uint8Array): Float32Array {
  if (bytes.length === 0) {
    return new Float32Array(0);
  }
  if (bytes.length % 4 !== 0) {
    throw new Error(`Byte-shuffled float32 payload has invalid length (${bytes.length}).`);
  }

  const floatCount = bytes.length / 4;
  const outBytes = new Uint8Array(bytes.length);

  for (let lane = 0; lane < 4; lane += 1) {
    const laneOffset = lane * floatCount;
    let dstIndex = lane;
    for (let i = 0; i < floatCount; i += 1) {
      outBytes[dstIndex] = bytes[laneOffset + i];
      dstIndex += 4;
    }
  }

  return new Float32Array(outBytes.buffer);
}

export function encodeXorDeltaByteShuffledFloat32(source: Float32Array): Uint8Array {
  const floatCount = source.length;
  if (floatCount === 0) {
    return new Uint8Array(0);
  }

  const sourceWords = new Uint32Array(source.buffer, source.byteOffset, source.length);
  const deltaWords = new Uint32Array(floatCount);
  let prev = 0;
  for (let i = 0; i < floatCount; i += 1) {
    const current = sourceWords[i];
    deltaWords[i] = current ^ prev;
    prev = current;
  }

  const deltaBytes = new Uint8Array(deltaWords.buffer);
  return shuffleBytesByWord(deltaBytes, floatCount);
}

export function decodeXorDeltaByteShuffledFloat32(bytes: Uint8Array): Float32Array {
  if (bytes.length === 0) {
    return new Float32Array(0);
  }
  if (bytes.length % 4 !== 0) {
    throw new Error(`XOR-delta byte-shuffled float32 payload has invalid length (${bytes.length}).`);
  }

  const floatCount = bytes.length / 4;
  const deltaBytes = unshuffleBytesByWord(bytes, floatCount);
  const deltaWords = new Uint32Array(deltaBytes.buffer);
  const outWords = new Uint32Array(floatCount);

  let prev = 0;
  for (let i = 0; i < floatCount; i += 1) {
    const current = deltaWords[i] ^ prev;
    outWords[i] = current;
    prev = current;
  }

  return new Float32Array(outWords.buffer);
}

export function encodeChannelMajorFloat32(source: Float32Array): Uint8Array {
  if (source.length === 0) {
    return new Uint8Array(0);
  }
  if (source.length % 4 !== 0) {
    throw new Error(`Channel-major float32 source length must be divisible by 4 (${source.length}).`);
  }

  const itemCount = source.length / 4;
  const out = new Float32Array(source.length);

  for (let channel = 0; channel < 4; channel += 1) {
    const channelOffset = channel * itemCount;
    let srcOffset = channel;
    for (let item = 0; item < itemCount; item += 1) {
      out[channelOffset + item] = source[srcOffset];
      srcOffset += 4;
    }
  }

  return new Uint8Array(out.buffer);
}

export function decodeChannelMajorFloat32(bytes: Uint8Array): Float32Array {
  if (bytes.length === 0) {
    return new Float32Array(0);
  }
  if (bytes.length % 16 !== 0) {
    throw new Error(`Channel-major float32 payload has invalid length (${bytes.length}).`);
  }

  const channelMajor = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  const itemCount = channelMajor.length / 4;
  const out = new Float32Array(channelMajor.length);

  for (let channel = 0; channel < 4; channel += 1) {
    const channelOffset = channel * itemCount;
    let dstOffset = channel;
    for (let item = 0; item < itemCount; item += 1) {
      out[dstOffset] = channelMajor[channelOffset + item];
      dstOffset += 4;
    }
  }

  return out;
}

function shuffleBytesByWord(bytes: Uint8Array, wordCount: number): Uint8Array {
  const out = new Uint8Array(bytes.length);

  for (let lane = 0; lane < 4; lane += 1) {
    const laneOffset = lane * wordCount;
    let srcIndex = lane;
    for (let i = 0; i < wordCount; i += 1) {
      out[laneOffset + i] = bytes[srcIndex];
      srcIndex += 4;
    }
  }

  return out;
}

function unshuffleBytesByWord(bytes: Uint8Array, wordCount: number): Uint8Array {
  const outBytes = new Uint8Array(bytes.length);

  for (let lane = 0; lane < 4; lane += 1) {
    const laneOffset = lane * wordCount;
    let dstIndex = lane;
    for (let i = 0; i < wordCount; i += 1) {
      outBytes[dstIndex] = bytes[laneOffset + i];
      dstIndex += 4;
    }
  }

  return outBytes;
}
