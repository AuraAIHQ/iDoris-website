# iDoris 支付集成

**核心逻辑先行**：我们卖的不是 token，是"像辅导班一样、给普通人微小台阶和微小成就感、一步步 landing 到 AI"的**引导**。支付只是水管，越简单越好。

## 现行模式：不做在线卡支付。两条路 → 同一个 token 钱包。

- **① 线下收款 → 管理员直接上余额**：清迈 meetup 现场 / PromptPay / 转账收款后，拿用户的**钱包码**在 `/admin` 给他上余额。
- **② 线上社区积分 → 钱包**：积分在**另一个仓库**发放（KV `points:<code>`），用户在 `/buy` 用积分兑换成 token。

> 玩每张卡从钱包扣 token（`/api/redeem`）。钱包码存用户本机 localStorage，余额永久、可累加。

### 为什么放弃在线卡支付 / Lemon Squeezy（决策存档）
- Lemon Squeezy 已**被 Stripe 收购**；且**注册繁琐**（证件照识别不了）。
- 单张 ¥10/$1.5 直接刷卡，固定手续费($0.30–0.50)吃掉 20–35%，本就不划算。
- 面向清迈本地 + 熟人社区，**线下收款 + 社区积分**更简单、零费率、更贴合"引导/辅导班"定位。

## 费率 & 简单度对比（当初调研，存档备查）

| 方案 | 费率 | 谁收/税务 | 简单度 | 适合 |
|---|---|---|---|---|
| Stripe | ~2.9–3.65% + ฿10/$0.30 | 你自己报全球税 | 中 | 全球，% 最低但税自理 |
| Lemon Squeezy(MoR) | ~5% + $0.50 | 它替你收税 | 曾以为最简单，实测注册繁琐 | —（已放弃）|
| Paddle(MoR) | ~5% + $0.50 | 它替你收税 | 简单（审核严）| 备选 |
| **PromptPay/线下** | 极低/近乎零 | 你自己 | **本地最简单** | **清迈本地 ✅** |
| **社区积分** | 0 费率 | 无 | 已就绪 | **国内/熟人/引流 ✅** |

## 架构（provider 无关 + 钱包码）

所有来源（线下管理员 / 社区积分 / 以后任何渠道）都汇入同一个 `topup(env, code, tokens)`。加新渠道 = 加一个"验证来源 + 调 topup()"的分支，天然"一把搞定所有支付"。

```
/buy ：显示你的钱包码 + 余额
  ① 线下：把钱包码给我们 → 管理员在 /admin 上余额
  ② 积分：填积分码+数量 → POST /api/points/redeem → 充进钱包
玩卡：POST /api/redeem {code, tokens} 扣费
```

## API

| 端点 | 说明 |
|---|---|
| `POST /api/admin/grant` `{wallet, tokens}` + header `x-admin-secret` | 管理员给钱包上余额（线下收款后）|
| `POST /api/points/redeem` `{pointsCode, points, wallet}` | 社区积分 → 钱包 |
| `GET  /api/balance?code=<wallet>` | 查余额 |
| `POST /api/redeem` `{code, tokens}` | 玩卡扣 token |
| `GET  /api/config` | 模式/汇率 |

汇率在 `site/_worker.js` 顶部：`TOKENS_PER_USD=30000`、`TOKENS_PER_POINT=300`。

## 开通（一次性）

```bash
# 设管理员密钥（/admin 上余额要用）
echo "一个强密钥" | npx wrangler pages secret put ADMIN_SECRET --project-name=idoris-website
./scripts/deploy.sh
```
- 页面：用户 `/buy`（钱包+积分充值）、管理员 `/admin`（上余额，noindex）。
- **社区积分对接**：另一个仓库把积分写进同一个 KV namespace 的 `points:<code>`（或提供一个内部 API），这里 `/api/points/redeem` 就能扣。
- 未设 `ADMIN_SECRET` 时 `/api/admin/grant` 返回 503；不影响其它。

## 前端展示原则（呼应核心逻辑）
给用户**别显示裸 token**——显示"≈N 次实验 / 1 张图 = X"更有台阶感。钱包/余额是后台账，前台讲的是"你又往前走了一步"。
