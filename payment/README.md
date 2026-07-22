# iDoris 支付集成

一处搞定所有支付：卖【充值包】→ 充进 **token 钱包** → 玩卡从钱包扣 token。
后端在 `site/_worker.js`（Cloudflare Pages Worker），前端在 `site/buy.html`（`/buy`）。

## 已选方案

- **全球主渠道 → Lemon Squeezy（Merchant-of-Record）** —— 个人可开、替你处理全球税、最省心。已选。
- **清迈本地 → PromptPay**（泰国 QR，最便宜）—— 后续接 Omise/2C2P。
- **国内 / 引流 → 社区积分**（0 费率）—— 积分在另一个仓库发放，这里只做「积分→钱包」兑换。
- **Stripe** —— 备选（% 更低但税自理）。代码已内置，配了 key 即用。

## 费率 & 简单度对比（近似，用前确认最新）

| 方案 | 费率 | 谁收/税务 | 简单度 | 适合 |
|---|---|---|---|---|
| **Stripe** | ~2.9–3.65% + ฿10/$0.30 | 你自己报全球税(VAT等) | 中（个人可开，税务自管）| 全球，% 最低但税自理 |
| **Lemon Squeezy**(MoR) | ~5% + $0.50 | 它替你收全球税 | **最简单**（个人即可，零税务）| 全球数字商品、单干 ✅选 |
| **Paddle**(MoR) | ~5% + $0.50 | 它替你收税 | 简单（审核稍严）| 同上 |
| **PromptPay**(泰国 Omise/2C2P) | 极低/近乎持平，本地 QR | 需泰国实体 | 本地简单、全球弱 | 清迈本地最便宜 |
| **社区积分**（已建）| 0 费率 | 无 | 已就绪 | 国内 / 熟人 / 引流 |

> ⚠️ **关键**：单张 ¥10/$1.5 直接刷卡，固定手续费($0.30–0.50)会吃掉 20–35%。**所以卖充值包，不卖单张。** 已按此改。

## 架构（provider 无关 + 钱包码）

```
/buy 选金额($5/20/50/100/自定义)
  → 前端生成/复用 wallet 码(存 localStorage)
  → POST /api/checkout {amountUsd, wallet}
  → 后端按配置选支付商建结账(Lemon Squeezy 优先，否则 Stripe)，把 wallet 带进去
  → 用户在支付商页付款
  → 支付商 webhook → 验签 → 按【实付金额】把 token 充进 ent:<wallet>(累加, 幂等)
  → /buy 成功页 poll /api/balance?code=<wallet> 显示余额
玩卡：POST /api/redeem {code:wallet, tokens} 扣费
```

- **核心是 `topup(env, code, tokens, orderKey)`**：任何来源（LS / Stripe / 积分）都汇入同一个钱包函数，天然「一把搞定所有支付」。
- **加新支付渠道**只需两件事：① 一个建结账的分支（带上 wallet）；② 一个 webhook 验签后调 `topup()`。PromptPay/微信/别的仓库的积分都照此接。
- **社区积分（另一仓库）**：那边发放积分到 KV `points:<code>`；用户在这里 `POST /api/points/redeem {pointsCode, points, wallet}` 把积分换成钱包 token。两个仓库通过同一个 KV/或一个内部 API 打通即可。

## API

| 端点 | 说明 |
|---|---|
| `POST /api/checkout` `{amountUsd, wallet}` | 建结账，返回 `{url}` 跳转付款 |
| `POST /api/lemonsqueezy-webhook` | LS 履约（验 X-Signature）→ topup |
| `POST /api/stripe-webhook` | Stripe 履约（验 Stripe-Signature）→ topup |
| `GET  /api/balance?code=<wallet>` | 查钱包余额 |
| `POST /api/redeem` `{code, tokens}` | 玩卡扣 token |
| `POST /api/points/redeem` `{pointsCode, points, wallet}` | 社区积分 → 钱包 |
| `GET  /api/config` | 当前 provider、汇率、预设 |

汇率：`TOKENS_PER_USD=30000`、`TOKENS_PER_POINT=300`（在 `_worker.js` 顶部调）。

## 开通 Lemon Squeezy（一次性）

1. 注册 lemonsqueezy.com（个人即可），建一个 Store。
2. 建一个 Product + 一个 Variant（价格随意，会被 `custom_price` 覆盖）；记下 **store id** 和 **variant id**。
3. Settings → API → 建一个 **API key**。
4. Settings → Webhooks → 新建，URL 填 `https://idoris.ai/api/lemonsqueezy-webhook`，事件勾 `order_created`（和 `order_paid`），记下 **signing secret**。
5. 把 4 个值设为 Pages secret：
   ```bash
   for k in LEMONSQUEEZY_API_KEY LEMONSQUEEZY_STORE_ID LEMONSQUEEZY_VARIANT_ID LEMONSQUEEZY_WEBHOOK_SECRET; do
     echo "<值>" | npx wrangler pages secret put $k --project-name=idoris-website; done
   ```
6. `./scripts/deploy.sh`，打开 `/buy` 用测试模式走一遍。

> 未配任何支付商时，`/api/checkout` 返回 503，`/buy` 提示"支付即将开通"，不报错崩溃 —— 先部署后配 key 是安全的。
> Stripe 备选：设 `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` 即启用（LS 优先）。
