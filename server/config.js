/* ========================================================================
   VERIDIC payments — configuration
   ------------------------------------------------------------------------
   Every secret is read from the environment. Nothing here is ever sent to
   the browser: the frontend only learns which *mode* we are in, which
   plans exist, and the payment session id for a specific order (a
   short-lived, single-order token — not a reusable credential). The
   Cashfree **secret key** never leaves this file.

   Load env with Node's built-in flag (no dotenv dependency):
     node --env-file-if-exists=.env server.js
   ======================================================================== */

const env = (key, fallback = '') => (process.env[key] ?? fallback).trim();
const flag = (key, dflt = false) => {
  const v = env(key);
  if (!v) return dflt;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
};

/* ---------------------------------------------------------------- plans */

/* Prices live HERE, on the server, and nowhere else. The browser sends a
   plan id and never an amount — otherwise a caller could edit the request
   and buy Enterprise for one rupee. Amounts are in the currency's smallest
   unit (paise for INR) EVERYWHERE IN THIS APP — the database, the masking,
   the notification templates. Cashfree is the one exception: its API wants
   a decimal rupee amount, so the paise→rupee conversion happens only at
   that boundary, inside payments.js. */
export const PLANS = {
  'pro-monthly': {
    id: 'pro-monthly',
    name: 'VERIDIC Pro',
    interval: 'month',
    label: 'Pro — Monthly',
    amount: 99900, // ₹999.00
    description: 'Mem0 cloud memory sync, advanced JSON workflows, Sentinel predictive monitoring, Digital Twin sandbox, priority support.',
  },
  'pro-annual': {
    id: 'pro-annual',
    name: 'VERIDIC Pro',
    interval: 'year',
    label: 'Pro — Annual',
    amount: 999000, // ₹9,990.00 — exactly 10× monthly, i.e. 2 months free
    description: 'Everything in Pro, billed yearly — two months free versus monthly.',
  },
};

export const getPlan = (id) => PLANS[String(id || '').trim()] || null;

/* ------------------------------------------------------------- runtime */

export const config = {
  port: Number(env('PORT', '8123')),
  publicUrl: env('PUBLIC_URL', `http://localhost:${env('PORT', '8123')}`),
  currency: env('CURRENCY', 'inr').toLowerCase(),
  dbPath: env('DB_PATH', './orders.db'),
  env: env('NODE_ENV', 'development').toLowerCase(),

  admin: {
    /* "scrypt:<saltHex>:<hashHex>" — generate with
       node server/scripts/hash-admin-password.mjs
       The plain password is never stored anywhere, including here. */
    passwordHash: env('ADMIN_PASSWORD_HASH'),
    sessionTtlHours: Number(env('ADMIN_SESSION_TTL_HOURS', '12')),
  },

  cashfree: {
    appId: env('CASHFREE_APP_ID'),
    secretKey: env('CASHFREE_SECRET_KEY'),
    /* Cashfree gives you distinct sandbox and production credentials —
       unlike Stripe/Razorpay there's no reliable prefix on the key itself
       to detect which one you're holding, so this is explicit rather than
       guessed. Defaults to the safe option. */
    env: env('CASHFREE_ENV', 'sandbox').toLowerCase(),
    apiVersion: '2023-08-01',
  },

  twilio: {
    accountSid: env('TWILIO_ACCOUNT_SID'),
    authToken: env('TWILIO_AUTH_TOKEN'),
    from: env('TWILIO_FROM_NUMBER'),
    messagingServiceSid: env('TWILIO_MESSAGING_SERVICE_SID'),
  },

  resend: {
    apiKey: env('RESEND_API_KEY'),
    from: env('EMAIL_FROM', 'VERIDIC <onboarding@resend.dev>'),
    replyTo: env('EMAIL_REPLY_TO'),
  },

  /* Allow the simulated payment path even when Cashfree IS configured.
     Useful for demoing the flow without moving money. */
  allowDemo: flag('ALLOW_DEMO_PAYMENTS', true),
};

/* --------------------------------------------------------- capabilities */

export const capabilities = {
  get cashfree() {
    return Boolean(config.cashfree.appId && config.cashfree.secretKey);
  },
  get sms() {
    return Boolean(
      config.twilio.accountSid &&
      config.twilio.authToken &&
      (config.twilio.from || config.twilio.messagingServiceSid)
    );
  },
  get email() {
    return Boolean(config.resend.apiKey);
  },
};

/* What the browser is allowed to know. No secrets, by construction. */
export function publicConfig() {
  return {
    mode: capabilities.cashfree ? 'live' : 'demo',
    demoAvailable: config.allowDemo || !capabilities.cashfree,
    currency: config.currency,
    channels: { sms: capabilities.sms, email: capabilities.email },
    cashfreeEnv: capabilities.cashfree ? config.cashfree.env : null,
    plans: Object.values(PLANS).map((p) => ({
      id: p.id,
      name: p.name,
      label: p.label,
      interval: p.interval,
      amount: p.amount,
      description: p.description,
    })),
  };
}

/* ------------------------------------------------------------ warnings */

export function startupWarnings() {
  const warn = [];
  if (!capabilities.cashfree) {
    warn.push('CASHFREE_APP_ID / CASHFREE_SECRET_KEY are not set — running in DEMO mode. No card will ever be charged.');
  }
  if (!capabilities.sms) warn.push('Twilio not configured — confirmation SMS will be logged to the console instead of sent.');
  if (!capabilities.email) warn.push('Resend not configured — confirmation email will be logged to the console instead of sent.');
  if (capabilities.cashfree && config.cashfree.env === 'production') {
    warn.push('*** CASHFREE_ENV=production — real cards/UPI will be charged. ***');
  }
  if (!config.admin.passwordHash) {
    warn.push('ADMIN_PASSWORD_HASH is not set — the admin page is disabled. Run: node server/scripts/hash-admin-password.mjs');
  }
  return warn;
}
