# AuraAI — 组织大脑 iDoris

> 无数科幻片里都有那样一个存在：聪明、可靠、无所不能的智能大脑，帮人搞定一切。
> 我们想把它造出来——不是给一家巨头，而是给**每一个个体、每一个组织、每一座城市**。

🌐 **[iDoris.ai](https://idoris.ai)** — 组织的主域名，也是组织大脑这个产品的名字
📦 本仓库是 [iDoris.ai](https://idoris.ai) 官网源码（纯静态 · Cloudflare Pages · 中英双语）

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](./LICENSE)

---

## 关于名字

AuraAI 是 AI 给的建议——一个烂大街的名字。等我们去注册域名，发现早被人占了。

于是主域名成了 **iDoris.ai**。iDoris 同时是我们的组织名和核心产品名：**组织大脑**。这不是妥协，反而更准确——我们做的事，本来就该以那个大脑命名。

---

## 我们在做什么

**建立一个 AI 开源组织，为人类的数字未来提供更多数字公共物品，提升社会数字生活的福祉。**

不是产品公司，不是咨询团队。是一群人一边做真实的东西，一边把做出来的东西开源出去。

---

## 三个方向性产品

### 🔧 Self-FDE-WorkBench — 打造你自己的 AI 利器

工欲善其事，必先利其器。

一个为自己、也为其他 builder 提供的开源工作台。FDE（Forward Deployed Engineer）是 Palantir 的发明：你必须到客户现场，才能看见真实的卡点。我们认为这个角色会长期存在，久到不该再叫 FDE——它是 **ANE，AI Native Engineer**：不驻场，但在场。

雇不起 FDE 的组织，能不能自己 FDE？我们觉得可以。

- 协议：Apache 2.0
- 仓库：[AuraAIHQ/Self-FDE-WorkBench](https://github.com/AuraAIHQ/Self-FDE-WorkBench)
- 站点：[self-fde-workbench.pages.dev](https://self-fde-workbench.pages.dev)

### 🧠 iDoris — 最贴身的那个大脑

小模型调优与行业训练，多模态与多模型协作。

通用大模型知道所有事，唯独不知道**你的事**。iDoris 的方向是把模型调得足够小、足够专、足够贴身——最终为每个个体、组织、商业公司乃至城市，打造属于它自己的 AI 大脑。

- 小模型调优（LoRA / 行业微调）
- 行业训练与垂直能力沉淀
- 多模态
- 多模型协作调度

### 🤖 Agent 军团 — 智脑的手和脚

大脑要有手脚。我们需要用 AI 的不同能力、不同流程，去提升人类工作和协作的效率。

- **Agent 开发** — 记忆（Memory）、循环（Loop）、上下文（Context）、技能（Skill）
- **Agent 账户与安全** — Agent 怎么拥有身份、怎么被授权、怎么不闯祸
- **Agent 跨组织协作协议** — 当每个组织都有自己的 Agent，它们之间怎么说话

---

## 三条日常

| | 是什么 | 在哪 |
|---|---|---|
| 🍜 **清迈 Meetup** | 线下 AI builder 定期沟通，每周一次 | [Chiang Mai Weekly AI Study Group](https://app.sola.day/event/detail/19717) · Zuzalu Library Event Space, Building F, 4Seas Nimman |
| ✍️ **Blog / 公众号** | 文章集合，写清楚我们在想什么、踩了什么坑 | 筹备中 |
| 🎬 **视频号** | 手把手上手 AI。真实的实践，聚焦真问题——不是教程流水线 | 筹建中 |

线下那场每周日 18:00（GMT+7）在清迈，也开线上。

---

## 核心信念

**未来引领当下。**

如果 AI 把生产力的成本压到接近电费，每个人都要回答一个问题：当我的岗位被 AI 取代，我还能干什么？

我们认为只有三种角色留下核心价值，而且它们可以叠加：

- 🗣 **表达者** — AI 不会说「这家饭馆味道不错」，因为它不是人
- 💡 **创新者** — 全地图都是黑雾时，有人趟出一条路
- 🔧 **建设者** — 你解决的那个「小问题」，是别人每天承受的痛苦

---

## 本仓库：iDoris.ai 官网

```bash
pnpm install     # 安装 wrangler
pnpm dev         # 本地预览 http://localhost:8788
pnpm deploy      # 发布到 Cloudflare Pages
```

```
site/
├── index.html              首页
├── _headers                缓存与安全头
└── assets/
    ├── style.css
    ├── i18n.js             中英切换（EN 内联默认，中文在 data-zh）
    └── illustrations/      小J 手绘插图
```

---

## 参与方式

- 感兴趣的朋友都可以加入
- 提 PR 分享笔记、实验，或补全某个工具
- 在 Issues 里**说出你的痛点**——它可能就是下一个建设者要解决的问题
- 来清迈的 meetup，或者线上蹲一场

---

[AuraAI](https://github.com/AuraAIHQ) · [Self-FDE-WorkBench](https://github.com/AuraAIHQ/Self-FDE-WorkBench) · [Apache 2.0](./LICENSE)
