# VERIDIC — payments, verification & buyer notifications

Express backend that creates payment orders, **verifies** them server-side, and
sends the buyer a confirmation **SMS and email** once the payment is proven.

Payments run through **Cashfree** — UPI, cards, netbanking and wallets, with
sandbox credentials available immediately on signup and no business
registration required until you switch to production.

It also serves the static site, so everything runs on one origin — no CORS, and
the webhook, the pages and the API share a host.

---

## Run it in 30 seconds

```bash
npm install
npm start
```

Open <http://localhost:8123>. With no configuration at all it runs in **demo
mode**: payments are simulated and the SMS/email are printed to the server
console instead of being sent. The full verification path still executes.

---

## The three modes

| Mode | Trigger | Payment | SMS / Email |
|---|---|---|---|
| **Offline** | No server running (static hosting, `file://`) | Simulated in the browser | Nothing sent; the page says so |
| **Demo** | Server running, no Cashfree keys | Simulated via `/demo-pay.html` | Logged to the server console |
| **Live** | `CASHFREE_APP_ID` + `CASHFREE_SECRET_KEY` set | Real Cashfree Checkout | Really sent, if Twilio/Resend are configured |

Demo and live run the **same** `confirmPayment()` funnel, so the demo exercises
the real verification and notification code rather than a parallel happy path
that could drift out of sync.

---

## Going live

### 1. Cashfree account & keys

Sign up at [cashfree.com](https://www.cashfree.com). **Sandbox/test API keys
are available immediately** — no KYC or business registration needed to start
testing. KYC is only required when you set `CASHFREE_ENV=production` to accept
real money.

```bash
# .env
CASHFREE_APP_ID=...
CASHFREE_SECRET_KEY=...
CASHFREE_ENV=sandbox
```

Dashboard → **Developers → API Keys**. That's enough to take real test
payments end to end.

### 2. How verification works here

Cashfree's Checkout SDK doesn't hand your browser a cryptographic signature to
relay back the way some providers do. So instead, the moment the checkout
window closes, the browser calls `POST /api/orders/:ref/confirm` — and that
endpoint does **not** trust whatever the browser thinks happened. It makes its
own server-to-server call to Cashfree's Order API, authenticated with your
secret key, and asks Cashfree directly: *did this order actually get paid?*
A browser can misreport what it saw. It cannot make Cashfree's own API lie.

That means **the payment flow works correctly on localhost with zero webhook
setup.** The webhook (below) is a *second, independent* confirmation path —
useful when a buyer pays successfully but closes the tab before that
reconcile call can complete.

### 3. The webhook (optional but recommended for production)

Dashboard → **Developers → Webhooks → Add Webhook**:

- URL: `https://your-domain/api/payments/webhook`
- Events: `PAYMENT_SUCCESS_WEBHOOK`, `PAYMENT_FAILED_WEBHOOK`,
  `PAYMENT_USER_DROPPED_WEBHOOK`

No separate secret to invent or copy — Cashfree signs webhooks with the same
`CASHFREE_SECRET_KEY` you already have.

For **local** testing of the webhook specifically, Cashfree needs a public
HTTPS URL to reach your machine — use a tunnel:

```bash
ngrok http 8123
# then register https://<random>.ngrok-free.app/api/payments/webhook
```

Sandbox test cards and UPI handles are listed in the Cashfree dashboard under
**Developers → Test Details** — use those exact values, since Cashfree updates
them periodically.

### 4. SMS — Twilio

```bash
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_FROM_NUMBER=+15551234567
```

> Trial accounts can only send to numbers verified in the Twilio console.
> Verify your own mobile before testing, or the send fails with a clear error
> that is recorded against the order.

### 5. Email — Resend

```bash
RESEND_API_KEY=re_...
EMAIL_FROM=VERIDIC <billing@your-domain.com>
```

Until you verify a domain, Resend only allows its shared `onboarding@resend.dev`
sender and only delivers to your own signup address.

**Prefer a different email provider?** Everything lives in one function —
`sendEmailViaResend()` in `notify.js`. Swap the fetch call; nothing else changes.

---

## How a purchase actually flows

```
checkout.html
   │  POST /api/checkout/session   { plan, name, email, phone }
   │     · price looked up SERVER-SIDE from config.js  (never trust a client amount)
   │     · order row created, status = pending
   │     · Cashfree Order created via REST API (order_id = our own ref)
   ▼
Cashfree Checkout overlay  ← the buyer pays HERE, inside a Cashfree-hosted
   │                          iframe — never on our own <input> fields
   │
   ▼  (whatever the overlay reports — success, failure, or dismissed —
   │   is NOT trusted by itself)
   │
   POST /api/orders/:ref/confirm       ← the primary confirmation path
        · server calls Cashfree's Order API itself, authenticated with
          CASHFREE_SECRET_KEY, and reads back the real payment status
        · a browser can misreport what happened; it cannot make
          Cashfree's own API report something false

   also, independently:
   POST /api/payments/webhook          ← the redundant safety net
        · signature verified over the RAW body (HMAC-SHA256, base64)
        · duplicate event rejected
        · covers a buyer who closed the tab before the confirm call ran

Either path (or both, racing) calls the same funnel:
   markPaid()  → returns firstTime once, ever
   claimNotification() → grants the send right once, ever
   notifyBuyer() → SMS + email
```

Two independent guards stop a race between the confirm call and a redelivered
webhook from texting the buyer twice: `markPaid` only reports `firstTime` on
the transition, and `claimNotification` is a conditional
`UPDATE ... WHERE notified_at IS NULL`.

If neither the confirm call nor the webhook arrives (network dropped
mid-payment), `GET /api/orders/:ref` reconciles by asking Cashfree directly
whether any payment against that order succeeded — so a missing signal delays
confirmation, it does not lose it.

---

## Security notes

- **No card/UPI data ever reaches this codebase.** Cashfree's iframe collects
  it. There is deliberately no card input field anywhere in the site.
- **Prices are server-side only.** The browser sends a plan id. If it sent an
  amount, a caller could edit the request and buy Enterprise for one rupee.
- **The raw webhook body matters.** The webhook route is mounted with
  `express.raw()` *before* `express.json()`. Parsing first would change the
  bytes and break the signature check.
- **The confirmation is a real server-to-server API call, not a trusted
  report.** `CASHFREE_SECRET_KEY` never reaches the browser; only the server
  can ask Cashfree what actually happened.
- **Amounts cross a unit boundary carefully.** Every other number in this app
  (the price table, the database, notifications) stays in paise — Cashfree's
  API wants decimal rupees, and that conversion happens in exactly one place
  (`paiseToDecimal()` in `payments.js`) to avoid a stray ×100/÷100 bug.
- **Contact details are masked** in API responses, so an order reference alone
  cannot be used to harvest a phone number or email.
- **`.env` and `*.db` are blocked** from static serving even though they sit
  under the project root.
- Set `ALLOW_DEMO_PAYMENTS=false` in production, or anyone can mint a free
  "paid" order through `/api/demo/complete`.

---

## Admin console

`/admin.html` is a private operator page listing every customer and order
with **unmasked** contact details, license keys and payment status. It is the
only part of the API that returns a real email address or phone number.

### Setup

```bash
cd server
node scripts/hash-admin-password.mjs
```

Enter a password (12+ characters) at the hidden prompt. It prints a line like:

```
ADMIN_PASSWORD_HASH=scrypt:a7c5da4d…:bd6edc48…
```

Paste that into `.env` and restart. The plain password is never written to
disk — only its scrypt hash, and only by you.

> With `ADMIN_PASSWORD_HASH` unset the admin page is **disabled entirely**:
> every login attempt is refused and all data routes return 401. A missing
> password never means "no password required".

### How the session works

On a correct password the server mints a random 32-byte token, stores it in
the `admin_sessions` table with an expiry, and returns it in a cookie:

```
Set-Cookie: veridic_admin=…; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=43200
```

- **HttpOnly** — JavaScript cannot read it. Verified: `document.cookie` is
  empty even while signed in. An XSS bug elsewhere on the site still could
  not steal the admin session.
- **SameSite=Strict** — never sent on a cross-site request, which is the
  strongest available CSRF defense for a page with no cross-site use case.
- **Secure** — added automatically when `PUBLIC_URL` is https or
  `NODE_ENV=production`. (Omitted on plain localhost so local dev works.)
- **Server-side sessions, not JWTs** — the cookie is an opaque lookup key,
  so a session can be revoked instantly. A signed stateless token could not.

State-changing admin routes additionally require an `X-Veridic-Admin: 1`
header, which a cross-site `<form>` POST cannot set — a second, independent
CSRF layer behind SameSite.

Failed logins are rate-limited to 6 per IP per 15 minutes. The lockout holds
even for the correct password, and is per-IP so it cannot be used to lock the
real admin out globally.

### What you can do there

- See every order: real name, email, phone, plan, amount, license key,
  SMS/email delivery status
- Filter by paid / pending / failed
- Click any value to copy it
- **Mark paid** — for an order where money genuinely arrived but neither the
  webhook nor the reconcile call could confirm it. Runs the same
  `confirmPayment()` funnel as an automatic confirmation, so the buyer still
  gets their license key and their SMS/email.
- **Revoke all sessions** — signs out every admin session everywhere,
  including your own. The "I think someone else got in" button.

---

## API

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/admin/status` | Whether admin is configured / you're signed in. Unauthenticated by design. |
| `POST` | `/api/admin/login` | Exchange the password for a session cookie. |
| `POST` | `/api/admin/logout` | Revoke this session. |
| `GET` | `/api/admin/overview` | Revenue and order counts. **Auth required.** |
| `GET` | `/api/admin/orders` | All orders, unmasked. **Auth required.** |
| `POST` | `/api/admin/orders/:ref/mark-paid` | Manual confirmation. **Auth + header.** |
| `POST` | `/api/admin/revoke-all` | Kill every admin session. **Auth + header.** |
| `GET` | `/api/payments/config` | Capabilities and server-side plan list. No secrets. |
| `POST` | `/api/checkout/session` | Create an order + a Cashfree order. |
| `POST` | `/api/orders/:ref/confirm` | Reconcile-on-return after the checkout overlay closes. |
| `POST` | `/api/payments/webhook` | Cashfree → us. Signature verified. |
| `GET` | `/api/orders/:ref` | Order status (masked). Reconciles opportunistically. |
| `POST` | `/api/orders/:ref/verify` | Force a reconcile against the provider. |
| `GET` | `/api/orders?email=` | Order history for an account. |
| `POST` | `/api/demo/complete` | Settle a simulated payment (demo mode only). |
| `GET` | `/healthz` | Liveness + which channels are configured. |

## Files

| File | Role |
|---|---|
| `server.js` | Express wiring, static hosting, raw-body webhook mount |
| `config.js` | Env loading, **the price table**, capability detection |
| `db.js` | `node:sqlite` order store, admin sessions, idempotency guards, masking |
| `adminAuth.js` | Admin password hashing, session cookies, lockout |
| `adminRoutes.js` | Admin API (the only unmasked-data surface) |
| `payments.js` | Cashfree orders, reconcile call, webhook verification, the confirm funnel |
| `notify.js` | SMS/email templates and Twilio/Resend adapters |
| `routes.js` | HTTP API |

Only dependency is `express` — Cashfree needs no SDK (plain `fetch` REST calls
+ `node:crypto` for HMAC verification), and SQLite is a Node built-in.
