// iDoris — Cloudflare Pages 高级模式 Worker
// 只拦截 /api/*（Stripe 结账 + webhook + 履约查询），其余回落静态资源 env.ASSETS。
// 不引 Stripe SDK：fetch 调 Stripe REST API，Web Crypto 验 webhook 签名。
// 绑定 / secret：
//   ENTITLEMENTS           —— KV，存购买履约（卡数 + token 额度 + 兑换码）
//   STRIPE_SECRET_KEY      —— Stripe 密钥（sk_test_.../sk_live_...）
//   STRIPE_WEBHOOK_SECRET  —— webhook 签名密钥（whsec_...）
// 金额一律服务端定价（CATALOG），客户端只传 sku。

const TOKENS_PER_CARD = 40000; // 一张卡的 token 额度（够 3–4 个实验，MVP 单位，可调）
const CATALOG = {
  card:   { name: 'AI 体验卡 · 单张',   amount: 150,  currency: 'usd', cards: 1 },
  pack5:  { name: 'AI 体验卡 · 5 张包',  amount: 650,  currency: 'usd', cards: 5 },
  pack10: { name: 'AI 体验卡 · 10 张包', amount: 1200, currency: 'usd', cards: 10 },
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

async function createCheckout(request, env) {
  if (!env.STRIPE_SECRET_KEY)
    return json({ error: 'stripe_not_configured', message: 'STRIPE_SECRET_KEY 未设置，请按 docs/stripe-setup.md 配置后再试。' }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }
  const item = CATALOG[String(body.sku || '')];
  if (!item) return json({ error: 'unknown_sku', message: `未知商品：${body.sku}` }, 400);
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

// 验证 Stripe webhook 签名：`t=时间戳,v1=签名`，HMAC-SHA256(`${t}.${body}`)。
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

// 履约：把这次购买写进 KV（幂等：按 session id 去重），生成兑换码。
async function grant(env, session) {
  if (!env.ENTITLEMENTS) { console.log('no ENTITLEMENTS KV bound; skip grant', session.id); return; }
  const existing = await env.ENTITLEMENTS.get(`sess:${session.id}`);
  if (existing) return; // 已履约，幂等
  const item = CATALOG[session.metadata?.sku] || CATALOG.card;
  const cards = item.cards;
  const tokens = cards * TOKENS_PER_CARD;
  const code = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const entitlement = {
    code, sku: session.metadata?.sku, cards, tokens, remaining: tokens,
    email: session.customer_details?.email || null,
    sessionId: session.id, amountTotal: session.amount_total, currency: session.currency,
    created: Date.now(), status: 'active',
  };
  await env.ENTITLEMENTS.put(`ent:${code}`, JSON.stringify(entitlement));
  await env.ENTITLEMENTS.put(`sess:${session.id}`, code);
}

async function handleWebhook(request, env) {
  if (!env.STRIPE_WEBHOOK_SECRET) return json({ error: 'webhook_not_configured' }, 503);
  const payload = await request.text();
  const ok = await verifySignature(payload, request.headers.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET);
  if (!ok) return json({ error: 'invalid_signature' }, 400);
  let event;
  try { event = JSON.parse(payload); } catch { return json({ error: 'bad_json' }, 400); }
  if (event.type === 'checkout.session.completed') {
    await grant(env, event.data.object);
    // 社区积分购买后续：在这里对同一 grant 逻辑加一条积分扣减来源分支。
  }
  return json({ received: true });
}

// 成功页据 session_id 查履约结果（token 发放可能比跳转晚几秒，故返回 pending 让前端轮询）。
async function lookupEntitlement(url, env) {
  const sid = url.searchParams.get('session_id');
  if (!sid) return json({ error: 'missing_session_id' }, 400);
  if (!env.ENTITLEMENTS) return json({ status: 'pending' });
  const code = await env.ENTITLEMENTS.get(`sess:${sid}`);
  if (!code) return json({ status: 'pending' });
  const raw = await env.ENTITLEMENTS.get(`ent:${code}`);
  if (!raw) return json({ status: 'pending' });
  const e = JSON.parse(raw);
  return json({ status: 'active', code: e.code, cards: e.cards, tokens: e.tokens }); // 只回非敏感字段
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/checkout' && request.method === 'POST') return createCheckout(request, env);
    if (url.pathname === '/api/stripe-webhook' && request.method === 'POST') return handleWebhook(request, env);
    if (url.pathname === '/api/entitlement' && request.method === 'GET') return lookupEntitlement(url, env);
    if (url.pathname.startsWith('/api/')) return json({ error: 'not_found' }, 404);
    return env.ASSETS.fetch(request);
  },
};
