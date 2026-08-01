# VERIDIC — website

Marketing site, documentation, checkout and admin console for VERIDIC.

## What's here

| Path | What it is |
|---|---|
| `index.html` | Landing page |
| `docs.html` | Full documentation — every tool and feature |
| `login.html` / `dashboard.html` | Customer accounts *(see the note below)* |
| `checkout.html` / `order.html` | Purchase flow and order status |
| `admin.html` | **Private** operator console |
| `server/` | Node/Express backend — payments, verification, notifications, admin |

## Running it locally

```bash
cd server
npm install
npm start
```

Then open <http://localhost:8123>.

With no configuration it runs in **demo mode**: payments are simulated and
confirmation SMS/emails print to the server console instead of being sent.
The full verification path still executes, so the flow is genuinely
exercisable without signing up for anything.

See [`server/README.md`](server/README.md) for going live — Cashfree keys,
Twilio/Resend, the webhook, and admin setup.

## Deploying

**GitHub Pages will not work for this site.** Pages serves static files only,
and the payment verification, webhook endpoint and admin session cookies all
require a running Node process.

[`render.yaml`](render.yaml) is a ready-to-use Render blueprint:

1. Push this repo to GitHub
2. Render dashboard → **New → Blueprint** → select this repo
3. Add the secret environment variables when prompted (they are never stored
   in the repo)

> The Render free tier has an ephemeral filesystem — `orders.db` is wiped on
> each deploy and on idle spin-down. Fine for testing; attach a Render Disk
> or move to Postgres before taking real money.

## Admin console

`/admin.html` shows every customer and order with full contact details,
license keys and payment status. It is protected by a scrypt-hashed password
and an `HttpOnly` / `SameSite=Strict` session cookie, and is **disabled
entirely** unless `ADMIN_PASSWORD_HASH` is set.

```bash
cd server
node scripts/hash-admin-password.mjs
```

Full details in [`server/README.md`](server/README.md#admin-console).

## A note on customer login

The customer-facing sign-in (`login.html`, `dashboard.html`) currently stores
accounts in the visitor's own browser via `localStorage`. That means an
account exists only on the device that created it — it is a working demo of
the UI, **not** a real multi-device account system.

The admin console is different: it is fully server-backed and genuinely
secure. Migrating customer accounts onto the server is the natural next step.

## Security

- Card and UPI details are entered in the payment provider's own iframe and
  never touch this codebase — there is deliberately no card input field
- Prices are read server-side from a plan id; the browser never sends an amount
- Payment is confirmed by an authenticated server-to-server call plus a
  signature-verified webhook, never by trusting a browser redirect
- `.env` and `orders.db` are gitignored — `orders.db` holds real customer
  names, emails and phone numbers and must never enter version control
