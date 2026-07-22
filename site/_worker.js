// iDoris — Cloudflare Pages 高级模式 Worker
// 货币单位：积分(credit) = token，1:1，1 积分 = $0.02。钱包 ent:<wallet> 存积分余额。
// 充值只在本地做（scripts/topup.sh 直接写 KV，走你的 wrangler 凭证；不开公网充值接口）。
// 在线只保留：社区积分兑换（扣积分不涉及钱）、余额查询、玩卡扣费、自建出图。
// 绑定/secret：ENTITLEMENTS(KV)、PLAY_TOKEN + MODAL_PLAY_URL（自建出图 endpoint）。

const USD_PER_CREDIT = 0.02;    // 1 积分 = $0.02（= 50 积分/美元）
const POINTS_PER_CREDIT = 1;    // 社区积分 : 积分 = 1:1

// ===== 计价 / 计量逻辑（改这里就好，别把系数散进各处 handler）=====
// 规则：按【实际消耗】折成本 × 倍率，向上取整，且不低于底线；底线保证复杂/长任务不亏。
const PRICING = {
  floorCredits: 2,          // 底线：任何一次生成最少扣 2 积分
  markup: 2,                // 实际成本 ×2
  usdPerGpuSec: 0.000306,   // A10G 参考单价（把 gpu_sec 折成美元成本）
  coeff: { image: 1 },      // 特殊系数：某类调高就改这里（如以后 video: 3）
};
// 消耗(美元) → 应扣积分 = max(底线, ceil(成本 × 倍率 × 系数 / 单价))
function creditsForUsd(usdCost, kind) {
  const coeff = PRICING.coeff[kind] || 1;
  const c = Math.ceil((usdCost * PRICING.markup * coeff) / USD_PER_CREDIT) || 0;
  return Math.max(PRICING.floorCredits, c);
}

const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json; charset=utf-8' } });
const readJson = async (r) => { try { return await r.json(); } catch { return null; } };
const validWallet = (w) => typeof w === 'string' && /^[a-f0-9]{12,40}$/.test(w);

// 钱包累加（幂等按 orderKey，可选）—— 内部字段沿用 tokens/remaining，语义即积分
async function topup(env, code, credits, orderKey) {
  if (orderKey) { const seen = await env.ENTITLEMENTS.get(`order:${orderKey}`); if (seen) return JSON.parse(await env.ENTITLEMENTS.get(`ent:${code}`) || 'null'); }
  const raw = await env.ENTITLEMENTS.get(`ent:${code}`);
  let e = raw ? JSON.parse(raw) : { code, tokens: 0, remaining: 0, created: Date.now(), status: 'active' };
  e.tokens += credits; e.remaining += credits; e.updated = Date.now();
  await env.ENTITLEMENTS.put(`ent:${code}`, JSON.stringify(e));
  if (orderKey) await env.ENTITLEMENTS.put(`order:${orderKey}`, code, { expirationTtl: 60 * 60 * 24 * 365 });
  return e;
}

// 社区积分 → 钱包积分（积分由另一仓库发放到 KV points:<code>）；在线，只动积分不涉及钱
async function redeemPoints(request, env) {
  if (!env.ENTITLEMENTS) return json({ error: 'kv_unavailable' }, 503);
  const body = await readJson(request);
  const pointsCode = String(body?.pointsCode || ''), points = Math.max(0, parseInt(body?.points, 10) || 0), wallet = body?.wallet;
  if (!pointsCode || !points || !validWallet(wallet)) return json({ error: 'bad_request' }, 400);
  const raw = await env.ENTITLEMENTS.get(`points:${pointsCode}`);
  const bal = raw ? parseInt(raw, 10) || 0 : 0;
  if (bal < points) return json({ error: 'insufficient_points', balance: bal }, 402);
  await env.ENTITLEMENTS.put(`points:${pointsCode}`, String(bal - points));
  const e = await topup(env, wallet, points * POINTS_PER_CREDIT, `points:${pointsCode}:${Date.now()}`);
  return json({ ok: true, code: e.code, credits: e.remaining, remaining: e.remaining, pointsRemaining: bal - points });
}

async function getBalance(url, env) {
  if (!env.ENTITLEMENTS) return json({ error: 'kv_unavailable' }, 503);
  const code = url.searchParams.get('code');
  if (!validWallet(code)) return json({ error: 'bad_code' }, 400);
  const raw = await env.ENTITLEMENTS.get(`ent:${code}`);
  if (!raw) return json({ status: 'empty', code, remaining: 0 });
  const e = JSON.parse(raw);
  return json({ status: 'active', code: e.code, remaining: e.remaining });
}

// 玩卡扣积分
async function redeemCredits(request, env) {
  if (!env.ENTITLEMENTS) return json({ error: 'kv_unavailable' }, 503);
  const body = await readJson(request);
  const code = String(body?.code || ''), cost = Math.max(0, parseInt(body?.credits ?? body?.tokens, 10) || 0);
  if (!validWallet(code) || !cost) return json({ error: 'bad_request' }, 400);
  const raw = await env.ENTITLEMENTS.get(`ent:${code}`);
  if (!raw) return json({ error: 'not_found' }, 404);
  const e = JSON.parse(raw);
  if (e.remaining < cost) return json({ error: 'insufficient', remaining: e.remaining }, 402);
  e.remaining -= cost; await env.ENTITLEMENTS.put(`ent:${code}`, JSON.stringify(e));
  return json({ code: e.code, spent: cost, remaining: e.remaining });
}

// 自建出图：查钱包 → 调 Modal endpoint 出图 → 成功才扣积分
async function play(request, env) {
  if (!env.ENTITLEMENTS) return json({ error: 'kv_unavailable' }, 503);
  if (!env.MODAL_PLAY_URL || !env.PLAY_TOKEN) return json({ error: 'play_not_configured' }, 503);
  const body = await readJson(request);
  const code = String(body?.code || ''), prompt = String(body?.prompt || '').slice(0, 400);
  if (!validWallet(code)) return json({ error: 'bad_code' }, 400);
  const raw = await env.ENTITLEMENTS.get(`ent:${code}`);
  if (!raw) return json({ error: 'no_wallet', message: '钱包为空，先充值' }, 404);
  const e = JSON.parse(raw);
  if (e.remaining < PRICING.floorCredits) return json({ error: 'insufficient', remaining: e.remaining, need: PRICING.floorCredits }, 402);
  let r;
  try { r = await fetch(env.MODAL_PLAY_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: env.PLAY_TOKEN, prompt }) }); }
  catch (err) { return json({ error: 'upstream_unreachable' }, 502); }
  const d = await r.json().catch(() => null);
  if (!r.ok || !d?.image) return json({ error: 'gen_failed', detail: d?.error }, 502);
  // 成功才扣：按实际 gpu 消耗折算积分（≥底线），余额不足则扣光
  const usdCost = (Number(d.gpu_sec) || 0) * PRICING.usdPerGpuSec;
  const cost = creditsForUsd(usdCost, 'image');
  const spent = Math.min(e.remaining, cost);
  e.remaining -= spent; await env.ENTITLEMENTS.put(`ent:${code}`, JSON.stringify(e));
  return json({ image: d.image, spent, remaining: e.remaining, gpu_sec: d.gpu_sec });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url), p = url.pathname, m = request.method;
    if (p === '/api/play' && m === 'POST') return play(request, env);
    if (p === '/api/points/redeem' && m === 'POST') return redeemPoints(request, env);
    if (p === '/api/balance' && m === 'GET') return getBalance(url, env);
    if (p === '/api/redeem' && m === 'POST') return redeemCredits(request, env);
    if (p === '/api/config' && m === 'GET') return json({ mode: 'offline+points', usdPerCredit: USD_PER_CREDIT, pointsPerCredit: POINTS_PER_CREDIT, floorCredits: PRICING.floorCredits, markup: PRICING.markup, play: !!(env.MODAL_PLAY_URL && env.PLAY_TOKEN) });
    if (p.startsWith('/api/')) return json({ error: 'not_found' }, 404);
    return env.ASSETS.fetch(request);
  },
};
