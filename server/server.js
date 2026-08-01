/* ========================================================================
   VERIDIC payments — server entry point
   ------------------------------------------------------------------------
   Serves the static site AND the payment API from one origin, so there is
   no CORS surface and the webhook, the pages and the API all share a host.

   Run:  npm start          (or: npm run dev  for --watch)
   ======================================================================== */

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, capabilities, startupWarnings } from './config.js';
import { router, cashfreeWebhookHandler } from './routes.js';
import { adminRouter } from './adminRoutes.js';
import { adminConfigured } from './adminAuth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITE_ROOT = path.resolve(__dirname, '..');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

/* ---------------------------------------------------------------------
   The webhook MUST be registered before express.json(), and with a raw
   body parser. Cashfree signs the exact bytes it sent; if a JSON parser
   touches the body first, re-serialising it changes those bytes and
   every signature check fails.
   --------------------------------------------------------------------- */
app.post(
  '/api/payments/webhook',
  express.raw({ type: 'application/json', limit: '1mb' }),
  cashfreeWebhookHandler
);

app.use(express.json({ limit: '100kb' }));

/* ------------------------------------------------------------ security */

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});

/* Never let the database or the environment file be served as a static
   asset just because they live under the project root. */
app.use((req, res, next) => {
  if (/(^|\/)(\.env|.*\.db(-wal|-shm)?|server)(\/|$)/i.test(req.path)) {
    return res.status(404).send('Not found');
  }
  next();
});

/* ---------------------------------------------------------------- API */

app.use('/api/admin', adminRouter);
app.use('/api', router);

app.get('/healthz', (_req, res) => {
  res.json({
    ok: true,
    mode: capabilities.cashfree ? 'live' : 'demo',
    channels: { sms: capabilities.sms, email: capabilities.email },
    uptime: Math.round(process.uptime()),
  });
});

/* -------------------------------------------------------- static site */

app.use(express.static(SITE_ROOT, {
  extensions: ['html'],
  setHeaders(res, filePath) {
    if (/\.(html)$/i.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
  },
}));

app.use((_req, res) => {
  res.status(404).sendFile(path.join(SITE_ROOT, 'index.html'));
});

/* eslint-disable-next-line no-unused-vars -- Express identifies error
   handlers by arity; `next` must stay in the signature. */
app.use((err, _req, res, _next) => {
  console.error('[server] unhandled:', err);
  res.status(500).json({ error: 'Internal server error' });
});

/* ------------------------------------------------------------- listen */

app.listen(config.port, () => {
  const warnings = startupWarnings();

  console.log('');
  console.log('  VERIDIC payments');
  console.log('  ─────────────────────────────────────────────');
  console.log(`  Site      http://localhost:${config.port}`);
  console.log(`  Mode      ${capabilities.cashfree ? `LIVE (Cashfree, ${config.cashfree.env})` : 'DEMO (simulated)'}`);
  console.log(`  SMS       ${capabilities.sms ? 'Twilio' : 'console (simulated)'}`);
  console.log(`  Email     ${capabilities.email ? 'Resend' : 'console (simulated)'}`);
  console.log(`  Admin     ${adminConfigured() ? `${config.publicUrl}/admin.html` : 'DISABLED (no ADMIN_PASSWORD_HASH)'}`);
  console.log(`  Webhook   POST ${config.publicUrl}/api/payments/webhook`);
  console.log('');

  if (warnings.length) {
    for (const w of warnings) console.log(`  ! ${w}`);
    console.log('');
  }
});
