const encoder = new TextEncoder();

/**
 * Deliberately small test-only PDF writer.
 *
 * It emits one classic xref revision and accepts already-serialized COS object
 * bodies. It is intentionally not a production serializer.
 */
export function writeTinyPdf({
  version = "1.7",
  objects,
  rootObject = 1,
  trailerEntries = ""
}) {
  if (!Array.isArray(objects) || objects.length === 0) {
    throw new TypeError("writeTinyPdf requires at least one indirect object.");
  }
  const normalized = [...objects]
    .map((object) => ({
      number: object.number,
      generation: object.generation ?? 0,
      body: bytes(object.body)
    }))
    .sort((a, b) => a.number - b.number || a.generation - b.generation);
  const seen = new Set();
  for (const object of normalized) {
    if (!Number.isSafeInteger(object.number) || object.number <= 0) {
      throw new RangeError("Tiny PDF object numbers must be positive integers.");
    }
    if (!Number.isSafeInteger(object.generation) || object.generation < 0 || object.generation > 65_535) {
      throw new RangeError("Tiny PDF generations must be integers from 0 through 65535.");
    }
    if (seen.has(object.number)) {
      throw new RangeError(`Tiny PDF object ${object.number} is defined more than once.`);
    }
    seen.add(object.number);
  }

  const chunks = [encoder.encode(`%PDF-${version}\n%\x80\x81\x82\x83\n`)];
  const offsets = new Map();
  let length = chunks[0].length;
  for (const object of normalized) {
    offsets.set(object.number, { offset: length, generation: object.generation });
    const prefix = encoder.encode(`${object.number} ${object.generation} obj\n`);
    const suffix = encoder.encode("\nendobj\n");
    chunks.push(prefix, object.body, suffix);
    length += prefix.length + object.body.length + suffix.length;
  }

  const xrefOffset = length;
  const size = normalized.at(-1).number + 1;
  const xrefLines = [`xref\n0 ${size}\n`, "0000000000 65535 f \n"];
  for (let number = 1; number < size; number += 1) {
    const entry = offsets.get(number);
    xrefLines.push(entry
      ? `${String(entry.offset).padStart(10, "0")} ${String(entry.generation).padStart(5, "0")} n \n`
      : "0000000000 00000 f \n");
  }
  const trailerSuffix = trailerEntries.trim();
  xrefLines.push(
    `trailer\n<< /Size ${size} /Root ${rootObject} 0 R${trailerSuffix ? ` ${trailerSuffix}` : ""} >>\n`,
    `startxref\n${xrefOffset}\n%%EOF\n`
  );
  const xref = encoder.encode(xrefLines.join(""));
  chunks.push(xref);
  length += xref.length;

  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

export function tinyPdfStream(dictionaryEntries, content) {
  const payload = bytes(content);
  return concatenate([
    encoder.encode(`<< /Length ${payload.length}${dictionaryEntries.trim() ? ` ${dictionaryEntries.trim()}` : ""} >>\nstream\n`),
    payload,
    encoder.encode("\nendstream")
  ]);
}

function bytes(value) {
  if (value instanceof Uint8Array) return value;
  if (typeof value === "string") return encoder.encode(value);
  throw new TypeError("Tiny PDF object bodies must be strings or Uint8Array values.");
}

function concatenate(parts) {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}
