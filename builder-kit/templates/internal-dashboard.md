# Internal dashboard

A read-only dashboard over company data.

## Stack
- Cloudflare Worker + static assets
- D1 for data, Cloudflare Access for login

## Rules
- Read-only by default; no direct database writes from the UI
- No personal data on screen without approval
- Register the app with `register_app` when it is live
