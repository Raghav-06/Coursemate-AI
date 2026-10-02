import crypto from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt);

// scrypt parameters (N=2^15, r=8, p=1): ~32MB and well under 100ms per hash.
const N = 32768;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const MAXMEM = 64 * 1024 * 1024;

/** Hashes a password as "scrypt$N$r$p$salt$hash" (salt and hash base64). */
export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, { N, r: R, p: P, maxmem: MAXMEM });
  return ["scrypt", N, R, P, salt.toString("base64"), hash.toString("base64")].join("$");
}

export async function verifyPassword(password, stored) {
  if (typeof stored !== "string") return false;
  const [scheme, n, r, p, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scrypt(password.normalize("NFKC"), Buffer.from(saltB64, "base64"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: MAXMEM,
  });
  return crypto.timingSafeEqual(actual, expected);
}

// Used when no account exists, so a wrong email takes as long as a wrong password.
let dummyHash;
export async function burnPasswordCheck(password) {
  dummyHash ??= await hashPassword("not-a-real-password");
  await verifyPassword(password, dummyHash);
}

/** Returns an error message, or null if the password is acceptable. */
export function passwordProblem(password, { minLength, email }) {
  if (typeof password !== "string" || password.length < minLength) return `Use at least ${minLength} characters.`;
  if (password.length > 200) return "Use 200 characters or fewer.";
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return "Use a mix of letters and numbers.";
  if (email && password.toLowerCase().includes(email.split("@")[0].toLowerCase()) && email.split("@")[0].length >= 4) {
    return "Don't include your email name in your password.";
  }
  return null;
}
