import { createHash } from "node:crypto";

const textEncoder = new TextEncoder();

export function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function sha256Text(value) {
  return sha256Bytes(textEncoder.encode(value));
}

export function hashCanonical(value, options = {}) {
  const hash = createHash("sha256");
  const state = {
    hash,
    seen: new WeakMap(),
    nextReference: 0,
    numberDigits: options.numberDigits ?? 12
  };
  appendCanonical(state, value);
  return hash.digest("hex");
}

export function stableJson(value) {
  return JSON.stringify(sortJsonValue(value), null, 2) + "\n";
}

export function firstJsonDifference(expected, actual, path = "$") {
  if (Object.is(expected, actual)) {
    return null;
  }
  if (typeof expected !== typeof actual) {
    return { path, expected, actual };
  }
  if (expected === null || actual === null || typeof expected !== "object") {
    return { path, expected, actual };
  }
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) {
      return { path, expected, actual };
    }
    if (expected.length !== actual.length) {
      return {
        path: `${path}.length`,
        expected: expected.length,
        actual: actual.length
      };
    }
    for (let index = 0; index < expected.length; index += 1) {
      const difference = firstJsonDifference(expected[index], actual[index], `${path}[${index}]`);
      if (difference) {
        return difference;
      }
    }
    return null;
  }

  const expectedKeys = Object.keys(expected).sort();
  const actualKeys = Object.keys(actual).sort();
  const keyDifference = firstJsonDifference(expectedKeys, actualKeys, `${path}.[keys]`);
  if (keyDifference) {
    return keyDifference;
  }
  for (const key of expectedKeys) {
    const difference = firstJsonDifference(expected[key], actual[key], `${path}.${escapePathKey(key)}`);
    if (difference) {
      return difference;
    }
  }
  return null;
}

function appendCanonical(state, value) {
  if (value === null) {
    appendString(state.hash, "null");
    return;
  }

  switch (typeof value) {
    case "undefined":
      appendString(state.hash, "undefined");
      return;
    case "boolean":
      appendString(state.hash, value ? "true" : "false");
      return;
    case "number":
      appendString(state.hash, canonicalNumber(value, state.numberDigits));
      return;
    case "bigint":
      appendString(state.hash, `bigint:${value.toString(10)}`);
      return;
    case "string":
      appendLengthPrefixed(state.hash, "string", value);
      return;
    case "symbol":
      appendLengthPrefixed(state.hash, "symbol", value.description ?? "");
      return;
    case "function":
      appendLengthPrefixed(state.hash, "function", value.name || "anonymous");
      return;
    default:
      break;
  }

  const priorReference = state.seen.get(value);
  if (priorReference !== undefined) {
    appendString(state.hash, `reference:${priorReference};`);
    return;
  }
  const reference = state.nextReference++;
  state.seen.set(value, reference);

  if (ArrayBuffer.isView(value)) {
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    appendString(state.hash, `view:${value.constructor.name}:${value.byteLength}:`);
    state.hash.update(bytes);
    appendString(state.hash, ";");
    return;
  }
  if (value instanceof ArrayBuffer) {
    appendString(state.hash, `buffer:${value.byteLength}:`);
    state.hash.update(new Uint8Array(value));
    appendString(state.hash, ";");
    return;
  }
  if (Array.isArray(value)) {
    appendString(state.hash, `array:${value.length}:[`);
    for (const item of value) {
      appendCanonical(state, item);
    }
    appendString(state.hash, "]");
    return;
  }
  if (value instanceof Date) {
    appendLengthPrefixed(state.hash, "date", value.toISOString());
    return;
  }
  if (value instanceof Map) {
    const entries = [...value.entries()].map(([key, item]) => ({
      key,
      item,
      order: hashCanonical(key, { numberDigits: state.numberDigits })
    }));
    entries.sort((left, right) => left.order.localeCompare(right.order));
    appendString(state.hash, `map:${entries.length}:{`);
    for (const entry of entries) {
      appendCanonical(state, entry.key);
      appendCanonical(state, entry.item);
    }
    appendString(state.hash, "}");
    return;
  }
  if (value instanceof Set) {
    const entries = [...value].map((item) => ({
      item,
      order: hashCanonical(item, { numberDigits: state.numberDigits })
    }));
    entries.sort((left, right) => left.order.localeCompare(right.order));
    appendString(state.hash, `set:${entries.length}:{`);
    for (const entry of entries) {
      appendCanonical(state, entry.item);
    }
    appendString(state.hash, "}");
    return;
  }

  const prototypeName = Object.getPrototypeOf(value)?.constructor?.name ?? "Object";
  const keys = Object.keys(value).sort();
  appendLengthPrefixed(state.hash, "object", prototypeName);
  appendString(state.hash, `${keys.length}:{`);
  for (const key of keys) {
    appendLengthPrefixed(state.hash, "key", key);
    let propertyValue;
    try {
      propertyValue = value[key];
    } catch (error) {
      propertyValue = `[getter threw: ${error instanceof Error ? error.name : "unknown"}]`;
    }
    appendCanonical(state, propertyValue);
  }
  appendString(state.hash, "}");
}

function canonicalNumber(value, digits) {
  if (Number.isNaN(value)) {
    return "number:NaN;";
  }
  if (value === Infinity) {
    return "number:+Infinity;";
  }
  if (value === -Infinity) {
    return "number:-Infinity;";
  }
  if (Object.is(value, -0)) {
    return "number:0;";
  }
  if (Number.isInteger(value)) {
    return `number:${value.toString(10)};`;
  }
  return `number:${Number(value.toPrecision(digits)).toString(10)};`;
}

function appendLengthPrefixed(hash, kind, value) {
  const bytes = textEncoder.encode(value);
  appendString(hash, `${kind}:${bytes.byteLength}:`);
  hash.update(bytes);
  appendString(hash, ";");
}

function appendString(hash, value) {
  hash.update(value, "utf8");
}

function sortJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }
  if (value && typeof value === "object") {
    const output = {};
    for (const key of Object.keys(value).sort()) {
      output[key] = sortJsonValue(value[key]);
    }
    return output;
  }
  return value;
}

function escapePathKey(key) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}
