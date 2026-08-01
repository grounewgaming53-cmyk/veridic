/* ========================================================================
   VERIDIC — shared payment client
   ------------------------------------------------------------------------
   Talks to the payment API when a server is present. If the site is served
   statically (GitHub Pages, file://) the API is unreachable, so we fall
   back to a clearly-labelled offline simulation that keeps the pages
   demonstrable — while never pretending a payment occurred.

   The browser NEVER sends an amount. It sends a plan id and the server
   looks the price up; otherwise a caller could edit the request and buy
   Enterprise for a penny.
   ======================================================================== */

(function (global) {
  'use strict';

  const API = '/api';
  const OFFLINE_ORDERS = 'veridic.offlineOrders.v1';

  const CASHFREE_SCRIPT = 'https://sdk.cashfree.com/js/v3/cashfree.js';

  /* Mirrors the server-side table. Only used when there is no server at
     all — the real amounts always come from config.js on the backend. */
  const FALLBACK_PLANS = [
    {
      id: 'pro-monthly', name: 'VERIDIC Pro', label: 'Pro — Monthly', interval: 'month',
      amount: 99900,
      description: 'Mem0 cloud memory sync, advanced JSON workflows, Sentinel predictive monitoring, Digital Twin sandbox, priority support.',
    },
    {
      id: 'pro-annual', name: 'VERIDIC Pro', label: 'Pro — Annual', interval: 'year',
      amount: 999000,
      description: 'Everything in Pro, billed yearly — two months free versus monthly.',
    },
  ];

  /* ------------------------------------------------------------ utils */

  function money(amount, currency) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: String(currency || 'inr').toUpperCase(),
        minimumFractionDigits: 2,
      }).format(amount / 100);
    } catch (_) {
      return (amount / 100).toFixed(2) + ' ' + String(currency || 'inr').toUpperCase();
    }
  }

  function maskEmail(email) {
    const parts = String(email || '').split('@');
    if (parts.length !== 2) return '***';
    return parts[0].slice(0, 2) + '*'.repeat(Math.max(parts[0].length - 2, 1)) + '@' + parts[1];
  }

  function maskPhone(phone) {
    const d = String(phone || '').replace(/[^\d+]/g, '');
    if (d.length < 4) return '***';
    return d.slice(0, 3) + '*'.repeat(Math.max(d.length - 6, 2)) + d.slice(-3);
  }

  function normalizePhone(raw, countryCode) {
    let s = String(raw || '').trim();
    if (!s) return null;
    const hadPlus = s.startsWith('+') || s.startsWith('00');
    s = s.replace(/^00/, '').replace(/[^\d]/g, '');
    if (!s) return null;
    if (!hadPlus && countryCode) {
      const cc = String(countryCode).replace(/[^\d]/g, '');
      if (cc && s.indexOf(cc) !== 0) s = cc + s.replace(/^0+/, '');
    }
    if (s.length < 8 || s.length > 15) return null;
    return '+' + s;
  }

  function randomBlock(n) {
    const A = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
    const bytes = new Uint8Array(n);
    (global.crypto || global.msCrypto).getRandomValues(bytes);
    let out = '';
    for (let i = 0; i < n; i++) out += A[bytes[i] % A.length];
    return out;
  }

  /* ------------------------------------------------- offline order store */

  const offline = {
    all() {
      try { return JSON.parse(localStorage.getItem(OFFLINE_ORDERS) || '{}'); }
      catch (_) { return {}; }
    },
    save(order) {
      const all = this.all();
      all[order.ref] = order;
      try { localStorage.setItem(OFFLINE_ORDERS, JSON.stringify(all)); } catch (_) { /* full/blocked */ }
      return order;
    },
    get(ref) {
      return this.all()[ref] || null;
    },
    forAccount(email) {
      const target = String(email || '').toLowerCase();
      return Object.values(this.all())
        .filter((o) => (o.accountEmail || '').toLowerCase() === target)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    },
  };

  /* ---------------------------------------------------------- API layer */

  let cachedConfig = null;

  async function apiFetch(path, options) {
    const res = await fetch(API + path, Object.assign({
      headers: { 'Content-Type': 'application/json' },
    }, options || {}));

    let payload = null;
    try { payload = await res.json(); } catch (_) { /* non-JSON */ }

    if (!res.ok) {
      const err = new Error((payload && payload.error) || ('Request failed (' + res.status + ')'));
      err.status = res.status;
      err.field = payload && payload.field;
      throw err;
    }
    return payload;
  }

  async function loadConfig() {
    if (cachedConfig) return cachedConfig;
    try {
      const cfg = await apiFetch('/payments/config');
      cachedConfig = Object.assign({ online: true }, cfg);
    } catch (_) {
      cachedConfig = {
        online: false,
        mode: 'offline',
        demoAvailable: true,
        currency: 'inr',
        channels: { sms: false, email: false },
        cashfreeEnv: null,
        plans: FALLBACK_PLANS,
      };
    }
    return cachedConfig;
  }

  /* ------------------------------------------------------------ actions */

  async function createCheckout(details) {
    const cfg = await loadConfig();

    if (cfg.online) {
      return apiFetch('/checkout/session', {
        method: 'POST',
        body: JSON.stringify(details),
      });
    }

    /* No server: build a local pending order and route to the simulator.
       Nothing is charged and nothing is sent — the pages say so plainly. */
    const plan = (cfg.plans || FALLBACK_PLANS).find((p) => p.id === details.plan);
    if (!plan) throw new Error('Unknown plan.');

    const phone = normalizePhone(details.phone, details.countryCode);
    if (!phone) {
      const err = new Error('Enter a valid mobile number, including country code.');
      err.field = 'phone';
      throw err;
    }

    const ref = 'VRDC-' + randomBlock(4) + '-' + randomBlock(4);
    const order = {
      ref,
      status: 'pending',
      offline: true,
      plan: { id: plan.id, label: plan.label },
      amount: plan.amount,
      currency: cfg.currency,
      buyerName: String(details.name || '').trim(),
      buyerEmail: String(details.email || '').trim().toLowerCase(),
      buyerPhone: phone,
      buyerEmailMasked: maskEmail(details.email),
      buyerPhoneMasked: maskPhone(phone),
      accountEmail: details.accountEmail || null,
      licenseKey: null,
      notifications: {
        sms: { status: 'pending', detail: null },
        email: { status: 'pending', detail: null },
      },
      createdAt: new Date().toISOString(),
      paidAt: null,
    };

    offline.save(order);
    return { ref, mode: 'offline', url: 'demo-pay.html?ref=' + encodeURIComponent(ref), order };
  }

  /* ---------------------------------------------------- Cashfree overlay */

  let scriptPromise = null;

  /** Injects Cashfree's Web SDK once and resolves when it's ready. */
  function loadCashfreeScript() {
    if (global.Cashfree) return Promise.resolve();
    if (scriptPromise) return scriptPromise;

    scriptPromise = new Promise((resolve, reject) => {
      const tag = document.createElement('script');
      tag.src = CASHFREE_SCRIPT;
      tag.onload = () => resolve();
      tag.onerror = () => reject(new Error('Could not load the payment window. Check your connection and try again.'));
      document.head.appendChild(tag);
    });
    return scriptPromise;
  }

  /**
   * Opens Cashfree's hosted Checkout overlay. Card/UPI/netbanking fields
   * live inside an iframe served from Cashfree's own origin — this page's
   * JavaScript never has access to them.
   *
   * Cashfree's SDK does not hand the browser a signed proof of payment the
   * way some providers do, so its own result object is never treated as
   * the final word — whatever it reports, we ALWAYS follow up with
   * /api/orders/:ref/confirm, which makes its own authenticated call to
   * Cashfree's API to find out what genuinely happened. That server-side
   * answer is what decides success, failure, or "still pending".
   */
  async function openCashfreeCheckout({ ref, cashfree }, { onVerified, onFailed, onDismiss }) {
    await loadCashfreeScript();

    const cf = global.Cashfree({ mode: cashfree.env === 'production' ? 'production' : 'sandbox' });

    try {
      await cf.checkout({
        paymentSessionId: cashfree.paymentSessionId,
        redirectTarget: '_modal',
      });
    } catch (_) {
      /* Fall through regardless — the reconcile call below is the source
         of truth, not this promise's rejection/resolution shape. */
    }

    try {
      const data = await apiFetch('/orders/' + encodeURIComponent(ref) + '/confirm', { method: 'POST' });
      const order = data.order;
      if (order && order.status === 'paid') onVerified(order);
      else if (order && order.status === 'failed') onFailed(order.failureReason || 'The payment was declined.');
      else onDismiss();
    } catch (err) {
      onFailed(err.message || 'Payment could not be verified.');
    }
  }

  async function getOrder(ref) {
    const cfg = await loadConfig();
    if (cfg.online) {
      const data = await apiFetch('/orders/' + encodeURIComponent(ref));
      return data.order;
    }
    const local = offline.get(ref);
    if (!local) throw new Error('Order not found.');
    return local;
  }

  async function verifyOrder(ref) {
    const cfg = await loadConfig();
    if (cfg.online) {
      const data = await apiFetch('/orders/' + encodeURIComponent(ref) + '/verify', { method: 'POST' });
      return data.order;
    }
    return offline.get(ref);
  }

  async function completeDemo(ref, outcome) {
    const cfg = await loadConfig();

    if (cfg.online) {
      const data = await apiFetch('/demo/complete', {
        method: 'POST',
        body: JSON.stringify({ ref: ref, outcome: outcome }),
      });
      return data.order;
    }

    const order = offline.get(ref);
    if (!order) throw new Error('Order not found.');
    if (order.status !== 'pending') return order;

    if (outcome === 'decline') {
      order.status = 'failed';
      order.failureReason = 'Simulated decline — the test payment was rejected.';
      return offline.save(order);
    }

    order.status = 'paid';
    order.paidAt = new Date().toISOString();
    order.verifiedVia = 'offline-simulator';
    order.licenseKey = 'VRDC-' + randomBlock(4) + '-' + randomBlock(4) + '-' + randomBlock(4) + '-' + randomBlock(4);
    order.notifications = {
      sms: { status: 'simulated', detail: 'No server is running — nothing was sent to ' + order.buyerPhoneMasked },
      email: { status: 'simulated', detail: 'No server is running — nothing was sent to ' + order.buyerEmailMasked },
    };
    return offline.save(order);
  }

  async function ordersForAccount(email) {
    const cfg = await loadConfig();
    if (cfg.online) {
      try {
        const data = await apiFetch('/orders?email=' + encodeURIComponent(email));
        return data.orders || [];
      } catch (_) {
        return [];
      }
    }
    return offline.forAccount(email);
  }

  /* -------------------------------------------------------------- expose */

  global.VeridicPay = {
    loadConfig,
    createCheckout,
    openCashfreeCheckout,
    getOrder,
    verifyOrder,
    completeDemo,
    ordersForAccount,
    money,
    maskEmail,
    maskPhone,
    normalizePhone,
    FALLBACK_PLANS,
  };
})(window);
