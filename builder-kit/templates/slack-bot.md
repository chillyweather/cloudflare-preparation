# Slack bot

A bot that answers a slash command in Slack.

## Stack
- Cloudflare Worker receiving Slack webhooks
- KV for per-workspace settings

## Rules
- Verify Slack's request signature on every call
- Bot token stored as a Wrangler secret, never in code
- Register the app with `register_app` when it is live
