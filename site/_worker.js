// iDoris — Cloudflare Pages 高级模式 Worker
// /api/*：充值(Lemon Squeezy 或 Stripe) + webhook + 钱包(token)计量 + 社区积分；其余回落静态。
// 不引 SDK：fetch 调支付商 REST，Web Crypto 验签。
// 绑定/secret：ENTITLEMENTS(KV) + 以下二选一（配了谁用谁；Lemon Squeezy 优先）：
//   Lemon Squeezy: LEMONSQUEEZY_API_KEY, LEMONSQUEEZY_STORE_ID, LEMONSQUEEZY_VARIANT_ID, LEMONSQUEEZY_WEBHOOK_SECRET
//   Stripe:        STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
// 模式：卖【充值包】。客户端生成一个 wallet 码，随结账带上；webhook 按【实付金额】把 token 充进该钱包（可累加）。

const TOKENS_PER_USD = 30000;   // 1 USD = 多少 token（可调）
const TOKENS_PER_POINT = 300;   // 1 社区积分 = 多少 token
const MIN_USD = 1, MAX_USD = 999;
const PRESETS = [5, 20, 50, 100];

const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json; charset=utf-8' } });
const readJson = async (r) => { try { return await r.json(); } catch { return null; } };
const validWallet = (w) => typeof w === 'string' && /^[a-f0-9]{12,40}$/.test(w);
const provider = (env) => env.LEMONSQUEEZY_API_KEY ? 'lemonsqueezy' : (env.STRIPE_SECRET_KEY ? 'stripe' : null);

// ---------- 钱包：充值累加（幂等按 orderKey）----------
async function topup(env, code, tokens, orderKey) {
  if (orderKey) { const seen = await env.ENTITLEMENTS.get(`order:${orderKey}`); if (seen) return; }
  const raw = await env.ENTITLEMENTS.get(`ent:${code}`);
  let e = raw ? JSON.parse(raw) : { code, tokens: 0, remaining: 0, created: Date.now(), status: 'active' };
  e.tokens += tokens; e.remaining += tokens; e.updated = Date.now();
  await env.ENTITLEMENTS.put(`ent:${code}`, JSON.stringify(e));
  if (orderKey) await env.ENTITLEMENTS.put(`order:${orderKey}`, code, { expirationTtl: 60 * 60 * 24 * 90 });
  return e;
}

// ---------- 结账（按配置选支付商）----------
async function createCheckout(request, env) {
  const prov = provider(env);
  if (!prov) return json({ error: 'payment_not_configured', message: '支付未配置，见 payment/README.md。' }, 503);
  const body = await readJson(request);
  const usd = Math.round(Number(body?.amountUsd) * 100) / 100;
  if (!(usd >= MIN_USD && usd <= MAX_USD)) return json({ error: 'bad_amount', message: `金额需在 $${MIN_USD}–$${MAX_USD}` }, 400);
  const wallet = body?.wallet;
  if (!validWallet(wallet)) return json({ error: 'bad_wallet' }, 400);
  const origin = new URL(request.url).origin;
  const cents = Math.round(usd * 100);

  if (prov === 'lemonsqueezy') {
    const payload = { data: { type: 'checkouts', attributes: {
      custom_price: cents,
      checkout_data: { custom: { wallet } },
      product_options: { redirect_url: `${origin}/buy?status=success`, name: `iDoris 充值 · ${Math.round(usd * TOKENS_PER_USD).toLocaleString()} tokens` },
    }, relationships: {
      store: { data: { type: 'stores', id: String(env.LEMONSQUEEZY_STORE_ID) } },
      variant: { data: { type: 'variants', id: String(env.LEMONSQUEEZY_VARIANT_ID) } },
    } } };
    const resp = await fetch('https://api.lemonsqueezy.com/v1/checkouts', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.LEMONSQUEEZY_API_KEY}`, accept: 'application/vnd.api+json', 'content-type': 'application/vnd.api+json' },
      body: JSON.stringify(payload),
    });
    const data = await resp.json();
    if (!resp.ok) return json({ error: 'lemonsqueezy_error', message: data?.errors?.[0]?.detail || 'Lemon Squeezy 创建结账失败' }, 502);
    return json({ url: data?.data?.attributes?.url });
  }

  // Stripe
  const form = new URLSearchParams();
  form.set('mode', 'payment');
  form.set('line_items[0][price_data][currency]', 'usd');
  form.set('line_items[0][price_data][product_data][name]', `iDoris 充值 · ${Math.round(usd * TOKENS_PER_USD).toLocaleString()} tokens`);
  form.set('line_items[0][price_data][unit_amount]', String(cents));
  form.set('line_items[0][quantity]', '1');
  form.set('success_url', `${origin}/buy?status=success`);
  form.set('cancel_url', `${origin}/buy?status=cancel`);
  form.set('metadata[wallet]', wallet);
  const resp = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  const data = await resp.json();
  if (!resp.ok) return json({ error: 'stripe_error', message: data?.error?.message || 'Stripe 创建会话失败' }, 502);
  return json({ url: data.url });
}

// ---------- webhook 验签 ----------
async function hmacHex(secret, payload) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function timingEq(a, b) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }

async function stripeWebhook(request, env) {
  if (!env.STRIPE_WEBHOOK_SECRET) return json({ error: 'webhook_not_configured' }, 503);
  const payload = await request.text();
  const sig = request.headers.get('stripe-signature') || '';
  const parts = Object.fromEntries(sig.split(',').map((kv) => kv.split('=')));
  if (!parts.t || !parts.v1 || Math.abs(Math.floor(Date.now() / 1000) - Number(parts.t)) > 300) return json({ error: 'invalid_signature' }, 400);
  if (!timingEq(await hmacHex(env.STRIPE_WEBHOOK_SECRET, `${parts.t}.${payload}`), parts.v1)) return json({ error: 'invalid_signature' }, 400);
  const event = JSON.parse(payload);
  if (event.type === 'checkout.session.completed' && env.ENTITLEMENTS) {
    const s = event.data.object, wallet = s.metadata?.wallet;
    if (validWallet(wallet)) await topup(env, wallet, Math.round((s.amount_total || 0) / 100 * TOKENS_PER_USD), s.id);
  }
  return json({ received: true });
}

async function lemonWebhook(request, env) {
  if (!env.LEMONSQUEEZY_WEBHOOK_SECRET) return json({ error: 'webhook_not_configured' }, 503);
  const payload = await request.text();
  const sig = request.headers.get('x-signature') || '';
  if (!timingEq(await hmacHex(env.LEMONSQUEEZY_WEBHOOK_SECRET, payload), sig)) return json({ error: 'invalid_signature' }, 400);
  const event = JSON.parse(payload);
  const name = event?.meta?.event_name;
  if ((name === 'order_created' || name === 'order_paid') && env.ENTITLEMENTS) {
    const attr = event?.data?.attributes || {};
    const wallet = event?.meta?.custom_data?.wallet;
    const paid = attr.status === 'paid' || name === 'order_paid';
    const cents = attr.total || attr.total_usd || 0; // LS 金额单位为分
    if (paid && validWallet(wallet)) await topup(env, wallet, Math.round(cents / 100 * TOKENS_PER_USD), String(event?.data?.id || ''));
  }
  return json({ received: true });
}

// ---------- 钱包查询/计量 ----------
async function getBalance(url, env) {
  if (!env.ENTITLEMENTS) return json({ error: 'kv_unavailable' }, 503);
  const code = url.searchParams.get('code');
  if (!validWallet(code)) return json({ error: 'bad_code' }, 400);
  const raw = await env.ENTITLEMENTS.get(`ent:${code}`);
  if (!raw) return json({ status: 'empty', code, remaining: 0, tokens: 0 });
  const e = JSON.parse(raw);
  return json({ status: 'active', code: e.code, remaining: e.remaining, tokens: e.tokens });
}
async function redeemTokens(request, env) {
  if (!env.ENTITLEMENTS) return json({ error: 'kv_unavailable' }, 503);
  const body = await readJson(request);
  const code = String(body?.code || ''), cost = Math.max(0, parseInt(body?.tokens, 10) || 0);
  if (!validWallet(code) || !cost) return json({ error: 'bad_request' }, 400);
  const raw = await env.ENTITLEMENTS.get(`ent:${code}`);
  if (!raw) return json({ error: 'not_found' }, 404);
  const e = JSON.parse(raw);
  if (e.remaining < cost) return json({ error: 'insufficient_tokens', remaining: e.remaining }, 402);
  e.remaining -= cost; await env.ENTITLEMENTS.put(`ent:${code}`, JSON.stringify(e));
  return json({ code: e.code, spent: cost, remaining: e.remaining });
}
// 社区积分 → 充进钱包
async function redeemPoints(request, env) {
  if (!env.ENTITLEMENTS) return json({ error: 'kv_unavailable' }, 503);
  const body = await readJson(request);
  const pointsCode = String(body?.pointsCode || ''), points = Math.max(0, parseInt(body?.points, 10) || 0), wallet = body?.wallet;
  if (!pointsCode || !points || !validWallet(wallet)) return json({ error: 'bad_request' }, 400);
  const raw = await env.ENTITLEMENTS.get(`points:${pointsCode}`);
  const bal = raw ? parseInt(raw, 10) || 0 : 0;
  if (bal < points) return json({ error: 'insufficient_points', balance: bal }, 402);
  await env.ENTITLEMENTS.put(`points:${pointsCode}`, String(bal - points));
  const e = await topup(env, wallet, points * TOKENS_PER_POINT, `points:${pointsCode}:${Date.now()}`);
  return json({ code: e.code, tokens: e.tokens, remaining: e.remaining, pointsRemaining: bal - points });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url), p = url.pathname, m = request.method;
    if (p === '/api/checkout' && m === 'POST') return createCheckout(request, env);
    if (p === '/api/stripe-webhook' && m === 'POST') return stripeWebhook(request, env);
    if (p === '/api/lemonsqueezy-webhook' && m === 'POST') return lemonWebhook(request, env);
    if (p === '/api/balance' && m === 'GET') return getBalance(url, env);
    if (p === '/api/redeem' && m === 'POST') return redeemTokens(request, env);
    if (p === '/api/points/redeem' && m === 'POST') return redeemPoints(request, env);
    if (p === '/api/config' && m === 'GET') return json({ provider: provider(env), tokensPerUsd: TOKENS_PER_USD, presets: PRESETS, min: MIN_USD, max: MAX_USD });
    if (p.startsWith('/api/')) return json({ error: 'not_found' }, 404);
    return env.ASSETS.fetch(request);
  },
};
