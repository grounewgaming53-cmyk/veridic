/* ========================================================================
   VERIDIC payments — buyer notifications (SMS + email)
   ------------------------------------------------------------------------
   Called once per paid order, behind the claimNotification() idempotency
   gate in db.js. Both channels are attempted independently: a dead SMS
   provider must not swallow the receipt email.

   Adapters use global fetch, so no SDKs are needed.
     SMS   — Twilio Messages API
     Email — Resend
     Both  — fall back to console logging when unconfigured, so the whole
             flow is exercisable end to end with no accounts at all.
   ======================================================================== */

import { config, capabilities } from './config.js';
import { updateOrder, maskEmail, maskPhone } from './db.js';

/* --------------------------------------------------------- formatting */

export function formatMoney(amount, currency) {
  const code = String(currency || 'usd').toUpperCase();
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
      minimumFractionDigits: 2,
    }).format(amount / 100);
  } catch {
    return `${(amount / 100).toFixed(2)} ${code}`;
  }
}

/* E.164 normalisation. Twilio rejects anything else, and rejecting early
   with a clear message beats a provider error after the card is charged. */
export function normalizePhone(raw, defaultCountryCode = '') {
  let s = String(raw || '').trim();
  if (!s) return null;

  const hadPlus = s.startsWith('+') || s.startsWith('00');
  s = s.replace(/^00/, '').replace(/[^\d]/g, '');
  if (!s) return null;

  if (!hadPlus && defaultCountryCode) {
    const cc = String(defaultCountryCode).replace(/[^\d]/g, '');
    if (cc && !s.startsWith(cc)) s = cc + s.replace(/^0+/, '');
  }

  if (s.length < 8 || s.length > 15) return null;
  return `+${s}`;
}

/* --------------------------------------------------------- templates */

export function smsBody(order) {
  const amount = formatMoney(order.amount, order.currency);
  return [
    `VERIDIC: payment confirmed. Thank you, ${order.buyer_name.split(' ')[0]}!`,
    ``,
    `Plan: ${order.plan_label}`,
    `Paid: ${amount}`,
    `Order: ${order.ref}`,
    `License: ${order.license_key}`,
    ``,
    `Activate with "veridic start". Receipt emailed to ${maskEmail(order.buyer_email)}.`,
  ].join('\n');
}

export function emailSubject(order) {
  return `Payment confirmed — ${order.plan_label} (${order.ref})`;
}

export function emailText(order) {
  const amount = formatMoney(order.amount, order.currency);
  return [
    `Hi ${order.buyer_name.split(' ')[0]},`,
    ``,
    `Your payment has been received and verified.`,
    ``,
    `  Order reference : ${order.ref}`,
    `  Plan            : ${order.plan_label}`,
    `  Amount paid     : ${amount}`,
    `  Paid at         : ${new Date(order.paid_at || Date.now()).toUTCString()}`,
    `  License key     : ${order.license_key}`,
    ``,
    `Activating:`,
    `  1. Install VERIDIC and run "veridic start".`,
    `  2. Paste the license key above when prompted.`,
    `  3. The key is bound to that machine's hardware ID on first activation.`,
    ``,
    `Keep this key somewhere safe — it is also saved to your account dashboard.`,
    ``,
    order.receipt_url ? `Card receipt: ${order.receipt_url}\n` : '',
    `— The VERIDIC Project`,
  ].filter(Boolean).join('\n');
}

export function emailHtml(order) {
  const amount = formatMoney(order.amount, order.currency);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const row = (label, value, mono) => `
    <tr>
      <td style="padding:9px 0;color:#6b7280;font-size:13px;">${esc(label)}</td>
      <td style="padding:9px 0;color:#f0f0f5;font-size:13px;text-align:right;${
        mono ? "font-family:'JetBrains Mono',Consolas,monospace;letter-spacing:.5px;" : ''
      }">${esc(value)}</td>
    </tr>`;

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#0a0a0f;">
  <div style="max-width:520px;margin:0 auto;padding:40px 24px;font-family:-apple-system,Segoe UI,Inter,Arial,sans-serif;">

    <div style="display:flex;align-items:center;gap:10px;margin-bottom:32px;">
      <span style="display:inline-block;width:32px;height:32px;background:#f59e0b;border-radius:7px;color:#000;font-weight:900;font-size:18px;text-align:center;line-height:32px;">V</span>
      <span style="color:#f0f0f5;font-size:17px;font-weight:800;letter-spacing:2px;">VERIDIC</span>
    </div>

    <div style="display:inline-block;padding:5px 13px;background:rgba(16,185,129,.12);border:1px solid rgba(16,185,129,.35);border-radius:100px;color:#6ee7b7;font-size:11px;letter-spacing:1px;text-transform:uppercase;margin-bottom:20px;">
      Payment verified
    </div>

    <h1 style="color:#f0f0f5;font-size:24px;margin:0 0 12px;line-height:1.3;">
      Thank you, ${esc(order.buyer_name.split(' ')[0])}.
    </h1>
    <p style="color:#9ca3af;font-size:14px;line-height:1.7;margin:0 0 28px;">
      Your payment cleared and has been verified against the payment provider. Your license key is below.
    </p>

    <div style="background:#1a1a25;border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:22px;margin-bottom:24px;">
      <table style="width:100%;border-collapse:collapse;">
        ${row('Order reference', order.ref, true)}
        ${row('Plan', order.plan_label)}
        ${row('Amount paid', amount)}
        ${row('Paid at', new Date(order.paid_at || Date.now()).toUTCString())}
      </table>
    </div>

    <div style="background:rgba(245,158,11,.07);border:1px solid rgba(245,158,11,.28);border-radius:12px;padding:20px;margin-bottom:28px;">
      <div style="color:#6b7280;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:9px;">Your license key</div>
      <div style="color:#fbbf24;font-family:'JetBrains Mono',Consolas,monospace;font-size:17px;letter-spacing:1.5px;word-break:break-all;">
        ${esc(order.license_key)}
      </div>
    </div>

    <div style="color:#9ca3af;font-size:13.5px;line-height:1.8;margin-bottom:28px;">
      <strong style="color:#f0f0f5;">Activating</strong><br>
      1. Install VERIDIC and run <code style="background:rgba(245,158,11,.1);color:#fbbf24;padding:1px 5px;border-radius:3px;font-family:monospace;">veridic start</code><br>
      2. Paste the key above when prompted<br>
      3. The key binds to that machine's hardware ID on first activation
    </div>

    ${order.receipt_url ? `<p style="margin:0 0 24px;"><a href="${esc(order.receipt_url)}" style="color:#f59e0b;font-size:13px;">View card receipt &rarr;</a></p>` : ''}

    <hr style="border:none;border-top:1px solid rgba(255,255,255,.07);margin:32px 0 18px;">
    <p style="color:#6b7280;font-size:11.5px;line-height:1.7;margin:0;">
      Sent because a purchase was completed for this address. Keep the license key private — it is
      tied to your account.<br>&copy; 2026 VERIDIC Project.
    </p>
  </div>
</body></html>`;
}

/* ------------------------------------------------------------ adapters */

async function sendSmsViaTwilio(to, body) {
  const { accountSid, authToken, from, messagingServiceSid } = config.twilio;
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`;

  const form = new URLSearchParams({ To: to, Body: body });
  if (messagingServiceSid) form.set('MessagingServiceSid', messagingServiceSid);
  else form.set('From', from);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form,
    signal: AbortSignal.timeout(15000),
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(payload.message || `Twilio responded ${res.status}`);
  }
  return `Twilio ${payload.sid || 'queued'} (${payload.status || 'queued'})`;
}

async function sendEmailViaResend(to, subject, text, html) {
  const body = {
    from: config.resend.from,
    to: [to],
    subject,
    text,
    html,
  };
  if (config.resend.replyTo) body.reply_to = config.resend.replyTo;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.resend.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(payload?.message || payload?.error?.message || `Resend responded ${res.status}`);
  }
  return `Resend ${payload.id || 'accepted'}`;
}

/* ------------------------------------------------------------ dispatch */

async function attempt(channel, isConfigured, send, preview) {
  if (!isConfigured) {
    console.log(`\n┌─ [notify:${channel}] SIMULATED — provider not configured`);
    console.log(preview.split('\n').map((l) => `│  ${l}`).join('\n'));
    console.log('└─────────────────────────────────────────────────────\n');
    return { status: 'simulated', detail: 'Provider not configured — logged to server console' };
  }

  try {
    const detail = await send();
    return { status: 'sent', detail };
  } catch (err) {
    console.error(`[notify:${channel}] failed:`, err.message);
    return { status: 'failed', detail: err.message };
  }
}

/**
 * Notify the buyer that payment succeeded. Assumes the caller already won
 * claimNotification(order.ref) — do not call this directly from a route.
 */
export async function notifyBuyer(order) {
  const sms = await attempt(
    'sms',
    capabilities.sms,
    () => sendSmsViaTwilio(order.buyer_phone, smsBody(order)),
    `To: ${maskPhone(order.buyer_phone)}\n\n${smsBody(order)}`
  );

  const email = await attempt(
    'email',
    capabilities.email,
    () => sendEmailViaResend(order.buyer_email, emailSubject(order), emailText(order), emailHtml(order)),
    `To: ${maskEmail(order.buyer_email)}\nSubject: ${emailSubject(order)}\n\n${emailText(order)}`
  );

  updateOrder(order.ref, {
    sms_status: sms.status,
    sms_detail: sms.detail,
    email_status: email.status,
    email_detail: email.detail,
  });

  console.log(
    `[notify] order ${order.ref} → sms=${sms.status} email=${email.status}`
  );

  return { sms, email };
}
