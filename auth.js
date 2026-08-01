/* ========================================================================
   VERIDIC — Client-side auth module
   ------------------------------------------------------------------------
   DEMO AUTHENTICATION. Accounts live in this browser's localStorage and
   never leave the device. Passwords are salted and key-stretched before
   storage (PBKDF2-HMAC-SHA256 where crypto.subtle is available, an
   iterated SHA-256 fallback otherwise), so a casual look at localStorage
   will not reveal them — but anything running in this page can read the
   store. This is a front-end demo, NOT a security boundary. Swap
   `Store` + `Auth.signIn/signUp` for real server calls before treating
   any of this as protection.

   Public surface:  window.VeridicAuth
   ======================================================================== */

(function (global) {
  'use strict';

  const USERS_KEY = 'veridic.users.v1';
  const SESSION_KEY = 'veridic.session.v1';
  const ACTIVITY_KEY = 'veridic.activity.v1';

  const PBKDF2_ITERATIONS = 150000;
  const FALLBACK_ITERATIONS = 20000;
  const SESSION_MS = 1000 * 60 * 60 * 12;         // 12 hours
  const REMEMBER_MS = 1000 * 60 * 60 * 24 * 30;   // 30 days
  const MAX_ATTEMPTS = 5;
  const LOCKOUT_MS = 1000 * 60 * 5;               // 5 minutes

  /* ---------------------------------------------------------------- utils */

  const enc = new TextEncoder();

  function toHex(bytes) {
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  function fromHex(hex) {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }

  function randomHex(byteLength) {
    const buf = new Uint8Array(byteLength);
    (global.crypto || global.msCrypto).getRandomValues(buf);
    return toHex(buf);
  }

  /* Constant-time-ish string compare — avoids leaking match position. */
  function safeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  /* ------------------------------------------------------------- hashing */

  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  /* Compact synchronous SHA-256 — used only when crypto.subtle is absent
     (e.g. the page was opened over file:// rather than http/https). */
  function sha256Hex(str) {
    const rr = (x, n) => (x >>> n) | (x << (32 - n));
    let H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
             0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

    const msg = enc.encode(str);
    const blocks = Math.ceil((msg.length + 9) / 64);
    const total = blocks * 64;
    const buf = new Uint8Array(total);
    buf.set(msg);
    buf[msg.length] = 0x80;

    const dv = new DataView(buf.buffer);
    const bitLen = msg.length * 8;
    dv.setUint32(total - 8, Math.floor(bitLen / 4294967296), false);
    dv.setUint32(total - 4, bitLen >>> 0, false);

    const w = new Uint32Array(64);
    for (let i = 0; i < blocks; i++) {
      for (let j = 0; j < 16; j++) w[j] = dv.getUint32(i * 64 + j * 4, false);
      for (let j = 16; j < 64; j++) {
        const x = w[j - 15], y = w[j - 2];
        const s0 = rr(x, 7) ^ rr(x, 18) ^ (x >>> 3);
        const s1 = rr(y, 17) ^ rr(y, 19) ^ (y >>> 10);
        w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let j = 0; j < 64; j++) {
        const S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (h + S1 + ch + K[j] + w[j]) >>> 0;
        const S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0;
        d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      const add = [a, b, c, d, e, f, g, h];
      H = H.map((v, idx) => (v + add[idx]) >>> 0);
    }
    return H.map((v) => v.toString(16).padStart(8, '0')).join('');
  }

  const subtle = (global.crypto && global.crypto.subtle) || null;

  async function derive(password, saltHex, algo) {
    if (algo === 'pbkdf2-sha256' && subtle) {
      const key = await subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
      const bits = await subtle.deriveBits(
        { name: 'PBKDF2', salt: fromHex(saltHex), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
        key, 256
      );
      return toHex(new Uint8Array(bits));
    }
    // Fallback: iterated SHA-256. Weaker than PBKDF2 but still stretched.
    let acc = sha256Hex(saltHex + password);
    for (let i = 0; i < FALLBACK_ITERATIONS; i++) acc = sha256Hex(acc + saltHex);
    return acc;
  }

  const preferredAlgo = () => (subtle ? 'pbkdf2-sha256' : 'sha256-iter');

  /* --------------------------------------------------------------- store */

  const Store = {
    available() {
      try {
        const probe = '__veridic_probe__';
        localStorage.setItem(probe, '1');
        localStorage.removeItem(probe);
        return true;
      } catch (_) {
        return false;
      }
    },
    read(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch (_) {
        return fallback;
      }
    },
    write(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch (_) {
        return false;
      }
    },
    remove(key) {
      try { localStorage.removeItem(key); } catch (_) { /* ignore */ }
    },
  };

  const allUsers = () => Store.read(USERS_KEY, {});
  const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

  /* ---------------------------------------------------------- validation */

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

  function passwordScore(password) {
    const pw = String(password || '');
    let score = 0;
    if (pw.length >= 8) score++;
    if (pw.length >= 12) score++;
    if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
    if (/\d/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;
    return Math.min(score, 5);
  }

  function passwordProblem(password) {
    const pw = String(password || '');
    if (pw.length < 8) return 'Password must be at least 8 characters.';
    if (!/[A-Za-z]/.test(pw)) return 'Password must contain at least one letter.';
    if (!/\d/.test(pw)) return 'Password must contain at least one number.';
    return null;
  }

  /* -------------------------------------------------------------- session */

  function readSession() {
    const s = Store.read(SESSION_KEY, null);
    if (!s || !s.email || !s.expiresAt) return null;
    if (Date.now() > s.expiresAt) {
      Store.remove(SESSION_KEY);
      return null;
    }
    return s;
  }

  function writeSession(email, remember) {
    const ttl = remember ? REMEMBER_MS : SESSION_MS;
    Store.write(SESSION_KEY, {
      email,
      token: randomHex(24),
      remember: !!remember,
      issuedAt: Date.now(),
      expiresAt: Date.now() + ttl,
    });
  }

  function logActivity(type, detail) {
    const log = Store.read(ACTIVITY_KEY, []);
    log.unshift({ type, detail: detail || '', at: Date.now() });
    Store.write(ACTIVITY_KEY, log.slice(0, 25));
  }

  /* ----------------------------------------------------------------- API */

  const Auth = {
    isDemo: true,
    storageAvailable: Store.available(),
    strongCrypto: !!subtle,

    passwordScore,
    passwordProblem,

    currentUser() {
      const session = readSession();
      if (!session) return null;
      const user = allUsers()[session.email];
      if (!user) {
        Store.remove(SESSION_KEY);
        return null;
      }
      return {
        name: user.name,
        email: user.email,
        plan: user.plan || 'Community',
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt || null,
        loginCount: user.loginCount || 0,
      };
    },

    isAuthenticated() {
      return this.currentUser() !== null;
    },

    activity() {
      return Store.read(ACTIVITY_KEY, []);
    },

    async signUp({ name, email, password, plan }) {
      if (!this.storageAvailable) {
        return { ok: false, error: 'Browser storage is unavailable. Demo accounts need localStorage.' };
      }

      const cleanName = String(name || '').trim();
      const cleanEmail = normalizeEmail(email);

      if (cleanName.length < 2) return { ok: false, field: 'name', error: 'Please enter your name.' };
      if (!EMAIL_RE.test(cleanEmail)) return { ok: false, field: 'email', error: 'Enter a valid email address.' };

      const pwProblem = passwordProblem(password);
      if (pwProblem) return { ok: false, field: 'password', error: pwProblem };

      const users = allUsers();
      if (users[cleanEmail]) {
        return { ok: false, field: 'email', error: 'An account already exists for this email.' };
      }

      const algo = preferredAlgo();
      const salt = randomHex(16);
      const hash = await derive(password, salt, algo);

      users[cleanEmail] = {
        name: cleanName,
        email: cleanEmail,
        plan: plan || 'Community',
        algo,
        salt,
        hash,
        createdAt: Date.now(),
        lastLoginAt: Date.now(),
        loginCount: 1,
        failedAttempts: 0,
        lockedUntil: 0,
      };
      Store.write(USERS_KEY, users);
      writeSession(cleanEmail, false);
      logActivity('signup', cleanEmail);

      return { ok: true, user: this.currentUser() };
    },

    async signIn({ email, password, remember }) {
      if (!this.storageAvailable) {
        return { ok: false, error: 'Browser storage is unavailable. Demo accounts need localStorage.' };
      }

      const cleanEmail = normalizeEmail(email);
      const users = allUsers();
      const user = users[cleanEmail];

      if (user && user.lockedUntil && Date.now() < user.lockedUntil) {
        const mins = Math.ceil((user.lockedUntil - Date.now()) / 60000);
        return { ok: false, error: `Too many failed attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.` };
      }

      // Always run a derivation so a missing account and a wrong password
      // take comparable time.
      const algo = user ? user.algo : preferredAlgo();
      const salt = user ? user.salt : randomHex(16);
      const attempt = await derive(password, salt, algo);

      if (!user || !safeEqual(attempt, user.hash)) {
        if (user) {
          user.failedAttempts = (user.failedAttempts || 0) + 1;
          if (user.failedAttempts >= MAX_ATTEMPTS) {
            user.lockedUntil = Date.now() + LOCKOUT_MS;
            user.failedAttempts = 0;
          }
          users[cleanEmail] = user;
          Store.write(USERS_KEY, users);
        }
        return { ok: false, error: 'Incorrect email or password.' };
      }

      user.failedAttempts = 0;
      user.lockedUntil = 0;
      user.lastLoginAt = Date.now();
      user.loginCount = (user.loginCount || 0) + 1;
      users[cleanEmail] = user;
      Store.write(USERS_KEY, users);

      writeSession(cleanEmail, remember);
      logActivity('signin', cleanEmail);

      return { ok: true, user: this.currentUser() };
    },

    signOut() {
      const user = this.currentUser();
      if (user) logActivity('signout', user.email);
      Store.remove(SESSION_KEY);
    },

    async changePassword({ currentPassword, newPassword }) {
      const session = readSession();
      if (!session) return { ok: false, error: 'You are not signed in.' };

      const users = allUsers();
      const user = users[session.email];
      if (!user) return { ok: false, error: 'Account not found.' };

      const check = await derive(currentPassword, user.salt, user.algo);
      if (!safeEqual(check, user.hash)) {
        return { ok: false, field: 'current', error: 'Current password is incorrect.' };
      }

      const problem = passwordProblem(newPassword);
      if (problem) return { ok: false, field: 'next', error: problem };

      const algo = preferredAlgo();
      const salt = randomHex(16);
      user.algo = algo;
      user.salt = salt;
      user.hash = await derive(newPassword, salt, algo);
      users[session.email] = user;
      Store.write(USERS_KEY, users);
      logActivity('password-change', session.email);

      return { ok: true };
    },

    updateProfile({ name, plan }) {
      const session = readSession();
      if (!session) return { ok: false, error: 'You are not signed in.' };

      const users = allUsers();
      const user = users[session.email];
      if (!user) return { ok: false, error: 'Account not found.' };

      if (typeof name === 'string') {
        const cleanName = name.trim();
        if (cleanName.length < 2) return { ok: false, field: 'name', error: 'Please enter your name.' };
        user.name = cleanName;
      }
      if (typeof plan === 'string') user.plan = plan;

      users[session.email] = user;
      Store.write(USERS_KEY, users);
      logActivity('profile-update', session.email);

      return { ok: true, user: this.currentUser() };
    },

    deleteAccount() {
      const session = readSession();
      if (!session) return { ok: false, error: 'You are not signed in.' };
      const users = allUsers();
      delete users[session.email];
      Store.write(USERS_KEY, users);
      Store.remove(SESSION_KEY);
      Store.remove(ACTIVITY_KEY);
      return { ok: true };
    },

    /* Route guards ------------------------------------------------------ */

    requireAuth(redirectTo) {
      if (this.isAuthenticated()) return true;
      const here = location.pathname.split('/').pop() || 'index.html';
      location.replace((redirectTo || 'login.html') + '?next=' + encodeURIComponent(here));
      return false;
    },

    redirectIfAuthenticated(defaultTarget) {
      if (!this.isAuthenticated()) return false;
      const next = new URLSearchParams(location.search).get('next');
      const safe = next && /^[\w.-]+\.html$/.test(next) ? next : (defaultTarget || 'dashboard.html');
      location.replace(safe);
      return true;
    },
  };

  /* ---------------------------------------------- shared nav auth state */

  function initials(name) {
    return String(name || '?')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase();
  }

  /* Fills any [data-auth-slot] container with sign-in or account controls.
     Kept in this module so every page stays in sync automatically. */
  function renderAuthSlots() {
    const user = Auth.currentUser();
    document.querySelectorAll('[data-auth-slot]').forEach((slot) => {
      const variant = slot.getAttribute('data-auth-slot'); // "nav" | "mobile"

      if (!user) {
        slot.innerHTML =
          '<a href="login.html" class="btn btn-secondary"><i class="fas fa-right-to-bracket"></i> Sign In</a>' +
          '<a href="login.html#signup" class="btn btn-primary">Get Started</a>';
        return;
      }

      if (variant === 'mobile') {
        slot.innerHTML =
          '<a href="dashboard.html" class="btn btn-primary"><i class="fas fa-gauge-high"></i> Dashboard</a>' +
          '<a href="#" data-auth-signout class="btn btn-secondary"><i class="fas fa-right-from-bracket"></i> Sign Out</a>';
        return;
      }

      slot.innerHTML =
        '<a href="dashboard.html" class="account-chip" aria-label="Open dashboard">' +
        '<span class="account-avatar">' + initials(user.name) + '</span>' +
        '<span class="account-chip-text">' +
        '<span class="account-chip-name">' + escapeHtml(user.name.split(' ')[0]) + '</span>' +
        '<span class="account-chip-plan">' + escapeHtml(user.plan) + '</span>' +
        '</span></a>' +
        '<a href="#" data-auth-signout class="btn btn-secondary" title="Sign out">' +
        '<i class="fas fa-right-from-bracket"></i></a>';
    });

    document.querySelectorAll('[data-auth-signout]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        Auth.signOut();
        location.href = 'index.html';
      });
    });

    // Show/hide elements based on auth state.
    document.querySelectorAll('[data-auth-when]').forEach((el) => {
      const want = el.getAttribute('data-auth-when'); // "in" | "out"
      const show = want === 'in' ? !!user : !user;
      el.hidden = !show;
    });
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  Auth.renderAuthSlots = renderAuthSlots;
  Auth.escapeHtml = escapeHtml;
  Auth.initials = initials;

  global.VeridicAuth = Auth;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderAuthSlots);
  } else {
    renderAuthSlots();
  }
})(window);
