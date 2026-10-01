import {
  isPdfDictionary,
  isPdfName,
  isPdfStream,
  isPdfString,
  pdfRefKey,
  type PdfDictionary,
  type PdfRef,
  type PdfStream,
  type PdfValue
} from "./nativeCos";
import { AesKey, concatBytes, md5, rc4, sha256, sha384, sha512 } from "./nativeCrypto";
import { encodePdfDocEncoding } from "./nativePdfDocEncoding";
import { PdfError, type PdfDiagnostic } from "./nativeTypes";

/** ISO 32000-2 Algorithm 2 password padding string. */
const PASSWORD_PADDING = new Uint8Array([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a
]);
const AES_SALT = new Uint8Array([0x73, 0x41, 0x6c, 0x54]);
const EMPTY = new Uint8Array(0);
const ZERO_IV = new Uint8Array(16);

type CryptMethod = "identity" | "rc4" | "aes-128" | "aes-256";

interface CryptFilter {
  readonly method: CryptMethod;
}

const IDENTITY_FILTER: CryptFilter = Object.freeze({ method: "identity" });

/** The resolved inputs of a Standard security handler. */
export interface PdfEncryptionInput {
  /** Encryption dictionary with every value (including /CF entries) resolved. */
  readonly dictionary: PdfDictionary;
  /** Indirect reference holding the dictionary; that object is never decrypted. */
  readonly ref: PdfRef | null;
  /**
   * Candidate first trailer /ID strings, most likely first. Producers that
   * rewrite linearized files can leave trailers with conflicting IDs; only the
   * one used for key derivation authenticates.
   */
  readonly fileIds: readonly Uint8Array[];
  /** A user or owner password supplied by the caller. */
  readonly password?: string;
}

/**
 * ISO 32000-2 Standard security handler. The empty password is tried first,
 * which opens documents that only restrict permissions; a supplied password is
 * then tried as both the user and the owner password. A document that still
 * cannot be authenticated is rejected as `encrypted` with a
 * `password-required` or `password-incorrect` reason.
 */
export class PdfSecurityHandler {
  readonly diagnostic: PdfDiagnostic;

  private readonly fileKey: Uint8Array;
  private readonly stringFilter: CryptFilter;
  private readonly streamFilter: CryptFilter;
  private readonly filters: ReadonlyMap<string, CryptFilter>;
  private readonly encryptMetadata: boolean;
  private readonly encryptRefKey: string | null;
  private aesKeyCache: { readonly key: Uint8Array; readonly aes: AesKey } | null = null;

  private constructor(
    fileKey: Uint8Array,
    filters: ReadonlyMap<string, CryptFilter>,
    stringFilter: CryptFilter,
    streamFilter: CryptFilter,
    encryptMetadata: boolean,
    encryptRef: PdfRef | null,
    diagnostic: PdfDiagnostic
  ) {
    this.fileKey = fileKey;
    this.filters = filters;
    this.stringFilter = stringFilter;
    this.streamFilter = streamFilter;
    this.encryptMetadata = encryptMetadata;
    this.encryptRefKey = encryptRef ? pdfRefKey(encryptRef) : null;
    this.diagnostic = diagnostic;
  }

  static create(input: PdfEncryptionInput): PdfSecurityHandler {
    const dictionary = input.dictionary;
    const filter = dictionary.get("Filter");
    if (!isPdfName(filter, "Standard")) {
      throw unsupportedEncryption(
        `The PDF uses the ${isPdfName(filter) ? `/${filter.value}` : "unknown"} security handler; ` +
        "only the Standard password handler is supported.",
        { reason: "security-handler", handler: isPdfName(filter) ? filter.value : null }
      );
    }
    const version = optionalInteger(dictionary.get("V")) ?? 0;
    const revision = optionalInteger(dictionary.get("R"));
    const owner = stringBytes(dictionary.get("O"));
    const user = stringBytes(dictionary.get("U"));
    const permissions = optionalInteger(dictionary.get("P"));
    if (revision === undefined || owner === undefined || user === undefined || permissions === undefined) {
      throw unsupportedEncryption(
        "The PDF encryption dictionary is missing /R, /O, /U or /P.",
        { reason: "malformed-encryption-dictionary" }
      );
    }
    const encryptMetadata = dictionary.get("EncryptMetadata") !== false;
    const filters = new Map<string, CryptFilter>([["Identity", IDENTITY_FILTER]]);
    let stringFilter: CryptFilter;
    let streamFilter: CryptFilter;
    let keyLength: number;
    if (version === 1 || version === 2 || version === 3) {
      keyLength = version === 1 ? 5 : readKeyLengthBytes(dictionary.get("Length")) ?? 5;
      stringFilter = streamFilter = { method: "rc4" };
    } else if (version === 4 || version === 5) {
      const cryptFilters = dictionary.get("CF");
      let declaredLength: number | undefined;
      if (isPdfDictionary(cryptFilters)) {
        for (const [name, value] of cryptFilters) {
          if (name === "Identity" || !isPdfDictionary(value)) continue;
          const method = readCryptMethod(value.get("CFM"), name);
          filters.set(name, { method });
          if (method !== "identity") declaredLength ??= readKeyLengthBytes(value.get("Length"));
        }
      }
      stringFilter = namedFilter(filters, dictionary.get("StrF"));
      streamFilter = namedFilter(filters, dictionary.get("StmF"));
      keyLength = version === 5
        ? 32
        : readKeyLengthBytes(dictionary.get("Length")) ?? declaredLength ?? 16;
    } else {
      throw unsupportedEncryption(
        `The PDF uses unsupported Standard security handler version ${version}.`,
        { reason: "unsupported-version", version }
      );
    }

    const methods = new Set([...filters.values()].map((entry) => entry.method));
    if (version === 5 && (methods.has("rc4") || methods.has("aes-128"))) {
      throw unsupportedEncryption(
        "The PDF combines AES-256 key derivation with an older crypt filter method.",
        { reason: "mixed-crypt-filters" }
      );
    }
    if (version === 4 && methods.has("aes-128")) keyLength = 16;

    const supplied = input.password !== undefined && input.password !== "";
    const candidates = revision >= 5
      ? aes256PasswordCandidates(supplied ? input.password! : "")
      : legacyPasswordCandidates(supplied ? input.password! : "");
    let authentication: Authentication | null = null;
    // The empty password comes first so a supplied password never prevents
    // opening a document that needs none.
    for (const password of supplied ? [EMPTY, ...candidates] : [EMPTY]) {
      authentication = revision >= 5
        ? authenticateAes256(revision, owner, user, dictionary, password)
        : authenticateLegacyWithIds(revision, keyLength, owner, user, permissions, input.fileIds,
          encryptMetadata, password);
      if (authentication) break;
    }
    if (!authentication) {
      throw new PdfError(
        "encrypted",
        supplied
          ? "The supplied password is incorrect for this PDF."
          : "This PDF is password protected. Supply its password to open it.",
        { details: { reason: supplied ? "password-incorrect" : "password-required", version, revision } }
      );
    }
    const passwordSource = authentication.empty ? "its empty" : "the supplied";
    const algorithm = describeAlgorithm(streamFilter.method !== "identity" ? streamFilter : stringFilter, keyLength);
    return new PdfSecurityHandler(
      authentication.fileKey,
      filters,
      stringFilter,
      streamFilter,
      encryptMetadata,
      input.ref,
      {
        code: "document.decrypted",
        severity: "info",
        message: `Decrypted the PDF (${algorithm}) with ${passwordSource} ${authentication.password} password.`,
        details: {
          version,
          revision,
          algorithm,
          password: authentication.password,
          suppliedPassword: !authentication.empty,
          permissions
        }
      }
    );
  }

  /**
   * Return a decrypted copy of an indirect object read directly from the
   * source. Objects extracted from an object stream are already plain text
   * because the containing stream was decrypted.
   */
  decryptObject(value: PdfValue, ref: PdfRef): PdfValue {
    if (this.encryptRefKey !== null && pdfRefKey(ref) === this.encryptRefKey) return value;
    let objectKeys: Map<CryptMethod, Uint8Array> | null = null;
    const keyFor = (method: CryptMethod): Uint8Array => {
      objectKeys ??= new Map();
      let key = objectKeys.get(method);
      if (!key) {
        key = this.objectKey(method, ref);
        objectKeys.set(method, key);
      }
      return key;
    };
    if (isPdfStream(value)) return this.decryptStream(value, keyFor);
    return this.decryptValue(value, keyFor);
  }

  private decryptStream(stream: PdfStream, keyFor: (method: CryptMethod) => Uint8Array): PdfValue {
    const type = stream.dictionary.get("Type");
    // Cross-reference streams are never encrypted; metadata may be exempt.
    if (isPdfName(type, "XRef")) return stream;
    const dictionary = this.decryptValue(stream.dictionary, keyFor) as PdfDictionary;
    if (isPdfName(type, "Metadata") && !this.encryptMetadata) {
      return { kind: "stream", dictionary, bytes: stream.bytes };
    }
    const explicit = takeCryptFilter(dictionary, this.filters);
    const filter = explicit ?? this.streamFilter;
    return {
      kind: "stream",
      dictionary,
      bytes: this.decryptBytes(filter, stream.bytes, keyFor)
    };
  }

  private decryptValue(value: PdfValue, keyFor: (method: CryptMethod) => Uint8Array): PdfValue {
    if (isPdfString(value)) {
      return { kind: "string", hex: value.hex, bytes: this.decryptBytes(this.stringFilter, value.bytes, keyFor) };
    }
    if (Array.isArray(value)) return value.map((entry) => this.decryptValue(entry, keyFor));
    if (isPdfDictionary(value)) {
      const output: PdfDictionary = new Map();
      for (const [key, entry] of value) output.set(key, this.decryptValue(entry, keyFor));
      return output;
    }
    return value;
  }

  private decryptBytes(
    filter: CryptFilter,
    bytes: Uint8Array,
    keyFor: (method: CryptMethod) => Uint8Array
  ): Uint8Array {
    switch (filter.method) {
      case "identity":
        return bytes;
      case "rc4":
        return rc4(keyFor("rc4"), bytes);
      case "aes-128":
      case "aes-256":
        return this.decryptAesCbc(keyFor(filter.method), bytes);
    }
  }

  /** ISO 32000-2 Algorithm 1 (RC4/AESV2) and Algorithm 1.A (AESV3). */
  private objectKey(method: CryptMethod, ref: PdfRef): Uint8Array {
    if (method === "aes-256") return this.fileKey;
    const object = ref.objectNumber;
    const generation = ref.generation;
    const suffix = new Uint8Array([
      object & 0xff, (object >>> 8) & 0xff, (object >>> 16) & 0xff,
      generation & 0xff, (generation >>> 8) & 0xff
    ]);
    const digest = md5(this.fileKey, suffix, method === "aes-128" ? AES_SALT : EMPTY);
    return digest.subarray(0, Math.min(this.fileKey.length + 5, 16));
  }

  private decryptAesCbc(key: Uint8Array, bytes: Uint8Array): Uint8Array {
    // Producers occasionally truncate the final block or emit an IV-only
    // empty value. Decrypt every complete block and keep going.
    const blockBytes = bytes.length - 16 - ((bytes.length - 16) % 16);
    if (bytes.length < 16 || blockBytes <= 0) return EMPTY;
    let cached = this.aesKeyCache;
    if (!cached || !sameBytes(cached.key, key)) {
      cached = { key, aes: new AesKey(key) };
      this.aesKeyCache = cached;
    }
    const plain = cached.aes.decryptCbc(bytes.subarray(16, 16 + blockBytes), bytes.subarray(0, 16));
    const padding = plain[plain.length - 1];
    if (padding < 1 || padding > 16 || padding > plain.length) return plain;
    for (let index = plain.length - padding; index < plain.length; index += 1) {
      if (plain[index] !== padding) return plain;
    }
    return plain.subarray(0, plain.length - padding);
  }
}

interface Authentication {
  readonly fileKey: Uint8Array;
  readonly password: "user" | "owner";
  readonly empty: boolean;
}

/**
 * Revisions 2-4 hash the password in PDFDocEncoding. Some producers used
 * UTF-8 or Latin-1 instead, so those encodings are tried as well.
 */
function legacyPasswordCandidates(password: string): Uint8Array[] {
  const latin1 = /^[\u0000-\u00ff]*$/.test(password)
    ? Uint8Array.from(password, (character) => character.charCodeAt(0))
    : null;
  return uniquePasswords([
    encodePdfDocEncoding(password),
    new TextEncoder().encode(password),
    latin1
  ].map((bytes) => bytes?.subarray(0, 32) ?? null));
}

/**
 * Revisions 5-6 hash the SASLprep-processed password as UTF-8, truncated to
 * 127 bytes. NFKC normalization is SASLprep's mapping step for practically
 * every password; the unnormalized text is tried as well.
 */
function aes256PasswordCandidates(password: string): Uint8Array[] {
  const encoder = new TextEncoder();
  return uniquePasswords([password.normalize("NFKC"), password]
    .map((text) => encoder.encode(text).subarray(0, 127)));
}

function uniquePasswords(candidates: readonly (Uint8Array | null)[]): Uint8Array[] {
  const unique: Uint8Array[] = [];
  for (const candidate of candidates) {
    if (candidate && !unique.some((existing) => sameBytes(existing, candidate))) unique.push(candidate);
  }
  return unique;
}

function authenticateLegacyWithIds(
  revision: number,
  keyLength: number,
  owner: Uint8Array,
  user: Uint8Array,
  permissions: number,
  fileIds: readonly Uint8Array[],
  encryptMetadata: boolean,
  password: Uint8Array
): Authentication | null {
  for (const fileId of fileIds.length > 0 ? fileIds : [EMPTY]) {
    const authentication = authenticateLegacy(
      revision, keyLength, owner, user, permissions, fileId, encryptMetadata, password
    );
    if (authentication) return authentication;
  }
  return null;
}

/** Algorithms 2, 4, 5 and 7 for revisions 2-4: `password` as user, then owner. */
function authenticateLegacy(
  revision: number,
  keyLength: number,
  owner: Uint8Array,
  user: Uint8Array,
  permissions: number,
  fileId: Uint8Array,
  encryptMetadata: boolean,
  password: Uint8Array
): Authentication | null {
  if (revision < 2 || revision > 4) {
    throw unsupportedEncryption(
      `The PDF uses unsupported Standard security handler revision ${revision}.`,
      { reason: "unsupported-revision", revision }
    );
  }
  const length = revision === 2 ? 5 : keyLength;
  const ownerEntry = owner.subarray(0, 32);
  const fileKeyFor = (paddedUserPassword: Uint8Array): Uint8Array => {
    const permissionBytes = new Uint8Array([
      permissions & 0xff, (permissions >>> 8) & 0xff, (permissions >>> 16) & 0xff, (permissions >>> 24) & 0xff
    ]);
    let digest = md5(
      paddedUserPassword,
      ownerEntry,
      permissionBytes,
      fileId,
      revision >= 4 && !encryptMetadata ? new Uint8Array([0xff, 0xff, 0xff, 0xff]) : EMPTY
    );
    if (revision >= 3) {
      for (let index = 0; index < 50; index += 1) digest = md5(digest.subarray(0, length));
    }
    return digest.slice(0, length);
  };
  const userMatches = (fileKey: Uint8Array): boolean => {
    if (revision === 2) return sameBytes(rc4(fileKey, PASSWORD_PADDING), user.subarray(0, 32));
    let value = rc4(fileKey, md5(PASSWORD_PADDING, fileId));
    for (let round = 1; round <= 19; round += 1) value = rc4(xorKey(fileKey, round), value);
    return sameBytes(value, user.subarray(0, 16));
  };

  const paddedPassword = padPassword(password);
  const empty = password.length === 0;
  const userKey = fileKeyFor(paddedPassword);
  if (userMatches(userKey)) return { fileKey: userKey, password: "user", empty };

  // Algorithm 7: the owner password recovers the padded user password.
  let ownerKey = md5(paddedPassword);
  if (revision >= 3) {
    for (let index = 0; index < 50; index += 1) ownerKey = md5(ownerKey);
  }
  ownerKey = ownerKey.subarray(0, length);
  let userPassword = ownerEntry;
  if (revision === 2) {
    userPassword = rc4(ownerKey, userPassword);
  } else {
    for (let round = 19; round >= 0; round -= 1) userPassword = rc4(xorKey(ownerKey, round), userPassword);
  }
  const ownerFileKey = fileKeyFor(userPassword);
  return userMatches(ownerFileKey) ? { fileKey: ownerFileKey, password: "owner", empty } : null;
}

/** Algorithm 2 step (a): pad or truncate a password to exactly 32 bytes. */
function padPassword(password: Uint8Array): Uint8Array {
  const padded = new Uint8Array(32);
  padded.set(password.subarray(0, 32));
  padded.set(PASSWORD_PADDING.subarray(0, 32 - Math.min(32, password.length)), Math.min(32, password.length));
  return padded;
}

/** Algorithms 2.A and 11/12 for revisions 5 and 6: `password` as user, then owner. */
function authenticateAes256(
  revision: number,
  owner: Uint8Array,
  user: Uint8Array,
  dictionary: PdfDictionary,
  password: Uint8Array
): Authentication | null {
  if (revision !== 5 && revision !== 6) {
    throw unsupportedEncryption(
      `The PDF uses unsupported Standard security handler revision ${revision}.`,
      { reason: "unsupported-revision", revision }
    );
  }
  const ownerEncryptedKey = stringBytes(dictionary.get("OE"));
  const userEncryptedKey = stringBytes(dictionary.get("UE"));
  if (
    owner.length < 48 || user.length < 48 ||
    ownerEncryptedKey === undefined || ownerEncryptedKey.length < 32 ||
    userEncryptedKey === undefined || userEncryptedKey.length < 32
  ) {
    throw unsupportedEncryption(
      "The AES-256 encryption dictionary has invalid /O, /U, /OE or /UE entries.",
      { reason: "malformed-encryption-dictionary" }
    );
  }
  const hash = (salt: Uint8Array, userData: Uint8Array): Uint8Array =>
    revision === 5
      ? sha256(concatBytes([password, salt, userData]))
      : hardenedHash(password, salt, userData);
  const userData = user.subarray(0, 48);
  const decryptKey = (intermediate: Uint8Array, encrypted: Uint8Array): Uint8Array =>
    new AesKey(intermediate).decryptCbc(encrypted.subarray(0, 32), ZERO_IV);
  const empty = password.length === 0;

  if (sameBytes(hash(user.subarray(32, 40), EMPTY), user.subarray(0, 32))) {
    return {
      fileKey: decryptKey(hash(user.subarray(40, 48), EMPTY), userEncryptedKey),
      password: "user",
      empty
    };
  }
  if (sameBytes(hash(owner.subarray(32, 40), userData), owner.subarray(0, 32))) {
    return {
      fileKey: decryptKey(hash(owner.subarray(40, 48), userData), ownerEncryptedKey),
      password: "owner",
      empty
    };
  }
  return null;
}

/**
 * Algorithm 2.B. The password and user data are mixed into every round as
 * the standard requires; the user data is empty for user-password hashes.
 */
function hardenedHash(password: Uint8Array, salt: Uint8Array, userData: Uint8Array): Uint8Array {
  let key = sha256(concatBytes([password, salt, userData]));
  for (let round = 0; ; round += 1) {
    const block = concatBytes([password, key, userData]);
    const repeated = new Uint8Array(block.length * 64);
    for (let index = 0; index < 64; index += 1) repeated.set(block, index * block.length);
    const encrypted = new AesKey(key.subarray(0, 16)).encryptCbc(repeated, key.subarray(16, 32));
    let sum = 0;
    for (let index = 0; index < 16; index += 1) sum += encrypted[index];
    const remainder = sum % 3;
    key = remainder === 0 ? sha256(encrypted) : remainder === 1 ? sha384(encrypted) : sha512(encrypted);
    if (round >= 63 && encrypted[encrypted.length - 1] <= round - 31) return key.subarray(0, 32);
  }
}

/**
 * Remove a leading /Crypt filter (ISO 32000-2, 7.4.10) from a decrypted
 * stream dictionary and return the crypt filter it names.
 */
function takeCryptFilter(
  dictionary: PdfDictionary,
  filters: ReadonlyMap<string, CryptFilter>
): CryptFilter | undefined {
  const filterValue = dictionary.get("Filter");
  const first = Array.isArray(filterValue) ? filterValue[0] : filterValue;
  if (!isPdfName(first, "Crypt")) return undefined;
  const parameterKey = dictionary.has("DecodeParms") ? "DecodeParms" : "DP";
  const parameters = dictionary.get(parameterKey);
  const firstParameters = Array.isArray(parameters) ? parameters[0] : parameters;
  const name = isPdfDictionary(firstParameters) ? firstParameters.get("Name") : undefined;
  if (Array.isArray(filterValue)) {
    if (filterValue.length > 1) dictionary.set("Filter", filterValue.slice(1));
    else dictionary.delete("Filter");
    if (Array.isArray(parameters)) {
      if (parameters.length > 1) dictionary.set(parameterKey, parameters.slice(1));
      else dictionary.delete(parameterKey);
    }
  } else {
    dictionary.delete("Filter");
    dictionary.delete(parameterKey);
  }
  return namedFilter(filters, name);
}

function namedFilter(filters: ReadonlyMap<string, CryptFilter>, name: PdfValue | undefined): CryptFilter {
  if (name === undefined || name === null) return IDENTITY_FILTER;
  if (!isPdfName(name)) {
    throw unsupportedEncryption("A PDF crypt filter reference is not a name.", { reason: "crypt-filter-name" });
  }
  const filter = filters.get(name.value);
  if (!filter) {
    throw unsupportedEncryption(`The PDF references undefined crypt filter /${name.value}.`, {
      reason: "undefined-crypt-filter",
      filter: name.value
    });
  }
  return filter;
}

function readCryptMethod(value: PdfValue | undefined, name: string): CryptMethod {
  if (value === undefined || value === null || isPdfName(value, "None")) return "identity";
  if (isPdfName(value, "V2")) return "rc4";
  if (isPdfName(value, "AESV2")) return "aes-128";
  if (isPdfName(value, "AESV3")) return "aes-256";
  throw unsupportedEncryption(
    `Crypt filter /${name} uses an unsupported method${isPdfName(value) ? ` /${value.value}` : ""}.`,
    { reason: "crypt-filter-method", filter: name }
  );
}

/** /Length is in bits; some producers write bytes in crypt filter dictionaries. */
function readKeyLengthBytes(value: PdfValue | undefined): number | undefined {
  const length = optionalInteger(value);
  if (length === undefined || length <= 0) return undefined;
  const bits = length <= 16 ? length * 8 : length;
  if (bits < 40 || bits > 128 || bits % 8 !== 0) return undefined;
  return bits / 8;
}

function describeAlgorithm(filter: CryptFilter, keyLength: number): string {
  switch (filter.method) {
    case "identity":
      return "identity crypt filters";
    case "rc4":
      return `RC4 ${keyLength * 8}-bit`;
    case "aes-128":
      return "AES 128-bit";
    case "aes-256":
      return "AES 256-bit";
  }
}

function optionalInteger(value: PdfValue | undefined): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}

function stringBytes(value: PdfValue | undefined): Uint8Array | undefined {
  return isPdfString(value) ? value.bytes : undefined;
}

function xorKey(key: Uint8Array, value: number): Uint8Array {
  const output = new Uint8Array(key.length);
  for (let index = 0; index < key.length; index += 1) output[index] = key[index] ^ value;
  return output;
}

function sameBytes(first: Uint8Array, second: Uint8Array): boolean {
  if (first.length !== second.length) return false;
  for (let index = 0; index < first.length; index += 1) {
    if (first[index] !== second[index]) return false;
  }
  return true;
}

function unsupportedEncryption(
  message: string,
  details: Readonly<Record<string, string | number | boolean | null>>
): PdfError {
  return new PdfError("encrypted", message, { details });
}
