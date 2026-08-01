/* ========================================================================
   VERIDIC payments — order store (built-in node:sqlite, no native deps)
   ------------------------------------------------------------------------
   The order row is the single source of truth for "did this get paid" and
   "have we already told the buyer". Both questions are answered from the
   database, never from anything the browser said.
   ======================================================================== */

import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import { config } from './config.js';

const db = new DatabaseSync(config.dbPath);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    ref              TEXT PRIMARY KEY,
    plan_id          TEXT NOT NULL,
    plan_label       TEXT NOT NULL,
    amount           INTEGER NOT NULL,
    currency         TEXT NOT NULL,

    buyer_name       TEXT NOT NULL,
    buyer_email      TEXT NOT NULL,
    buyer_phone      TEXT NOT NULL,
    account_email    TEXT,

    status           TEXT NOT NULL DEFAULT 'pending',
    provider         TEXT NOT NULL,
    provider_ref     TEXT,
    payment_intent   TEXT,
    receipt_url      TEXT,
    license_key      TEXT,

    failure_reason   TEXT,
    verified_via     TEXT,

    notified_at      TEXT,
    sms_status       TEXT,
    sms_detail       TEXT,
    email_status     TEXT,
    email_detail     TEXT,

    created_at       TEXT NOT NULL,
    paid_at          TEXT,
    updated_at       TEXT NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS webhook_events (
    id           TEXT PRIMARY KEY,
    type         TEXT NOT NULL,
    received_at  TEXT NOT NULL
  )
`);

/* Admin sessions are deliberately a separate table from anything
   customer-facing. The token stored here is the ONLY thing the admin
   cookie carries — the password itself never leaves config.js, and a
   leak of this table alone (without the .env) grants nothing: tokens are
   random and unrelated to the password. */
db.exec(`
  CREATE TABLE IF NOT EXISTS admin_sessions (
    token        TEXT PRIMARY KEY,
    created_at   TEXT NOT NULL,
    expires_at   TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    ip           TEXT
  )
`);

db.exec('CREATE INDEX IF NOT EXISTS idx_orders_account ON orders(account_email)');
db.exec('CREATE INDEX IF NOT EXISTS idx_orders_provider_ref ON orders(provider_ref)');
db.exec('CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON admin_sessions(expires_at)');

const now = () => new Date().toISOString();

/* ------------------------------------------------------------ reference */

/* Crockford-ish alphabet: no I, L, O, U, 0, 1 — so a reference read aloud
   over the phone or copied from an SMS does not turn into a support ticket. */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

function randomBlock(len) {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

export function newOrderRef() {
  for (let attempt = 0; attempt < 10; attempt++) {
    const ref = `VRDC-${randomBlock(4)}-${randomBlock(4)}`;
    if (!getOrder(ref)) return ref;
  }
  throw new Error('Could not allocate a unique order reference');
}

export function newLicenseKey() {
  return `VRDC-${randomBlock(4)}-${randomBlock(4)}-${randomBlock(4)}-${randomBlock(4)}`;
}

/* ---------------------------------------------------------------- CRUD */

export function createOrder(order) {
  db.prepare(`
    INSERT INTO orders (
      ref, plan_id, plan_label, amount, currency,
      buyer_name, buyer_email, buyer_phone, account_email,
      status, provider, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
  `).run(
    order.ref, order.planId, order.planLabel, order.amount, order.currency,
    order.buyerName, order.buyerEmail, order.buyerPhone, order.accountEmail ?? null,
    order.provider, now(), now()
  );
  return getOrder(order.ref);
}

export function getOrder(ref) {
  if (!ref) return null;
  return db.prepare('SELECT * FROM orders WHERE ref = ?').get(String(ref)) ?? null;
}

export function getOrderByProviderRef(providerRef) {
  if (!providerRef) return null;
  return db.prepare('SELECT * FROM orders WHERE provider_ref = ?').get(String(providerRef)) ?? null;
}

export function listOrdersForAccount(accountEmail) {
  if (!accountEmail) return [];
  return db.prepare(
    'SELECT * FROM orders WHERE account_email = ? ORDER BY created_at DESC LIMIT 50'
  ).all(String(accountEmail).toLowerCase());
}

const SETTABLE = new Set([
  'status', 'provider_ref', 'payment_intent', 'receipt_url', 'license_key',
  'failure_reason', 'verified_via', 'paid_at',
  'notified_at', 'sms_status', 'sms_detail', 'email_status', 'email_detail',
]);

export function updateOrder(ref, patch) {
  const keys = Object.keys(patch).filter((k) => SETTABLE.has(k));
  if (!keys.length) return getOrder(ref);

  const sql = `UPDATE orders SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE ref = ?`;
  db.prepare(sql).run(...keys.map((k) => patch[k] ?? null), now(), String(ref));
  return getOrder(ref);
}

/* --------------------------------------------------------- transitions */

/* Marks an order paid exactly once. Returns { order, firstTime }.
   `firstTime` is the gate that stops a redelivered webhook from sending a
   second SMS — the UPDATE is conditional on the row still being unpaid, so
   two concurrent deliveries cannot both win. */
export function markPaid(ref, { providerRef, paymentIntent, receiptUrl, verifiedVia }) {
  const result = db.prepare(`
    UPDATE orders
       SET status = 'paid',
           provider_ref = COALESCE(?, provider_ref),
           payment_intent = COALESCE(?, payment_intent),
           receipt_url = COALESCE(?, receipt_url),
           license_key = COALESCE(license_key, ?),
           verified_via = ?,
           paid_at = ?,
           updated_at = ?
     WHERE ref = ? AND status != 'paid'
  `).run(
    providerRef ?? null, paymentIntent ?? null, receiptUrl ?? null,
    newLicenseKey(), verifiedVia ?? 'unknown', now(), now(), String(ref)
  );

  return { order: getOrder(ref), firstTime: result.changes > 0 };
}

export function markFailed(ref, reason) {
  db.prepare(`
    UPDATE orders SET status = 'failed', failure_reason = ?, updated_at = ?
     WHERE ref = ? AND status = 'pending'
  `).run(String(reason || 'Payment was not completed'), now(), String(ref));
  return getOrder(ref);
}

/* Claims the right to send notifications for this order. Only the first
   caller gets `true`; everyone after sees notified_at already set. */
export function claimNotification(ref) {
  const result = db.prepare(
    'UPDATE orders SET notified_at = ?, updated_at = ? WHERE ref = ? AND notified_at IS NULL'
  ).run(now(), now(), String(ref));
  return result.changes > 0;
}

export function releaseNotification(ref) {
  db.prepare('UPDATE orders SET notified_at = NULL, updated_at = ? WHERE ref = ?').run(now(), String(ref));
}

/* ------------------------------------------------- webhook replay guard */

/* Stripe retries deliveries and can send the same event more than once.
   Returns true only the first time we see a given event id. */
export function recordWebhookEvent(id, type) {
  try {
    db.prepare('INSERT INTO webhook_events (id, type, received_at) VALUES (?, ?, ?)')
      .run(String(id), String(type), now());
    return true;
  } catch {
    return false; // PRIMARY KEY collision => already processed
  }
}

/* ------------------------------------------------------- admin sessions */

export function createAdminSession(token, ttlMs, ip) {
  const created = now();
  const expires = new Date(Date.now() + ttlMs).toISOString();
  db.prepare(`
    INSERT INTO admin_sessions (token, created_at, expires_at, last_seen_at, ip)
    VALUES (?, ?, ?, ?, ?)
  `).run(token, created, expires, created, ip ?? null);
}

/* Returns the session row only if it exists AND has not expired — an
   expired row is treated identically to "no session", never as a
   degraded-but-valid one. */
export function getValidAdminSession(token) {
  if (!token) return null;
  const row = db.prepare('SELECT * FROM admin_sessions WHERE token = ?').get(String(token));
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    deleteAdminSession(token);
    return null;
  }
  return row;
}

export function touchAdminSession(token) {
  db.prepare('UPDATE admin_sessions SET last_seen_at = ? WHERE token = ?').run(now(), String(token));
}

export function deleteAdminSession(token) {
  db.prepare('DELETE FROM admin_sessions WHERE token = ?').run(String(token));
}

export function pruneExpiredAdminSessions() {
  db.prepare('DELETE FROM admin_sessions WHERE expires_at <= ?').run(now());
}

/* Signs out every admin session everywhere — the "I think someone else
   got in" button. Returns how many were killed. */
export function deleteAllAdminSessions() {
  return db.prepare('DELETE FROM admin_sessions').run().changes;
}

/* ------------------------------------------------------------- admin */

/* UNMASKED — every field, in full. Only ever reachable behind
   requireAdmin(). This is the one place in the codebase that returns a
   real phone number or email address rather than a masked one. */
export function adminListOrders({ status, limit = 100, offset = 0 } = {}) {
  const cappedLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const cappedOffset = Math.max(Number(offset) || 0, 0);

  if (status) {
    return db.prepare(
      'SELECT * FROM orders WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
    ).all(String(status), cappedLimit, cappedOffset);
  }
  return db.prepare(
    'SELECT * FROM orders ORDER BY created_at DESC LIMIT ? OFFSET ?'
  ).all(cappedLimit, cappedOffset);
}

export function adminOrderStats() {
  const row = db.prepare(`
    SELECT
      COUNT(*)                                             AS total,
      COUNT(*) FILTER (WHERE status = 'paid')               AS paid,
      COUNT(*) FILTER (WHERE status = 'pending')             AS pending,
      COUNT(*) FILTER (WHERE status = 'failed')              AS failed,
      COALESCE(SUM(amount) FILTER (WHERE status = 'paid'), 0) AS revenue
    FROM orders
  `).get();
  return row;
}

export function adminOrder(order) {
  if (!order) return null;
  return {
    ref: order.ref,
    status: order.status,
    plan: { id: order.plan_id, label: order.plan_label },
    amount: order.amount,
    currency: order.currency,
    provider: order.provider,
    providerRef: order.provider_ref,
    buyerName: order.buyer_name,
    buyerEmail: order.buyer_email,
    buyerPhone: order.buyer_phone,
    accountEmail: order.account_email,
    licenseKey: order.license_key,
    receiptUrl: order.receipt_url,
    verifiedVia: order.verified_via,
    failureReason: order.failure_reason,
    notifications: {
      sms: { status: order.sms_status || 'pending', detail: order.sms_detail || null },
      email: { status: order.email_status || 'pending', detail: order.email_detail || null },
    },
    createdAt: order.created_at,
    paidAt: order.paid_at || null,
    updatedAt: order.updated_at,
  };
}

/* ----------------------------------------------------------- shaping */

/* Only ever hand the browser what it needs. Contact details are masked so
   an order reference alone cannot be used to harvest a phone or email. */
export function publicOrder(order) {
  if (!order) return null;
  return {
    ref: order.ref,
    status: order.status,
    plan: { id: order.plan_id, label: order.plan_label },
    amount: order.amount,
    currency: order.currency,
    buyerName: order.buyer_name,
    buyerEmailMasked: maskEmail(order.buyer_email),
    buyerPhoneMasked: maskPhone(order.buyer_phone),
    licenseKey: order.status === 'paid' ? order.license_key : null,
    receiptUrl: order.receipt_url || null,
    verifiedVia: order.verified_via || null,
    failureReason: order.failure_reason || null,
    notifications: {
      sms: { status: order.sms_status || 'pending', detail: order.sms_detail || null },
      email: { status: order.email_status || 'pending', detail: order.email_detail || null },
    },
    createdAt: order.created_at,
    paidAt: order.paid_at || null,
  };
}

export function maskEmail(email) {
  const [user = '', domain = ''] = String(email || '').split('@');
  if (!domain) return '***';
  const head = user.slice(0, 2);
  return `${head}${'*'.repeat(Math.max(user.length - 2, 1))}@${domain}`;
}

export function maskPhone(phone) {
  const digits = String(phone || '').replace(/[^\d+]/g, '');
  if (digits.length < 4) return '***';
  return `${digits.slice(0, 3)}${'*'.repeat(Math.max(digits.length - 6, 2))}${digits.slice(-3)}`;
}

export default db;
