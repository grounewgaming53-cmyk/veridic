/* ========================================================================
   VERIDIC payments — admin authentication
   ------------------------------------------------------------------------
   A single admin identity, entirely separate from the customer-facing
   (currently client-side/demo) login system. The password never sits in
   this codebase — only its scrypt hash does, read from the environment.

   Session model: on a correct password, we mint a random opaque token
   (32 bytes, base64url — not a JWT, nothing is encoded in it), store it
   server-side in admin_sessions with an expiry, and hand the browser only
   that token in an HttpOnly cookie. Every subsequent request looks the
   token up in the database. This means a session can be revoked
   instantly (delete the row) — a signed/stateless token could not be.

   Cookie flags:
     HttpOnly  — client-side JavaScript, on this site or any other, can
                 never read this cookie. An XSS bug elsewhere on the site
                 still could not exfiltrate the admin session.
     Secure    — only ever sent over HTTPS (browsers also treat
                 http://localhost as a secure context, so this still
                 works for local development).
     SameSite=Strict — never sent on a cross-site request, including a
                 top-level navigation from a link on another site. This
                 is the single strongest available CSRF defense for a
                 page that has no reason to ever be reached cross-site.
   ======================================================================== */

import crypto from 'node:crypto';
import { config } from './config.js';
import {
  createAdminSession, getValidAdminSession, touchAdminSession,
  deleteAdminSession, pruneExpiredAdminSessions,
} from './db.js';

const COOKIE_NAME = 'veridic_admin';
const SESSION_TTL_MS = config.admin.sessionTtlHours * 60 * 60 * 1000;

/* ----------------------------------------------------------- passwords */

/* Format stored in ADMIN_PASSWORD_HASH: "scrypt:<saltHex>:<hashHex>".
   Generate one with: node server/scripts/hash-admin-password.mjs */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64);
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  if (!stored) return false;
  const parts = String(stored).split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;

  const [, saltHex, hashHex] = parts;
  try {
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(String(password), salt, expected.length);
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false; // malformed stored hash — never treat as a match
  }
}

export const adminConfigured = () => Boolean(config.admin.passwordHash);

/* ------------------------------------------------------- login attempts
   Admin login is a single, high-value, internet-reachable target — worth
   a tighter lockout than the general API throttle. Keyed by IP; an
   attacker who cannot solve the password from a given vantage point is
   made to wait, not permanently blocked (a fixed lockout would itself be
   a denial-of-service lever against the real admin). */

const ATTEMPT_LIMIT = 6;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const attempts = new Map();

function isLockedOut(key) {
  const rec = attempts.get(key);
  if (!rec) return false;
  if (Date.now() > rec.reset) {
    attempts.delete(key);
    return false;
  }
  return rec.count >= ATTEMPT_LIMIT;
}

function recordFailedAttempt(key) {
  const rec = attempts.get(key);
  if (!rec || Date.now() > rec.reset) {
    attempts.set(key, { count: 1, reset: Date.now() + ATTEMPT_WINDOW_MS });
  } else {
    rec.count++;
  }
}

function clearAttempts(key) {
  attempts.delete(key);
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of attempts) if (now > v.reset) attempts.delete(k);
  pruneExpiredAdminSessions();
}, 5 * 60 * 1000).unref();

/* --------------------------------------------------------------- cookies
   No `cookie` dependency — the parsing/serialising this needs is a
   handful of lines, and the project otherwise depends on nothing but
   express. */

export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const val = part.slice(eq + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  }
  return out;
}

function serializeCookie(name, value, { maxAgeSeconds, clear = false } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push('Path=/');
  parts.push('HttpOnly');
  parts.push('SameSite=Strict');
  if (config.publicUrl.startsWith('https://') || config.env === 'production') parts.push('Secure');
  parts.push(clear ? 'Max-Age=0' : `Max-Age=${maxAgeSeconds}`);
  return parts.join('; ');
}

/* ------------------------------------------------------------- actions */

export function attemptLogin({ password, ip }) {
  const key = ip || 'unknown';

  if (isLockedOut(key)) {
    return { ok: false, status: 429, error: 'Too many attempts. Try again in a few minutes.' };
  }

  if (!adminConfigured()) {
    return { ok: false, status: 503, error: 'Admin login is not configured on this server.' };
  }

  if (!verifyPassword(password, config.admin.passwordHash)) {
    recordFailedAttempt(key);
    return { ok: false, status: 401, error: 'Incorrect password.' };
  }

  clearAttempts(key);

  const token = crypto.randomBytes(32).toString('base64url');
  createAdminSession(token, SESSION_TTL_MS, ip || null);

  return {
    ok: true,
    cookie: serializeCookie(COOKIE_NAME, token, { maxAgeSeconds: Math.floor(SESSION_TTL_MS / 1000) }),
  };
}

export function logout(token) {
  if (token) deleteAdminSession(token);
  return { cookie: serializeCookie(COOKIE_NAME, '', { clear: true }) };
}

/** True when the request carries a valid, unexpired admin session cookie.
    Single source of truth for "is this the admin" — both the middleware
    and the unauthenticated /status route go through it, so there is only
    one implementation of the check to get right. */
export function isSignedIn(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  return Boolean(getValidAdminSession(token));
}

/** Express middleware: attaches req.adminToken when a valid session cookie
    is present, otherwise responds 401. Also slides the session forward
    (touchAdminSession) so an active admin isn't logged out mid-use. */
export function requireAdmin(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[COOKIE_NAME];
  const session = getValidAdminSession(token);

  if (!session) {
    return res.status(401).json({ error: 'Not signed in.' });
  }

  touchAdminSession(token);
  req.adminToken = token;
  next();
}

/** Lightweight CSRF defense for state-changing admin routes: a cross-site
    <form> POST (the classic CSRF vector) cannot set a custom header, and
    SameSite=Strict already blocks the cookie from riding along on a
    cross-site request in the first place — this is a second, independent
    layer in case a browser's SameSite handling is ever weaker than
    expected. */
export function requireAdminHeader(req, res, next) {
  if (req.headers['x-veridic-admin'] !== '1') {
    return res.status(403).json({ error: 'Missing required header.' });
  }
  next();
}

export function readAdminToken(req) {
  return parseCookies(req.headers.cookie)[COOKIE_NAME];
}

export { COOKIE_NAME };
