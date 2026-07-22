// iDoris — Cloudflare Pages 高级模式 Worker
// 支付模型：不做在线卡支付。两条路 →（1）线下收款后【管理员直接给钱包上余额】；（2）线上【社区积分】兑换。
// 都汇入同一个 token 钱包 topup()。玩卡从钱包扣 token。
// 绑定/secret：ENTITLEMENTS(KV)、ADMIN_SECRET（管理员上余额用）。
// 端点：
//   POST /api/admin/grant   {wallet, tokens}   header x-admin-secret  → 给钱包充 token（线下收款后用）
//   POST /api/points/redeem {pointsCode, points, wallet}              → 社区积分 → 钱包
//   GET  /api/balance?code=<wallet>                                    → 查余额
//   POST /api/redeem        {code, tokens}                            → 玩卡扣 token
//   GET  /api/config                                                   → 汇率/模式

const TOKENS_PER_USD = 30000;   // 线下定价参考：折算多少 token/美元（¥/฿ 换算后据此上余额）
const TOKENS_PER_POINT = 300;   // 1 社区积分 = 多少 token
const IMAGE_COST = 3000;        // 自建出图 playground：每张图扣多少 token（可调；GPU 实际成本远低于此）

const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json; charset=utf-8' } });
const readJson = async (r) => { try { return await r.json(); } catch { return null; } };
const validWallet = (w) => typeof w === 'string' && /^[a-f0-9]{12,40}$/.test(w);
function timingEq(a, b) { a = String(a); b = String(b); if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }

// 钱包充值累加（幂等按 orderKey，可选）
async function topup(env, code, tokens, orderKey) {
  if (orderKey) { const seen = await env.ENTITLEMENTS.get(`order:${orderKey}`); if (seen) return JSON.parse(await env.ENTITLEMENTS.get(`ent:${code}`) || 'null'); }
  const raw = await env.ENTITLEMENTS.get(`ent:${code}`);
  let e = raw ? JSON.parse(raw) : { code, tokens: 0, remaining: 0, created: Date.now(), status: 'active' };
  e.tokens += tokens; e.remaining += tokens; e.updated = Date.now();
  await env.ENTITLEMENTS.put(`ent:${code}`, JSON.stringify(e));
  if (orderKey) await env.ENTITLEMENTS.put(`order:${orderKey}`, code, { expirationTtl: 60 * 60 * 24 * 365 });
  return e;
}

// 管理员：线下收款后直接给钱包上余额
async function adminGrant(request, env) {
  if (!env.ADMIN_SECRET) return json({ error: 'admin_not_configured' }, 503);
  if (!timingEq(request.headers.get('x-admin-secret') || '', env.ADMIN_SECRET)) return json({ error: 'unauthorized' }, 401);
  if (!env.ENTITLEMENTS) return json({ error: 'kv_unavailable' }, 503);
  const body = await readJson(request);
  const wallet = body?.wallet, tokens = Math.round(Number(body?.tokens) || 0);
  if (!validWallet(wallet) || !(tokens > 0 && tokens <= 100000000)) return json({ error: 'bad_request', message: 'wallet(12-40 hex) + tokens(1..1e8)' }, 400);
  const e = await topup(env, wallet, tokens, body?.orderKey ? String(body.orderKey) : null);
  return json({ ok: true, code: e.code, tokens: e.tokens, remaining: e.remaining });
}

// 社区积分 → 钱包（积分由另一个仓库发放到 KV points:<code>）
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
  return json({ ok: true, code: e.code, tokens: e.tokens, remaining: e.remaining, pointsRemaining: bal - points });
}

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

// 自建出图 playground：查钱包 → 调 Modal endpoint 出图 → 成功才扣 token（计量）
async function play(request, env) {
  if (!env.ENTITLEMENTS) return json({ error: 'kv_unavailable' }, 503);
  if (!env.MODAL_PLAY_URL || !env.PLAY_TOKEN) return json({ error: 'play_not_configured' }, 503);
  const body = await readJson(request);
  const code = String(body?.code || ''), prompt = String(body?.prompt || '').slice(0, 400);
  if (!validWallet(code)) return json({ error: 'bad_code' }, 400);
  const raw = await env.ENTITLEMENTS.get(`ent:${code}`);
  if (!raw) return json({ error: 'no_wallet', message: '钱包为空，先充值' }, 404);
  const e = JSON.parse(raw);
  if (e.remaining < IMAGE_COST) return json({ error: 'insufficient_tokens', remaining: e.remaining, need: IMAGE_COST }, 402);
  let r;
  try { r = await fetch(env.MODAL_PLAY_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: env.PLAY_TOKEN, prompt }) }); }
  catch (err) { return json({ error: 'upstream_unreachable' }, 502); }
  const d = await r.json().catch(() => null);
  if (!r.ok || !d?.image) return json({ error: 'gen_failed', detail: d?.error }, 502);
  e.remaining -= IMAGE_COST; await env.ENTITLEMENTS.put(`ent:${code}`, JSON.stringify(e)); // 成功才扣
  return json({ image: d.image, spent: IMAGE_COST, remaining: e.remaining, gpu_sec: d.gpu_sec });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url), p = url.pathname, m = request.method;
    if (p === '/api/play' && m === 'POST') return play(request, env);
    if (p === '/api/admin/grant' && m === 'POST') return adminGrant(request, env);
    if (p === '/api/points/redeem' && m === 'POST') return redeemPoints(request, env);
    if (p === '/api/balance' && m === 'GET') return getBalance(url, env);
    if (p === '/api/redeem' && m === 'POST') return redeemTokens(request, env);
    if (p === '/api/config' && m === 'GET') return json({ mode: 'offline+points', tokensPerUsd: TOKENS_PER_USD, tokensPerPoint: TOKENS_PER_POINT, imageCost: IMAGE_COST, play: !!(env.MODAL_PLAY_URL && env.PLAY_TOKEN) });
    if (p.startsWith('/api/')) return json({ error: 'not_found' }, 404);
    return env.ASSETS.fetch(request);
  },
};
