/* ========================================================================
   VERIDIC — admin API
   ------------------------------------------------------------------------
   Every route below /api/admin except `status` and `login` is behind
   requireAdmin(), which checks the HttpOnly session cookie against the
   admin_sessions table on every single request. There is no "trusted"
   client state: the browser holds an opaque token and nothing else.

   This is the ONLY part of the API that returns unmasked customer
   contact details.
   ======================================================================== */

import express from 'express';
import { config } from './config.js';
import {
  adminListOrders, adminOrderStats, adminOrder, getOrder,
  deleteAllAdminSessions,
} from './db.js';
import { confirmPayment } from './payments.js';
import {
  attemptLogin, logout, requireAdmin, requireAdminHeader,
  adminConfigured, readAdminToken, isSignedIn,
} from './adminAuth.js';

export const adminRouter = express.Router();

const clientIp = (req) =>
  (req.headers['x-forwarded-for'] ?? '').toString().split(',')[0].trim() || req.ip || 'local';

/* ------------------------------------------------------------- status
   Unauthenticated on purpose: the login page needs to know whether admin
   is configured at all, and whether the visitor already holds a valid
   session. It deliberately reveals nothing else. */

adminRouter.get('/status', (req, res) => {
  res.json({ configured: adminConfigured(), signedIn: isSignedIn(req) });
});

/* -------------------------------------------------------------- login */

adminRouter.post('/login', (req, res) => {
  const { password } = req.body ?? {};

  const result = attemptLogin({ password: String(password ?? ''), ip: clientIp(req) });

  if (!result.ok) {
    return res.status(result.status).json({ error: result.error });
  }

  res.setHeader('Set-Cookie', result.cookie);
  res.json({ ok: true });
});

adminRouter.post('/logout', (req, res) => {
  const { cookie } = logout(readAdminToken(req));
  res.setHeader('Set-Cookie', cookie);
  res.json({ ok: true });
});

/* ------------------------------------------------- everything below is
   authenticated. requireAdmin runs before any handler in this section. */

adminRouter.use(requireAdmin);

/* --------------------------------------------------------- dashboard */

adminRouter.get('/overview', (_req, res) => {
  const stats = adminOrderStats();
  res.json({
    stats: {
      total: stats.total,
      paid: stats.paid,
      pending: stats.pending,
      failed: stats.failed,
      revenue: stats.revenue,
    },
    currency: config.currency,
    mode: config.cashfree.appId ? 'live' : 'demo',
    channels: {
      sms: Boolean(config.twilio.accountSid),
      email: Boolean(config.resend.apiKey),
    },
  });
});

/* ------------------------------------------------------------ orders */

adminRouter.get('/orders', (req, res) => {
  const { status, limit, offset } = req.query;

  const allowed = ['paid', 'pending', 'failed'];
  const filter = allowed.includes(String(status)) ? String(status) : null;

  const rows = adminListOrders({ status: filter, limit, offset });
  res.json({
    orders: rows.map(adminOrder),
    currency: config.currency,
  });
});

adminRouter.get('/orders/:ref', (req, res) => {
  const order = getOrder(req.params.ref);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  res.json({ order: adminOrder(order), currency: config.currency });
});

/* Manually mark a stuck order as paid — for the case where money did
   arrive but neither the webhook nor the reconcile call could confirm it
   (provider outage, a payment taken out-of-band). Deliberately requires
   the custom header as well as the cookie.

   Goes through the same confirmPayment() funnel every automatic
   confirmation uses, so the buyer gets a license key and their
   SMS/email exactly as they would have — a bespoke UPDATE here would
   leave them with a "paid" order, no key, and no notification. */
adminRouter.post('/orders/:ref/mark-paid', requireAdminHeader, async (req, res) => {
  const order = getOrder(req.params.ref);
  if (!order) return res.status(404).json({ error: 'Order not found.' });

  if (order.status === 'paid') {
    return res.json({ order: adminOrder(order), note: 'Already paid.' });
  }

  const result = await confirmPayment(order.ref, {
    providerRef: order.provider_ref,
    verifiedVia: 'admin-manual',
  });

  console.log(`[admin] order ${order.ref} manually marked paid (notified=${result.notified})`);

  res.json({
    order: adminOrder(getOrder(order.ref)),
    notified: result.notified,
  });
});

/* --------------------------------------------------------- sessions */

adminRouter.post('/revoke-all', requireAdminHeader, (_req, res) => {
  /* Signs out every admin session everywhere, including the one making
     this request — the "I think someone else got in" button. */
  const killed = deleteAllAdminSessions();
  console.log(`[admin] all admin sessions revoked (${killed})`);
  res.json({ ok: true, revoked: killed });
});
