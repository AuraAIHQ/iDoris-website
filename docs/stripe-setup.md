# Stripe 接入说明（iDoris 体验卡）

支付后端已内置在 `site/_worker.js`（Cloudflare Pages 高级模式 Worker），购买页是 `site/buy.html`（路由 `/buy`）。代码不引 Stripe SDK，直接调 Stripe REST API，用 Web Crypto 验 webhook 签名。**只差你的密钥就能开通。**

## 架构

- `POST /api/checkout` —— 收到 `{sku, quantity}`，服务端按 `_worker.js` 里的 `CATALOG` 定价（客户端金额一律不信任），创建 Stripe Checkout Session，返回 `{url}`，前端跳转过去付款。
- `POST /api/stripe-webhook` —— 验证签名后处理 `checkout.session.completed`，**这里是履约点**（发 token / 交付卡 / 记社区积分，目前是 TODO+日志）。
- 商品 SKU：`card`（$1.50）、`pack5`（$6.50）、`pack10`（$12）。改价改品在 `CATALOG` 里改（`amount` 单位是「分」，`currency` 可改 `thb`/`usd` 等）。

## 一次性开通步骤

1. 注册 / 登录 Stripe，先用 **测试模式**（Test mode）。
2. 拿到 **Secret key**（`sk_test_...`）：Developers → API keys。
3. 在项目根目录设置线上密钥（项目名 `idoris-website`）：
   ```bash
   echo "sk_test_xxx" | npx wrangler pages secret put STRIPE_SECRET_KEY --project-name=idoris-website
   ```
4. 建 webhook：Developers → Webhooks → Add endpoint，URL 填
   `https://idoris.ai/api/stripe-webhook`，事件选 `checkout.session.completed`。
5. 拿到该 endpoint 的 **Signing secret**（`whsec_...`）并设置：
   ```bash
   echo "whsec_xxx" | npx wrangler pages secret put STRIPE_WEBHOOK_SECRET --project-name=idoris-website
   ```
6. 重新部署：`./scripts/deploy.sh`。打开 `/buy`，用测试卡 `4242 4242 4242 4242`（任意未来日期 + 任意 CVC）走一遍。
7. 验证无误后，把 Stripe 切到 **Live mode**，用 `sk_live_...` / `whsec_...`（live）重复 3–5 步。

## 本地开发

```bash
cp .dev.vars.example .dev.vars   # 填入 sk_test_.../whsec_...（.dev.vars 不会提交）
npx wrangler pages dev site      # 起本地，含 _worker.js 与静态资源
# 测 webhook 可用 Stripe CLI： stripe listen --forward-to localhost:8788/api/stripe-webhook
```

## 说明

- 未设 `STRIPE_SECRET_KEY` 时，`/api/checkout` 返回 503，购买页会提示「支付即将开通」，不会报错崩溃 —— 所以先部署、后配密钥是安全的。
- **社区积分购买**：后续在 `/api/checkout` 增加一条积分扣减分支，或单开 `/api/redeem`；履约同样走 webhook 那个 TODO 点。
- 履约（发 token / 记积分）需要存储：给 Pages 项目绑一个 KV 或 D1，然后在 `_worker.js` 的 `checkout.session.completed` 分支里写入。
