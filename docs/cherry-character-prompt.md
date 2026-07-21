# Cherry 生成 Prompt 存档

Cherry 是 iDoris 陪伴宠物 —— Doris（女生 AI 助手）的伙伴狗，凯利蓝㹴，两个 IP 配套。角色卡：`docs/cherry-character-reference.png`。生成走 codex `image_gen`，形象锁定，见全局 skill `cherry-illustrator`。Doris 见 [`doris-character-prompt.md`](./doris-character-prompt.md)。

## 角色卡完整 Prompt（印在卡片底部，原样转录）

```
像素风格角色设计，8bit/16bit 像素艺术，极简干净白色背景，仅黑白橙 + 蓝眼配色。
主角是一只凯利蓝㹴（Kerry Blue Terrier）作为 Doris 的 AI 伙伴宠物，方形长脸与浓密胡须口鼻，
卷曲/波浪状深炭黑毛发，直立尾巴，机灵可爱的表情，亮蓝白眼睛，佩戴橙色细项圈与小圆吊牌。

包含：全身立绘、三视图、表情（微笑、好奇、开心、惊讶）、动作（坐、趴、小跑、跳）等形象。

线条清晰，像素感明显，科技感橙色点阵与线路装饰，风格与 Doris 角色卡一致。

大小：1024x1536，纵向排版。
```

## 形象锁定要点（务必画对）

- **品种：凯利蓝㹴 / Kerry Blue Terrier** —— 方长脸 + 大胡子/络腮、卷/波浪毛、㹴犬体型（背线平、腿细长、方正修长）、短竖尾。**不要画成圆脸的京巴/贵宾**（曾出过这个错）。
- **毛色**：黑 / 深炭。
- **眼睛**：**蓝白色 / 浅蓝**（cyan 高光）—— Cherry 的记忆点，用户特别要求。
- **项圈**：细橙色项圈 + 小圆吊牌。
- 风格：8-bit/16-bit 像素漫画、黑/白/橙 + 克制 cyan、米白背景，与 Doris 角色卡一致。

## 生成流程

同 Doris：codex `image_gen` + 附参考图。见 skill `cherry-illustrator`（自带参考图与模板）。

```bash
codex exec --skip-git-repo-check \
  --image ~/.claude/skills/cherry-illustrator/reference/cherry-reference.png \
  - < prompt.txt
```
