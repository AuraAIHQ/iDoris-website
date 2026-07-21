// iDoris — Cloudflare Pages 高级模式 Worker
// 只拦截 /api/*（Stripe 结账 + webhook），其余一律回落到静态资源 env.ASSETS。
// 不引 Stripe SDK：用 fetch 调 Stripe REST API，用 Web Crypto 验 webhook 签名。
// 需要的 secret（用 `wrangler pages secret put` 设置，勿提交）：
//   STRIPE_SECRET_KEY      —— Stripe 密钥（sk_test_... / sk_live_...）
//   STRIPE_WEBHOOK_SECRET  —— webhook 签名密钥（whsec_...）
// 金额一律服务端定价（下方 CATALOG），客户端只传 sku，永不信任客户端金额。

const CATALOG = {
  card:   { name: 'AI 体验卡 · 单张',   amount: 150,  currency: 'usd' },
  pack5:  { name: 'AI 体验卡 · 5 张包',  amount: 650,  currency: 'usd' },
  pack10: { name: 'AI 体验卡 · 10 张包', amount: 1200, currency: 'usd' },
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

async function createCheckout(request, env) {
  if (!env.STRIPE_SECRET_KEY) {
    return json({ error: 'stripe_not_configured', message: 'STRIPE_SECRET_KEY 未设置，请按 docs/stripe-setup.md 配置后再试。' }, 503);
  }
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }
  const item = CATALOG[String(body.sku || '')];
  if (!item) return json({ error: 'unknown_sku', message: `未知商品：${body.sku}` }, 400);
  const qty = Math.min(Math.max(parseInt(body.quantity, 10) || 1, 1), 50);
  const origin = new URL(request.url).origin;

  const form = new URLSearchParams();
  form.set('mode', 'payment');
  form.set('line_items[0][price_data][currency]', item.currency);
  form.set('line_items[0][price_data][product_data][name]', item.name);
  form.set('line_items[0][price_data][unit_amount]', String(item.amount));
  form.set('line_items[0][quantity]', String(qty));
  form.set('success_url', `${origin}/buy?status=success&session_id={CHECKOUT_SESSION_ID}`);
  form.set('cancel_url', `${origin}/buy?status=cancel`);
  form.set('metadata[sku]', body.sku);
  form.set('metadata[qty]', String(qty));

  const resp = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });
  const data = await resp.json();
  if (!resp.ok) return json({ error: 'stripe_error', message: data?.error?.message || 'Stripe 创建会话失败' }, 502);
  return json({ url: data.url });
}

// 验证 Stripe webhook 签名：header 形如 `t=时间戳,v1=签名`，
// 对 `${t}.${原始body}` 做 HMAC-SHA256，与 v1 比对（含时间容差）。
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

async function handleWebhook(request, env) {
  if (!env.STRIPE_WEBHOOK_SECRET) return json({ error: 'webhook_not_configured' }, 503);
  const payload = await request.text();
  const ok = await verifySignature(payload, request.headers.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET);
  if (!ok) return json({ error: 'invalid_signature' }, 400);
  let event;
  try { event = JSON.parse(payload); } catch { return json({ error: 'bad_json' }, 400); }

  if (event.type === 'checkout.session.completed') {
    const s = event.data.object;
    // TODO 履约：发放 token 额度 / 交付体验卡 / 记社区积分。
    // 接 KV 或 D1 后在此写入；社区积分购买后续再接。
    console.log('paid', s.id, s.metadata?.sku, s.metadata?.qty, s.amount_total, s.currency, s.customer_details?.email);
  }
  return json({ received: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/checkout' && request.method === 'POST') return createCheckout(request, env);
    if (url.pathname === '/api/stripe-webhook' && request.method === 'POST') return handleWebhook(request, env);
    if (url.pathname.startsWith('/api/')) return json({ error: 'not_found' }, 404);
    return env.ASSETS.fetch(request); // 其余全部回落到静态资源
  },
};
