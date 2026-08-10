/**
 * Field-level encryption for credential secrets (D-10).
 *
 * AES-256-GCM with a per-value random 12-byte IV. The master key is a 32-byte
 * key sourced from MCPRELAY_MASTER_KEY (base64-decoded). Each encrypted value is
 * stored as a single base64 blob containing IV || ciphertext || authTag, so the
 * store holds one opaque string per secret.
 *
 * Non-secret metadata is stored in plaintext by the credential store; only this
 * module ever sees the raw key material.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEY_BYTES = 32; // AES-256
const IV_BYTES = 12; // GCM standard 96-bit nonce
const TAG_BYTES = 16;

export class MasterKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MasterKeyError";
  }
}

/**
 * Decode the master key from a base64 env value. Throws MasterKeyError if the
 * key is missing, empty, or not exactly 32 bytes when decoded. The connector
 * fails fast on a bad key (D-10): it must never start unencrypted.
 */
export function loadMasterKey(envValue: string | undefined): Buffer {
  if (!envValue || envValue.trim() === "") {
    throw new MasterKeyError(
      "MCPRELAY_MASTER_KEY is missing or empty. Generate one with `openssl rand -base64 32` and provide it via the environment.",
    );
  }
  let key: Buffer;
  try {
    key = Buffer.from(envValue.trim(), "base64");
  } catch {
    throw new MasterKeyError("MCPRELAY_MASTER_KEY is not valid base64.");
  }
  if (key.length !== KEY_BYTES) {
    throw new MasterKeyError(
      `MCPRELAY_MASTER_KEY must decode to ${KEY_BYTES} bytes (got ${key.length}). Use \`openssl rand -base64 32\`.`,
    );
  }
  return key;
}

/**
 * Encrypt a secret string. Returns base64(IV || ciphertext || authTag).
 */
export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ct, tag]).toString("base64");
}

/**
 * Decrypt a secret produced by encryptSecret. Throws on tamper (auth tag
 * mismatch) — the credential is treated as corrupted/revoked by the caller.
 */
export function decryptSecret(blob: string, key: Buffer): string {
  const buf = Buffer.from(blob, "base64");
  if (buf.length < IV_BYTES + TAG_BYTES) {
    throw new Error("encrypted secret is too short (corrupt or truncated)");
  }
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(buf.length - TAG_BYTES);
  const ct = buf.subarray(IV_BYTES, buf.length - TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}

/**
 * Hash a downstream API key (D-13) with scrypt. Returns
 * `scrypt:N:r:p:saltHex:hashHex` so verification is self-describing and the
 * parameters can evolve. scrypt resists brute force and verifies in constant
 * time via timingSafeEqual.
 */
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 32;

export function hashApiKey(apiKey: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(apiKey, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `scrypt:${SCRYPT_N}:${SCRYPT_R}:${SCRYPT_P}:${salt.toString("hex")}:${hash.toString("hex")}`;
}

/**
 * Verify a downstream API key against a stored scrypt hash. Constant-time.
 */
export function verifyApiKey(apiKey: string, stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4], "hex");
  const expected = Buffer.from(parts[5], "hex");
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  let actual: Buffer;
  try {
    actual = scryptSync(apiKey, salt, expected.length, { N, r, p });
  } catch {
    return false;
  }
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/**
 * A non-reversible fingerprint for logging (D-13): first 4 chars + length,
 * matching the G1 test-server style (e.g. `Bearer g***P(len=32)`).
 */
export function apiKeyFingerprint(apiKey: string): string {
  if (!apiKey) return "(empty)";
  const len = apiKey.length;
  const head = apiKey.slice(0, 4);
  const tail = apiKey.slice(-1);
  return `${head}***${tail}(len=${len})`;
}
