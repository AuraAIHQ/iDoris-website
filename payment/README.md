# iDoris 支付集成

**核心逻辑先行**：我们卖的不是 token，是"像辅导班一样、给普通人微小台阶和微小成就感、一步步 landing 到 AI"的**引导**。支付只是水管，越简单越安全越好。

## 货币单位

- **1 积分（credit）= 1 token = $0.02**。钱包 `ent:<wallet>` 存积分余额。
- 玩卡从钱包扣积分（如自建出图 **1 积分/张**）。
- 汇率在 `site/_worker.js` 顶部：`USD_PER_CREDIT=0.02`、`POINTS_PER_CREDIT=1`、`IMAGE_COST=1`。

## 两条充值路，同一个钱包

- **① 线下收款 → 本地脚本上余额**（不开公网接口）：清迈 meetup / PromptPay / 转账收到钱后，在你本机跑 `scripts/topup.sh` 给用户钱包充积分。
- **② 线上社区积分 → 钱包**（`/api/points/redeem`，1:1）：积分在**另一个仓库**发放（KV `points:<code>`），用户在 `/buy` 用积分兑换。只动积分、不涉及钱。

## 安全模型（重要）

- **充值不开任何公网接口**：`scripts/topup.sh` 用你本机的 wrangler/Cloudflare 凭证**直接写 KV**。所以线上**不存任何密钥、也不存哈希，攻击面为 0** —— 比"在线接口 + 存哈希"更安全。
- `IDORIS_ADMIN_SECRET` 只存你本机 `~/Dev/.env`，脚本用它做**本地二次确认**（防别人在你电脑上乱充）。线上一概不存。
- （如果**将来**要"手机随处充值"的在线接口，那才需要：线上存 `SHA-256(secret)`、验证时对输入做 SHA-256 再比对——**别用 MD5**，太弱。目前不需要。）

## 本地充值脚本

```bash
./scripts/topup.sh <钱包码> 250          # 直接加 250 积分
./scripts/topup.sh <钱包码> --usd 5       # 按 $0.02/积分折算（$5 → 250）
./scripts/topup.sh <钱包码> --points 100  # 社区积分 1:1
./scripts/topup.sh <钱包码> --balance     # 只查余额
```
钱包码：用户在 `/buy` 页「复制钱包码」发给你（12–40 位 hex）。脚本会要你输入 `~/Dev/.env` 里的 `IDORIS_ADMIN_SECRET` 确认。

## API（线上仅这些，都不涉及收款）

| 端点 | 说明 |
|---|---|
| `POST /api/points/redeem` `{pointsCode, points, wallet}` | 社区积分 → 钱包（1:1）|
| `GET  /api/balance?code=<wallet>` | 查余额 |
| `POST /api/redeem` `{code, credits}` | 玩卡扣积分 |
| `POST /api/play` `{code, prompt}` | 自建出图：查钱包→调 Modal→扣 1 积分 |
| `GET  /api/config` | 单位/汇率 |

> 已移除公网 `/api/admin/grant` 和 `/admin` 页 —— 充值只在本地。

## 计价 / 计量（按实际消耗，防漏洞亏钱）

单位：1 积分 = $0.02，积分/token/社区积分 1:1，自洽。

**计价规则集中在 `_worker.js` 的 `PRICING` 块 + `creditsForUsd()` 函数里**（别把系数散进各处 handler）：
- `积分 = max(底线, ceil(实际成本 × 倍率 × 系数 / $0.02))`
- **底线 `floorCredits=2`**：任何一次生成最少扣 2 积分（一张复杂/慢的图不会只收 1 积分而亏）。
- **倍率 `markup=2`**：实际成本 ×2。
- **消耗来源**：出图用 Modal 返回的 `gpu_sec × usdPerGpuSec` 折成本；LLM 类用 API 返回的 token 用量折成本 —— 同一个 `creditsForUsd()` 计算。
- **特殊系数 `coeff`**：某类调高就改这里（如以后 `video: 3`）。
- 成功才扣；余额不足则扣光（不透支）。

面向清迈学生偏便宜（$1 ≈ 25 次简单出图），符合"牵引不是利润"。

## 前端展示原则
给用户显示"积分"和"≈N 次"，别显示水管细节。钱包/余额是账，前台讲的是"你又往前走了一步"。
