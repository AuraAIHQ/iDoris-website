# Repository Guidelines

## Project Structure & Module Organization

This repository is a static Cloudflare Pages site for iDoris.ai. The deployable site lives in `site/`: `index.html` contains the page content, `assets/style.css` contains all styling, and `assets/i18n.js` handles the bilingual English/Chinese toggle. Static images are under `site/assets/illustrations/`. Doris character rules are in `docs/doris-character-lock.md`. Cloudflare configuration is in `wrangler.jsonc`; helper scripts live in `scripts/`.

## Build, Test, and Development Commands

Use Node with the package manager already used by the repo, preferably `pnpm`.

- `pnpm install`: install the local Wrangler dependency.
- `pnpm dev`: run `wrangler pages dev site` for local preview, normally at `http://localhost:8788`.
- `pnpm deploy`: deploy `site/` to Cloudflare Pages project `idoris-website`.

There is no separate build step; files in `site/` are served directly.

## Coding Style & Naming Conventions

Keep the site dependency-light and static. Use two-space indentation in HTML, CSS, and JavaScript, matching the current files. CSS classes use lowercase kebab-style names such as `hero-art`, `prod-links`, and `lang-btn`. Prefer semantic HTML sections and concise comments that explain non-obvious layout or behavior.

For bilingual content, English is the inline default and Chinese goes in `data-zh` attributes, for example `<p data-zh="中文">English</p>`. Preserve that contract when editing visible copy. Keep asset names lowercase and descriptive, such as `p2-idoris.png`.

## Testing Guidelines

No automated test framework is currently configured. Before submitting changes, run `pnpm dev` and manually verify the page in a browser. Check desktop and mobile widths, navigation anchors, image loading, and both language modes. For content edits, confirm that toggling EN/中文 does not lose markup or leave untranslated visible text.

## Commit & Pull Request Guidelines

Recent commits use short, direct messages, sometimes in Chinese, for example `初始化 iDoris.ai 官网与 README` and `接入 Blog 链接（blog.mushroom.cv）`. Follow that style: one concise sentence describing the user-visible change.

Pull requests should include a brief summary, screenshots for visual changes, the commands run (`pnpm dev`, manual checks), and any Cloudflare Pages or routing implications. Link related issues when available.

## Security & Configuration Tips

Do not commit Cloudflare tokens, account IDs, or local environment files. Keep security and caching headers in `site/_headers`, and review them when adding new asset types or external resources.
