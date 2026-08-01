/* ========================================================================
   VERIDIC payments — provider integration & verification (Cashfree)
   ------------------------------------------------------------------------
   Card/UPI/netbanking details never reach this server. We create a
   Cashfree Order and open Cashfree's own Checkout overlay on the buyer's
   browser — the fields live inside an iframe served from Cashfree's
   origin, cross-origin from ours, so our JavaScript can never read them.

   Payment is confirmed by exactly two trusted routes, both server-side:

     1. Reconcile-on-return — the instant the checkout overlay closes, the
        browser asks us to confirm. We do NOT trust that the browser is
        telling the truth about the outcome; instead we make our own
        authenticated, server-to-server call to Cashfree's Order API using
        our secret key, and read back what Cashfree itself says happened.
        A browser can lie about what it saw. It cannot make Cashfree's own
        API lie to us.

     2. Webhook — Cashfree also POSTs a signed event asynchronously. Its
        signature (HMAC-SHA256 of timestamp+body, base64-encoded) is
        verified against our secret key. This is the safety net for a
        buyer who closes the tab before the reconcile call can complete.

   Both routes funnel into the same confirmPayment(), so whichever confirms
   first wins and the other becomes a no-op.
   ======================================================================== */

import crypto from 'node:crypto';
import { config, capabilities } from './config.js';
import { markPaid, markFailed, claimNotification, releaseNotification } from './db.js';
import { notifyBuyer } from './notify.js';

const API_BASE = config.cashfree.env === 'production'
  ? 'https://api.cashfree.com/pg'
  : 'https://sandbox.cashfree.com/pg';

function authHeaders() {
  return {
    'x-client-id': config.cashfree.appId,
    'x-client-secret': config.cashfree.secretKey,
    'x-api-version': config.cashfree.apiVersion,
    'Content-Type': 'application/json',
  };
}

async function cashfreeFetch(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { ...authHeaders(), ...(options.headers || {}) },
    signal: AbortSignal.timeout(15000),
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = payload?.message || `Cashfree responded ${res.status}`;
    throw new Error(message);
  }
  return payload;
}

/* Cashfree's Order API wants a decimal rupee amount (e.g. 999.00), while
   every other number in this app — the price table, the database, the
   notification templates — deliberately stays in paise (the smallest
   unit) for consistency. This is the one place that boundary is crossed;
   getting it wrong here means charging 100× too much or too little. */
function paiseToDecimal(paise) {
  return (paise / 100).toFixed(2);
}

/* ------------------------------------------------- order construction */

export async function createCashfreeOrder({ order, plan }) {
  if (!capabilities.cashfree) throw new Error('Cashfree is not configured');

  const cfOrder = await cashfreeFetch('/orders', {
    method: 'POST',
    body: JSON.stringify({
      order_id: order.ref,
      order_amount: Number(paiseToDecimal(plan.amount)),
      order_currency: order.currency.toUpperCase(),
      customer_details: {
        customer_id: `cust_${order.ref}`,
        customer_name: order.buyer_name,
        customer_email: order.buyer_email,
        customer_phone: order.buyer_phone.replace(/^\+/, ''),
      },
      order_meta: {
        return_url: `${config.publicUrl}/order.html?ref=${encodeURIComponent(order.ref)}`,
        notify_url: `${config.publicUrl}/api/payments/webhook`,
      },
      order_note: plan.label,
    }),
  });

  return {
    orderId: cfOrder.order_id,
    cfOrderId: cfOrder.cf_order_id,
    paymentSessionId: cfOrder.payment_session_id,
    env: config.cashfree.env,
  };
}

/* ------------------------------------------------------- confirmation */

/**
 * The single funnel every confirmation goes through, whatever triggered it.
 * markPaid() only reports firstTime once, and claimNotification() only
 * grants the send right once, so a redelivered webhook racing the
 * reconcile-on-return call cannot double-notify the buyer.
 */
export async function confirmPayment(ref, {
  providerRef = null,
  paymentIntent = null,
  receiptUrl = null,
  verifiedVia = 'unknown',
} = {}) {
  const { order, firstTime } = markPaid(ref, { providerRef, paymentIntent, receiptUrl, verifiedVia });

  if (!order) {
    console.warn(`[confirm] no such order: ${ref}`);
    return { ok: false, reason: 'unknown-order' };
  }

  if (!firstTime) {
    return { ok: true, order, alreadyPaid: true, notified: false };
  }

  console.log(`[confirm] ${ref} paid — verified via ${verifiedVia}`);

  if (!claimNotification(ref)) {
    return { ok: true, order, alreadyPaid: false, notified: false };
  }

  try {
    await notifyBuyer(order);
  } catch (err) {
    /* Release the claim so a retry (webhook redelivery or a poll) can try
       again rather than the buyer silently never hearing from us. */
    console.error(`[confirm] notification dispatch threw for ${ref}:`, err.message);
    releaseNotification(ref);
    return { ok: true, order, alreadyPaid: false, notified: false, notifyError: err.message };
  }

  return { ok: true, order, alreadyPaid: false, notified: true };
}

/* --------------------------------------------------- reconcile-on-return
   Cashfree's Checkout SDK does not hand the browser a signed proof of
   payment the way some providers do — so instead of verifying something
   the browser relays, we go ask Cashfree ourselves, authenticated with
   our own secret key. This IS the primary confirmation path here, not a
   fallback. */

export async function reconcileOrder(order) {
  if (!capabilities.cashfree) return { reconciled: false, reason: 'nothing-to-check' };

  try {
    const payments = await cashfreeFetch(`/orders/${encodeURIComponent(order.ref)}/payments`);
    const list = Array.isArray(payments) ? payments : [];

    const success = list.find((p) => p.payment_status === 'SUCCESS');
    if (success) {
      await confirmPayment(order.ref, {
        providerRef: order.ref,
        paymentIntent: String(success.cf_payment_id),
        verifiedVia: 'cashfree-reconcile',
      });
      return { reconciled: true, status: 'paid' };
    }

    const allFailed = list.length > 0 && list.every((p) => ['FAILED', 'USER_DROPPED'].includes(p.payment_status));
    if (allFailed) {
      markFailed(order.ref, 'The payment was declined.');
      return { reconciled: true, status: 'failed' };
    }

    return { reconciled: false, status: list.length ? list[0].payment_status : 'no-attempt' };
  } catch (err) {
    console.warn(`[reconcile] ${order.ref}:`, err.message);
    return { reconciled: false, reason: err.message };
  }
}

/* -------------------------------------------------------- webhook path */

/** Verifies the Cashfree webhook signature over the RAW request body.
    Cashfree's construction: base64( HMAC-SHA256(timestamp + rawBody,
    secret_key) ), compared against the base64 string in
    x-webhook-signature — note this is base64, not hex like some
    providers, and it folds in the timestamp header to prevent replay of
    an old, validly-signed body under a new timestamp. */
export function verifyWebhookSignature(rawBody, signatureHeader, timestampHeader) {
  if (!capabilities.cashfree) throw new Error('Cashfree is not configured');
  if (!signatureHeader) throw new Error('Missing x-webhook-signature header');
  if (!timestampHeader) throw new Error('Missing x-webhook-timestamp header');

  const expected = crypto
    .createHmac('sha256', config.cashfree.secretKey)
    .update(timestampHeader + rawBody.toString('utf8'))
    .digest('base64');

  const a = Buffer.from(expected, 'base64');
  const b = Buffer.from(String(signatureHeader), 'base64');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error('signature mismatch');
  }
}

/** A stable id for the replay guard. Cashfree doesn't send a single global
    event id, but the payment id + event type together are stable across
    redeliveries of the same event. */
export function webhookEventKey(event) {
  const paymentId = event?.data?.payment?.cf_payment_id
    || event?.data?.order?.order_id
    || 'unknown';
  return `${event.type}:${paymentId}`;
}

export async function handleCashfreeEvent(event) {
  switch (event.type) {
    case 'PAYMENT_SUCCESS_WEBHOOK': {
      const orderRef = event.data?.order?.order_id;
      const payment = event.data?.payment;
      if (!orderRef) return { handled: false, action: 'no-order-ref' };

      await confirmPayment(orderRef, {
        providerRef: orderRef,
        paymentIntent: payment?.cf_payment_id ? String(payment.cf_payment_id) : null,
        verifiedVia: 'cashfree-webhook',
      });
      return { handled: true, action: 'confirmed' };
    }

    case 'PAYMENT_FAILED_WEBHOOK':
    case 'PAYMENT_USER_DROPPED_WEBHOOK': {
      const orderRef = event.data?.order?.order_id;
      const payment = event.data?.payment;
      if (orderRef) {
        markFailed(orderRef, payment?.payment_message || 'The payment was declined.');
      }
      return { handled: true, action: 'marked-failed' };
    }

    default:
      return { handled: false, action: 'ignored' };
  }
}
