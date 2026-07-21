# Doris 生成 Prompt 存档

Doris 是 iDoris.ai 官网的固定吉祥物。本文件存档她的**三视图角色卡生成 prompt**，以及后续场景插图的**可复现生成流程**。形象规范另见 [`doris-character-lock.md`](./doris-character-lock.md)，真值参考图为 [`doris-character-reference.png`](./doris-character-reference.png)。

---

## 1. 三视图角色卡的完整 Prompt（权威版）

> 来源：这张角色卡 `doris-character-reference.png` 是在 **ChatGPT 内置 `image_gen`** 端生成的（不是本地 FLUX，也不在 Claude Code 会话里），完整 prompt 就印在图片底部。原样转录如下：

```
像素风格角色设计，8bit/16bit像素艺术，极简干净白色背景，仅黑白橙三色，主角是一位黑发马尾的女孩，
穿黑色羽绒服（左胸印有"DORIS"，左臂有"AI"徽章），内搭白色连帽卫衣，黑色长裤，白色运动鞋，
整体风格参考示例图，线条清晰，像素感明显，科技感，周围有橙色像素点和电路/数据流元素，
角色设定为AI智能助手，形象可爱、聪明、可靠。

需要包含：全身立绘、三视图、表情（微笑、专注、惊喜）、能力展示（知识检索、逻辑推理、多模态感知、任务规划）。

大小：1024x1536，纵向排版。
```

**徽章勘误（务必按这条，不按上面 prompt 的原文）**：胸前徽章应为 **`iDORIS`** —— 一个**小写红色 `i`** 紧接**大写白色 `DORIS`**；袖子有小 **`AI`** 徽章。角色卡渲染时把红色 `i` 丢成了纯白 "DORIS"，是渲染误差，以本勘误为准。

---

## 2. 后续场景插图的可复现流程（走 codex image_gen，禁用本地 FLUX）

Doris 场景配图统一走 **codex 的 `image_gen.imagegen`**（`codex exec` 自带，模型 gpt-5.5）。本地 FLUX 纯文生图无法稳定复现形象，已弃用。关键是把角色卡当参考图附上，保证一致性。

```bash
# 1) prompt 写进文件，避免 shell 引号地狱
#    参考图用 --image 附上角色卡；-i/--image 是可变参数(<FILE>...)，
#    会把后面的 prompt 也吞成图片文件 → 必须用独立的 `-` 从 stdin 读 prompt
codex exec --skip-git-repo-check --image docs/doris-character-reference.png - < prompt.txt

# prompt.txt 里让 codex 把 PNG 存到指定绝对路径（codex sandbox=workspace-write，可写 workdir/tmp）
# 出图通常几分钟；codex exec 前台 120s 会转后台，读它的 output 文件取结果。
```

**prompt.txt 模板要点**（照抄 [`doris-character-lock.md`](./doris-character-lock.md) 的外观 + 徽章勘误 + 本次场景）：

- 风格：8-bit/16-bit 像素漫画、清晰黑描边、平涂有限色（黑/炭/米白/白 + 橙点缀 + 克制 cyan 数据元素）、米白(cream)背景、大量留白。
- Doris 外观：黑发高马尾 + 橙发带；黑羽绒服 + 白卫衣；胸前 `iDORIS`（红 `i` + 白 `DORIS`）+ 袖 `AI`；黑裤橙点缀；白低帮鞋橙点缀；温暖微笑。不要帽子/耳机/背包。
- 站点插图用**横构图**（约 1024×640）落到 `site/assets/illustrations/`，先存 `_draft` 待确认再定名。
- 除 `iDORIS` / `AI` 徽章外，不要在图里烤进其它文字。

### 已生成的场景插图
- `site/assets/illustrations/_join_doris_draft.png` —— 招聘页 `/join`：Doris 伸手欢迎实习生，中间三图标对应三条业务线（黑客松奖杯 / 公司握手 / AI 插头+数据流）。
