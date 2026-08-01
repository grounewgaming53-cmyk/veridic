/* ========================================================================
   VERIDIC payments — HTTP API
   ------------------------------------------------------------------------
   Route contract:
     GET  /api/payments/config          capabilities + server-side price list
     POST /api/checkout/session         create an order + a Cashfree order
     POST /api/orders/:ref/confirm      reconcile-on-return after checkout
     POST /api/payments/webhook         Cashfree → us (signature verified)
     GET  /api/orders/:ref              order status (masked, safe to poll)
     POST /api/orders/:ref/verify       force a reconcile against the provider
     GET  /api/orders?email=            order history for an account
     POST /api/demo/complete            simulated payment (demo mode only)
   ======================================================================== */

import express from 'express';
import { config, capabilities, getPlan, publicConfig } from './config.js';
import {
  createOrder, getOrder, newOrderRef, updateOrder, publicOrder,
  listOrdersForAccount, recordWebhookEvent, markFailed,
} from './db.js';
import {
  createCashfreeOrder, verifyWebhookSignature, webhookEventKey,
  handleCashfreeEvent, reconcileOrder, confirmPayment,
} from './payments.js';
import { normalizePhone } from './notify.js';

export const router = express.Router();

/* ------------------------------------------------------------ helpers */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;

/* Small in-memory throttle. Enough to stop a script hammering order
   creation; a real deployment behind a proxy should use the proxy's. */
const hits = new Map();
function throttle(key, limit, windowMs) {
  const now = Date.now();
  const rec = hits.get(key);
  if (!rec || now > rec.reset) {
    hits.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  if (rec.count >= limit) return false;
  rec.count++;
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
}, 60_000).unref();

const clientIp = (req) =>
  (req.headers['x-forwarded-for'] ?? '').toString().split(',')[0].trim() || req.ip || 'local';

/* ------------------------------------------------------------- config */

router.get('/payments/config', (_req, res) => {
  res.json(publicConfig());
});

/* ---------------------------------------------------- create checkout */

router.post('/checkout/session', async (req, res) => {
  if (!throttle(`checkout:${clientIp(req)}`, 12, 60_000)) {
    return res.status(429).json({ error: 'Too many checkout attempts. Wait a minute and try again.' });
  }

  const { plan: planId, name, email, phone, countryCode, accountEmail, mode } = req.body ?? {};

  const plan = getPlan(planId);
  if (!plan) {
    return res.status(400).json({ error: 'Unknown plan.', field: 'plan' });
  }

  const buyerName = String(name ?? '').trim();
  if (buyerName.length < 2) {
    return res.status(400).json({ error: 'Please enter the buyer\'s full name.', field: 'name' });
  }

  const buyerEmail = String(email ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(buyerEmail)) {
    return res.status(400).json({ error: 'Enter a valid email address for the receipt.', field: 'email' });
  }

  const buyerPhone = normalizePhone(phone, countryCode);
  if (!buyerPhone) {
    return res.status(400).json({
      error: 'Enter a valid mobile number, including country code, for the confirmation SMS.',
      field: 'phone',
    });
  }

  /* Demo is allowed when Cashfree is absent, or when explicitly requested
     and permitted. The amount always comes from the server-side table. */
  const wantsDemo = mode === 'demo' || !capabilities.cashfree;
  if (wantsDemo && !config.allowDemo && capabilities.cashfree) {
    return res.status(400).json({ error: 'Simulated payments are disabled on this server.' });
  }

  const provider = wantsDemo ? 'demo' : 'cashfree';
  const ref = newOrderRef();

  const order = createOrder({
    ref,
    planId: plan.id,
    planLabel: plan.label,
    amount: plan.amount,
    currency: config.currency,
    buyerName,
    buyerEmail,
    buyerPhone,
    accountEmail: accountEmail ? String(accountEmail).trim().toLowerCase() : null,
    provider,
  });

  if (provider === 'demo') {
    updateOrder(ref, { provider_ref: `demo_${ref}` });
    return res.status(201).json({
      ref,
      mode: 'demo',
      url: `/demo-pay.html?ref=${encodeURIComponent(ref)}`,
      order: publicOrder(getOrder(ref)),
    });
  }

  try {
    const cfOrder = await createCashfreeOrder({ order, plan });
    updateOrder(ref, { provider_ref: cfOrder.cfOrderId });
    return res.status(201).json({
      ref,
      mode: 'live',
      cashfree: {
        paymentSessionId: cfOrder.paymentSessionId,
        orderId: cfOrder.orderId,
        env: cfOrder.env,
      },
      order: publicOrder(getOrder(ref)),
    });
  } catch (err) {
    console.error('[checkout] cashfree order creation failed:', err.message);
    markFailed(ref, `Could not start checkout: ${err.message}`);
    return res.status(502).json({ error: 'Could not reach the payment provider. Nothing was charged.' });
  }
});

/* ---------------------------------------------- reconcile-on-return
   Called by checkout.js the instant Cashfree's checkout overlay closes,
   whatever the browser thinks happened. This endpoint does not trust
   that report — it independently asks Cashfree's own API, authenticated
   with our secret key, what actually happened to this order. */

router.post('/orders/:ref/confirm', async (req, res) => {
  const order = getOrder(req.params.ref);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  if (order.provider !== 'cashfree') {
    return res.status(400).json({ error: 'This order is not a live payment.' });
  }

  if (!throttle(`confirm:${order.ref}`, 10, 60_000)) {
    return res.status(429).json({ error: 'Slow down — try again in a moment.' });
  }

  if (order.status === 'paid') {
    return res.json({ order: publicOrder(order) });
  }

  const result = await reconcileOrder(order);
  res.json({ order: publicOrder(getOrder(order.ref)), result });
});

/* --------------------------------------------------------- order state */

router.get('/orders/:ref', async (req, res) => {
  const order = getOrder(req.params.ref);
  if (!order) return res.status(404).json({ error: 'Order not found.' });

  /* Opportunistic reconcile: if the browser is polling a pending Cashfree
     order, ask Cashfree directly. Covers a missing or delayed webhook and
     a confirm call the browser never got to send (closed tab, lost
     connection right after paying). */
  if (order.status === 'pending' && order.provider === 'cashfree' && capabilities.cashfree) {
    const key = `reconcile:${order.ref}`;
    if (throttle(key, 1, 3000)) {
      await reconcileOrder(order);
      return res.json({ order: publicOrder(getOrder(order.ref)) });
    }
  }

  res.json({ order: publicOrder(order) });
});

/* Explicit "check again" for the Verify button on the order page. */
router.post('/orders/:ref/verify', async (req, res) => {
  const order = getOrder(req.params.ref);
  if (!order) return res.status(404).json({ error: 'Order not found.' });

  if (!throttle(`verify:${order.ref}`, 6, 60_000)) {
    return res.status(429).json({ error: 'Slow down — try again in a moment.' });
  }

  if (order.status === 'paid') {
    return res.json({ order: publicOrder(order), checked: false, note: 'Already verified.' });
  }

  if (order.provider === 'cashfree' && capabilities.cashfree) {
    const result = await reconcileOrder(order);
    return res.json({ order: publicOrder(getOrder(order.ref)), checked: true, result });
  }

  res.json({ order: publicOrder(order), checked: false, note: 'No provider to reconcile against.' });
});

router.get('/orders', (req, res) => {
  const email = String(req.query.email ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'A valid ?email= is required.' });
  res.json({ orders: listOrdersForAccount(email).map(publicOrder) });
});

/* -------------------------------------------------------------- webhook
   NOTE: mounted with express.raw() in server.js. req.body is a Buffer
   here, because the signature is computed over the exact bytes Cashfree
   sent — parsing first would invalidate it. */

export async function cashfreeWebhookHandler(req, res) {
  const signature = req.headers['x-webhook-signature'];
  const timestamp = req.headers['x-webhook-timestamp'];

  let event;
  try {
    verifyWebhookSignature(req.body, signature, timestamp);
    event = JSON.parse(req.body.toString('utf8'));
  } catch (err) {
    console.error('[webhook] signature verification FAILED:', err.message);
    return res.status(400).send(`Webhook signature verification failed: ${err.message}`);
  }

  /* Acknowledge before doing work: Cashfree retries on a slow or failing
     response, and a duplicate delivery would be harmless but pointless. */
  res.json({ received: true });

  if (!recordWebhookEvent(webhookEventKey(event), event.type)) {
    console.log(`[webhook] duplicate ${event.type} — skipped`);
    return;
  }

  try {
    const result = await handleCashfreeEvent(event);
    console.log(`[webhook] ${event.type} → ${result.action}`);
  } catch (err) {
    console.error(`[webhook] handler error for ${event.type}:`, err.message);
  }
}

/* ---------------------------------------------------- simulated payment
   Drives the SAME confirmPayment() funnel as a real webhook/reconcile
   call, so the demo exercises the real verification and notification
   code rather than a parallel happy path that could drift out of sync. */

router.post('/demo/complete', async (req, res) => {
  const { ref, outcome } = req.body ?? {};
  const order = getOrder(ref);

  if (!order) return res.status(404).json({ error: 'Order not found.' });
  if (order.provider !== 'demo') {
    return res.status(400).json({ error: 'This order is not a simulated payment.' });
  }
  if (order.status !== 'pending') {
    return res.json({ order: publicOrder(order), note: 'Order is already settled.' });
  }

  if (outcome === 'decline') {
    markFailed(order.ref, 'Simulated decline — the test payment was rejected.');
    return res.json({ order: publicOrder(getOrder(order.ref)) });
  }

  await confirmPayment(order.ref, {
    providerRef: order.provider_ref,
    paymentIntent: `demo_pay_${order.ref}`,
    verifiedVia: 'demo-simulator',
  });

  res.json({ order: publicOrder(getOrder(order.ref)) });
});
