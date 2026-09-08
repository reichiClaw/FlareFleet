const enc = new TextEncoder();

function toHex(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function randomToken(bytes = 32): string {
  return toHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

export function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

export async function sha256Hex(data: ArrayBuffer | Uint8Array | string): Promise<string> {
  const buf = typeof data === "string" ? enc.encode(data) : data;
  return toHex(await crypto.subtle.digest("SHA-256", buf as BufferSource));
}

// Cloudflare Workers reject PBKDF2 with more than 100,000 iterations
// ("Pbkdf2 failed: iterations too high"), and the free plan allows only ~10 ms
// CPU per request, which fits roughly 20,000 iterations. The default is
// therefore modest; raise PBKDF2_ITERATIONS on a paid plan. Password hashes
// carry their own iteration count, so the value can change at any time and
// existing users are re-hashed transparently on their next login.
export const PBKDF2_MAX_ITERATIONS = 100_000;
export const PBKDF2_DEFAULT_ITERATIONS = 20_000;

export function pbkdf2Iterations(env: { PBKDF2_ITERATIONS?: string }): number {
  const n = Number(env.PBKDF2_ITERATIONS);
  if (!Number.isFinite(n) || n <= 0) return PBKDF2_DEFAULT_ITERATIONS;
  return Math.min(PBKDF2_MAX_ITERATIONS, Math.max(1_000, Math.floor(n)));
}

export async function hashPassword(password: string, iterations = PBKDF2_DEFAULT_ITERATIONS): Promise<string> {
  const salt = randomBytes(16);
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return `pbkdf2$${iterations}$${toHex(salt)}$${toHex(bits)}`;
}

/** True when a stored hash was made with a different iteration count than currently configured. */
export function needsRehash(stored: string, iterations: number): boolean {
  const parts = stored.split("$");
  return parts[0] === "pbkdf2" && Number(parts[1]) !== iterations;
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const [scheme, iterStr, saltHex, hashHex] = stored.split("$");
  if (scheme !== "pbkdf2") return false;
  const iterations = Number(iterStr);
  // Hashes above the platform cap cannot be verified here; treat as a mismatch so the
  // user gets "invalid credentials" and can use the password reset (which re-hashes).
  if (!Number.isFinite(iterations) || iterations > PBKDF2_MAX_ITERATIONS) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: fromHex(saltHex), iterations }, key, 256);
  const a = toHex(bits);
  if (a.length !== hashHex.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ hashHex.charCodeAt(i);
  return diff === 0;
}

export function generatePassword(length = 12): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(length);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}
