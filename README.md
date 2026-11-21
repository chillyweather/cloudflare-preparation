# cloudflare-preparation

A small, real **remote MCP server on Cloudflare Workers** (`builder-kit`), plus a refresher on CI/CD and web security fundamentals.

> **Status:** planning. Nothing is built or deployed yet. Progress is tracked in the [issues](https://github.com/chillyweather/cloudflare-preparation/issues).

## What it is

`builder-kit` is an MCP server that AI coding tools (Claude Code, Cursor) connect to. It gives non-developer "builders" approved app templates and a registry of the apps they have shipped.

| Tool | Storage | Cloudflare piece |
|---|---|---|
| `list_templates`, `get_template` | Markdown templates in a bucket | **R2** |
| `register_app`, `list_my_apps` | `apps` table | **D1** (SQL + migrations) |
| feature flags / simple rate limit | key–value | **KV** |
| only signed-in users, per-user data | identity | **Access** / OAuth |
| test + deploy on every push | GitHub Actions | **CI/CD** |

## Roadmap

- [ ] [#2](https://github.com/chillyweather/cloudflare-preparation/issues/2) Hello-world MCP server on Workers, connected to Claude Code
- [ ] [#3](https://github.com/chillyweather/cloudflare-preparation/issues/3) Real tools with D1, R2 and KV
- [ ] [#4](https://github.com/chillyweather/cloudflare-preparation/issues/4) Auth and secrets: Cloudflare Access or OAuth, per-user data
- [ ] [#5](https://github.com/chillyweather/cloudflare-preparation/issues/5) CI/CD with GitHub Actions: tests, D1 migrations, deploy
- [ ] [#6](https://github.com/chillyweather/cloudflare-preparation/issues/6) Refresher: CI/CD (incl. Azure DevOps terms) and security fundamentals Q&A
- [ ] [#7](https://github.com/chillyweather/cloudflare-preparation/issues/7) README, write-up and the honest CV/letter line

The full plan is in [#1](https://github.com/chillyweather/cloudflare-preparation/issues/1).

## Ground rules

- Written with Claude Code, but every file must be explainable by me.
- Nothing is claimed until it is deployed and works from Claude Code.
- No secrets in the repo: `.dev.vars` stays in `.gitignore`.
