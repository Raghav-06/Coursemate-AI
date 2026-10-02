import crypto from "node:crypto";
import { Router } from "express";
import passport from "passport";
import { config } from "../config/index.js";
import { googleConfigured } from "../auth/passport.js";
import { burnPasswordCheck, hashPassword, passwordProblem, verifyPassword } from "../auth/password.js";
import { hit, reset } from "../auth/rateLimit.js";
import { sendVerificationCode } from "../services/mailer.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  consumeEmailVerification,
  createEmailVerification,
  getUserCredentials,
  latestEmailVerification,
  markEmailVerified,
  recordVerificationAttempt,
  retireEmailVerifications,
  setPasswordForEmail,
  touchLogin,
} from "../db/store.js";

export const authRouter = Router();

// Public shape of a signed-in user.
export function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    givenName: user.givenName,
    avatarUrl: user.avatarUrl,
    hasPassword: Boolean(user.hasPassword),
    hasGoogle: Boolean(user.hasGoogle),
    createdAt: user.createdAt,
  };
}

const loginErrorRedirect = (message) => `${config.clientUrl}/?authError=${encodeURIComponent(message)}`;

// Only same-site relative paths are accepted as post-login destinations.
function safeReturnTo(value) {
  return typeof value === "string" && /^\/(?!\/)/.test(value) ? value : "/";
}

// Step 1: send the browser to Google's consent screen.
authRouter.get("/google", (req, res, next) => {
  if (!googleConfigured()) {
    return res.redirect(loginErrorRedirect("Google sign-in isn't configured on the server (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)."));
  }
  req.session.returnTo = safeReturnTo(req.query.returnTo);
  passport.authenticate("google", { prompt: "select_account" })(req, res, next);
});

// Step 2: Google redirects back here with a code; Passport exchanges it,
// upserts the user in Postgres and starts a session.
authRouter.get("/google/callback", (req, res, next) => {
  if (!googleConfigured()) return res.redirect(loginErrorRedirect("Google sign-in isn't configured."));
  passport.authenticate("google", (err, user, info) => {
    if (err) {
      if (!err.expose) console.error("Google sign-in failed:", err);
      return res.redirect(loginErrorRedirect(err.expose ? err.message : "Google sign-in failed. Please try again."));
    }
    if (!user) return res.redirect(loginErrorRedirect(info?.message || "Sign-in was cancelled."));

    const returnTo = safeReturnTo(req.session.returnTo);
    // login() regenerates the session id (prevents session fixation).
    req.logIn(user, (loginErr) => {
      if (loginErr) return next(loginErr);
      res.redirect(`${config.clientUrl}${returnTo}`);
    });
  })(req, res, next);
});

// Current user, or 401 when signed out.
authRouter.get("/me", (req, res) => {
  if (!req.isAuthenticated() || !req.user) return res.status(401).json({ message: "Not signed in." });
  res.json(publicUser(req.user));
});

authRouter.post("/logout", (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.session.destroy(() => {
      res.clearCookie(config.auth.cookieName);
      res.status(204).end();
    });
  });
});

// ---- Email + password -----------------------------------------------------------
//
// Sign-up and password reset share one flow:
//   1. POST /auth/email/start    { email, purpose: "signup" | "reset" }  → emails a 6-digit code
//   2. POST /auth/email/verify   { email, purpose, code }                → marks the email verified in this session
//   3. POST /auth/email/complete { password, name? }                     → saves the password hash, signs in
// Then POST /auth/login { email, password } signs in.

const { email: emailCfg } = config;
const PURPOSES = ["signup", "reset"];
const VERIFIED_SESSION_MS = 15 * 60 * 1000;
const FIFTEEN_MIN = 15 * 60 * 1000;

const httpError = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });

function normalizeEmail(value) {
  const email = String(value ?? "").trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw httpError(400, "Enter a valid email address.");
  return email;
}

function normalizePurpose(value) {
  if (!PURPOSES.includes(value)) throw httpError(400, "Unknown verification purpose.");
  return value;
}

// Codes are stored as a keyed hash bound to the email and purpose.
function hashCode(email, purpose, code) {
  return crypto
    .createHmac("sha256", config.auth.sessionSecret || "dev-only-insecure-secret-change-me")
    .update(`${email}|${purpose}|${code}`)
    .digest("hex");
}

function sameHash(a, b) {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function logIn(req, user) {
  return new Promise((resolve, reject) => req.logIn(user, (err) => (err ? reject(err) : resolve())));
}

authRouter.post(
  "/email/start",
  asyncHandler(async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const purpose = normalizePurpose(req.body?.purpose ?? "signup");

    if (!hit(`start-ip:${req.ip}`, 20, FIFTEEN_MIN)) throw httpError(429, "Too many requests. Try again in a few minutes.");

    const latest = await latestEmailVerification(email, purpose);
    if (latest && Number(latest.age_seconds) < emailCfg.resendSeconds) {
      const wait = Math.ceil(emailCfg.resendSeconds - Number(latest.age_seconds));
      throw httpError(429, `Please wait ${wait}s before requesting another code.`, { retryAfter: wait });
    }

    const existing = await getUserCredentials(email);
    if (purpose === "signup" && existing?.passwordHash) {
      throw httpError(409, "An account with this email already exists. Sign in instead, or reset your password.");
    }

    const response = { ok: true, email, purpose, expiresInMinutes: emailCfg.codeTtlMinutes, resendInSeconds: emailCfg.resendSeconds };

    // Password reset for an unknown email: answer the same way but send nothing.
    if (purpose === "reset" && !existing) return res.json(response);

    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
    const created = await createEmailVerification({
      email,
      purpose,
      codeHash: hashCode(email, purpose, code),
      ttlMinutes: emailCfg.codeTtlMinutes,
    });
    await retireEmailVerifications(email, purpose, created.id);

    try {
      await sendVerificationCode(email, code, purpose, emailCfg.codeTtlMinutes);
    } catch (err) {
      await retireEmailVerifications(email, purpose);
      console.error("Sending verification email failed:", err.message);
      throw httpError(err.status ?? 502, err.status ? err.message : "We couldn't send the email. Check the address and try again.");
    }
    res.json(response);
  })
);

authRouter.post(
  "/email/verify",
  asyncHandler(async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const purpose = normalizePurpose(req.body?.purpose ?? "signup");
    const code = String(req.body?.code ?? "").replace(/\D/g, "");
    if (code.length !== 6) throw httpError(400, "Enter the 6-digit code from the email.");

    const record = await latestEmailVerification(email, purpose);
    if (!record || record.expired) throw httpError(400, "This code has expired. Request a new one.");
    if (record.attempts >= emailCfg.maxAttempts) throw httpError(429, "Too many incorrect attempts. Request a new code.");

    if (!sameHash(record.code_hash, hashCode(email, purpose, code))) {
      const attempts = await recordVerificationAttempt(record.id);
      const left = emailCfg.maxAttempts - attempts;
      throw httpError(400, left > 0 ? `That code isn't right. ${left} attempt${left === 1 ? "" : "s"} left.` : "Too many incorrect attempts. Request a new code.");
    }

    await markEmailVerified(record.id);
    req.session.pendingEmail = { id: record.id, email, purpose, verifiedAt: Date.now() };
    res.json({ ok: true, email, purpose });
  })
);

authRouter.post(
  "/email/complete",
  asyncHandler(async (req, res) => {
    const pending = req.session.pendingEmail;
    if (!pending) throw httpError(400, "Verify your email with the code we sent before setting a password.");
    if (Date.now() - pending.verifiedAt > VERIFIED_SESSION_MS) {
      delete req.session.pendingEmail;
      throw httpError(400, "Your verification expired. Start again to get a new code.");
    }

    const password = String(req.body?.password ?? "");
    const problem = passwordProblem(password, { minLength: emailCfg.passwordMinLength, email: pending.email });
    if (problem) throw httpError(400, problem);

    const name = String(req.body?.name ?? "").trim().slice(0, 100);
    if (pending.purpose === "signup") {
      if (!name) throw httpError(400, "Enter your name.");
      const existing = await getUserCredentials(pending.email);
      if (existing?.passwordHash) throw httpError(409, "An account with this email already exists. Sign in instead.");
    }

    if (!(await consumeEmailVerification(pending.id))) {
      delete req.session.pendingEmail;
      throw httpError(400, "This verification was already used. Start again.");
    }

    const user = await setPasswordForEmail(pending.email, await hashPassword(password), { name });
    await retireEmailVerifications(pending.email, pending.purpose);
    delete req.session.pendingEmail;
    reset(`login:${pending.email}`);

    await logIn(req, user);
    res.status(pending.purpose === "signup" ? 201 : 200).json(publicUser(user));
  })
);

authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password ?? "");
    if (!password) throw httpError(400, "Enter your password.");

    if (!hit(`login-ip:${req.ip}`, 30, FIFTEEN_MIN) || !hit(`login:${email}`, 10, FIFTEEN_MIN)) {
      throw httpError(429, "Too many sign-in attempts. Wait 15 minutes or reset your password.");
    }

    const creds = await getUserCredentials(email);
    if (!creds?.passwordHash) {
      await burnPasswordCheck(password);
      if (creds?.user.hasGoogle) {
        throw httpError(401, "This account signs in with Google. Use \"Sign in with Google\", or reset your password to add one.");
      }
      throw httpError(401, "Incorrect email or password.");
    }
    if (!(await verifyPassword(password, creds.passwordHash))) throw httpError(401, "Incorrect email or password.");

    reset(`login:${email}`);
    await touchLogin(creds.user.id);
    await logIn(req, creds.user);
    res.json(publicUser(creds.user));
  })
);
