// iDoris — Cloudflare Pages 高级模式 Worker
// 拦截 /api/*（Stripe 结账 + webhook + 履约/计量/积分），其余回落静态 env.ASSETS。
// 不引 SDK：fetch 调 Stripe REST，Web Crypto 验签。
// 绑定 / secret：
//   ENTITLEMENTS           —— KV，存履约（token 额度 + 兑换码）与社区积分
//   STRIPE_SECRET_KEY      —— Stripe 密钥
//   STRIPE_WEBHOOK_SECRET  —— webhook 签名密钥
// 金额一律服务端定价（CATALOG），客户端只传 sku。

const TOKENS_PER_CARD = 40000;   // 一张卡的 token 额度
const POINTS_PER_CARD = 100;     // 用社区积分兑换一张卡的价格
const CATALOG = {
  card:   { name: 'AI 体验卡 · 单张',   amount: 150,  currency: 'usd', cards: 1 },
  pack5:  { name: 'AI 体验卡 · 5 张包',  amount: 650,  currency: 'usd', cards: 5 },
  pack10: { name: 'AI 体验卡 · 10 张包', amount: 1200, currency: 'usd', cards: 10 },
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

async function readJson(request) { try { return await request.json(); } catch { return null; } }

// ---------- Stripe 结账 ----------
async function createCheckout(request, env) {
  if (!env.STRIPE_SECRET_KEY)
    return json({ error: 'stripe_not_configured', message: 'STRIPE_SECRET_KEY 未设置，见 docs/stripe-setup.md。' }, 503);
  const body = await readJson(request);
  const item = CATALOG[String(body?.sku || '')];
  if (!item) return json({ error: 'unknown_sku', message: `未知商品：${body?.sku}` }, 400);
  const origin = new URL(request.url).origin;
  const form = new URLSearchParams();
  form.set('mode', 'payment');
  form.set('line_items[0][price_data][currency]', item.currency);
  form.set('line_items[0][price_data][product_data][name]', item.name);
  form.set('line_items[0][price_data][unit_amount]', String(item.amount));
  form.set('line_items[0][quantity]', '1');
  form.set('success_url', `${origin}/buy?status=success&session_id={CHECKOUT_SESSION_ID}`);
  form.set('cancel_url', `${origin}/buy?status=cancel`);
  form.set('metadata[sku]', body.sku);
  const resp = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  const data = await resp.json();
  if (!resp.ok) return json({ error: 'stripe_error', message: data?.error?.message || 'Stripe 创建会话失败' }, 502);
  return json({ url: data.url });
}

async function verifySignature(payload, sigHeader, secret) {
  if (!sigHeader) return false;
  const parts = Object.fromEntries(sigHeader.split(',').map((kv) => kv.split('=')));
  const { t, v1 } = parts;
  if (!t || !v1) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(t)) > 300) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${payload}`));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (expected.length !== v1.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ v1.charCodeAt(i);
  return diff === 0;
}

// ---------- 履约：发放一份体验卡额度（Stripe 或积分都走这里）----------
async function grantEntitlement(env, { sku, source, sessionId, email, amountTotal, currency }) {
  const item = CATALOG[sku] || CATALOG.card;
  const cards = item.cards;
  const tokens = cards * TOKENS_PER_CARD;
  const code = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const ent = {
    code, sku, source, cards, tokens, remaining: tokens, email: email || null,
    sessionId: sessionId || null, amountTotal: amountTotal ?? null, currency: currency || null,
    created: Date.now(), status: 'active',
  };
  await env.ENTITLEMENTS.put(`ent:${code}`, JSON.stringify(ent));
  if (sessionId) await env.ENTITLEMENTS.put(`sess:${sessionId}`, code);
  return ent;
}

async function handleWebhook(request, env) {
  if (!env.STRIPE_WEBHOOK_SECRET) return json({ error: 'webhook_not_configured' }, 503);
  const payload = await request.text();
  const ok = await verifySignature(payload, request.headers.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET);
  if (!ok) return json({ error: 'invalid_signature' }, 400);
  let event;
  try { event = JSON.parse(payload); } catch { return json({ error: 'bad_json' }, 400); }
  if (event.type === 'checkout.session.completed' && env.ENTITLEMENTS) {
    const s = event.data.object;
    if (!(await env.ENTITLEMENTS.get(`sess:${s.id}`))) { // 幂等
      await grantEntitlement(env, {
        sku: s.metadata?.sku, source: 'stripe', sessionId: s.id,
        email: s.customer_details?.email, amountTotal: s.amount_total, currency: s.currency,
      });
    }
  }
  return json({ received: true });
}

// ---------- 履约查询（成功页轮询）----------
async function lookupEntitlement(url, env) {
  const sid = url.searchParams.get('session_id');
  if (!sid) return json({ error: 'missing_session_id' }, 400);
  if (!env.ENTITLEMENTS) return json({ status: 'pending' });
  const code = await env.ENTITLEMENTS.get(`sess:${sid}`);
  if (!code) return json({ status: 'pending' });
  const raw = await env.ENTITLEMENTS.get(`ent:${code}`);
  if (!raw) return json({ status: 'pending' });
  const e = JSON.parse(raw);
  return json({ status: 'active', code: e.code, cards: e.cards, tokens: e.tokens });
}

// ---------- token 计量 ----------
async function getBalance(url, env) {
  if (!env.ENTITLEMENTS) return json({ error: 'kv_unavailable' }, 503);
  const code = url.searchParams.get('code');
  if (!code) return json({ error: 'missing_code' }, 400);
  const raw = await env.ENTITLEMENTS.get(`ent:${code}`);
  if (!raw) return json({ error: 'not_found' }, 404);
  const e = JSON.parse(raw);
  return json({ code: e.code, remaining: e.remaining, tokens: e.tokens, cards: e.cards, status: e.status });
}

// 复现/跑实验时扣 token：{code, tokens}
async function redeemTokens(request, env) {
  if (!env.ENTITLEMENTS) return json({ error: 'kv_unavailable' }, 503);
  const body = await readJson(request);
  const code = String(body?.code || '');
  const cost = Math.max(0, parseInt(body?.tokens, 10) || 0);
  if (!code || !cost) return json({ error: 'bad_request' }, 400);
  const raw = await env.ENTITLEMENTS.get(`ent:${code}`);
  if (!raw) return json({ error: 'not_found' }, 404);
  const e = JSON.parse(raw);
  if (e.remaining < cost) return json({ error: 'insufficient_tokens', remaining: e.remaining }, 402);
  e.remaining -= cost;
  await env.ENTITLEMENTS.put(`ent:${code}`, JSON.stringify(e));
  return json({ code: e.code, spent: cost, remaining: e.remaining });
}

// ---------- 社区积分购买：用积分兑换一张卡 ----------
// 积分余额存 KV `points:<pointsCode>`（由社区侧发放，此处只做扣减兑换）。
async function redeemPoints(request, env) {
  if (!env.ENTITLEMENTS) return json({ error: 'kv_unavailable' }, 503);
  const body = await readJson(request);
  const pointsCode = String(body?.pointsCode || '');
  const sku = String(body?.sku || 'card');
  const item = CATALOG[sku];
  if (!pointsCode || !item) return json({ error: 'bad_request' }, 400);
  const cost = item.cards * POINTS_PER_CARD;
  const raw = await env.ENTITLEMENTS.get(`points:${pointsCode}`);
  const balance = raw ? parseInt(raw, 10) || 0 : 0;
  if (balance < cost) return json({ error: 'insufficient_points', balance, cost }, 402);
  await env.ENTITLEMENTS.put(`points:${pointsCode}`, String(balance - cost));
  const ent = await grantEntitlement(env, { sku, source: 'points' });
  return json({ code: ent.code, cards: ent.cards, tokens: ent.tokens, pointsRemaining: balance - cost });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname, m = request.method;
    if (p === '/api/checkout' && m === 'POST') return createCheckout(request, env);
    if (p === '/api/stripe-webhook' && m === 'POST') return handleWebhook(request, env);
    if (p === '/api/entitlement' && m === 'GET') return lookupEntitlement(url, env);
    if (p === '/api/balance' && m === 'GET') return getBalance(url, env);
    if (p === '/api/redeem' && m === 'POST') return redeemTokens(request, env);
    if (p === '/api/points/redeem' && m === 'POST') return redeemPoints(request, env);
    if (p.startsWith('/api/')) return json({ error: 'not_found' }, 404);
    return env.ASSETS.fetch(request);
  },
};
