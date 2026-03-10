# Click Tracker Worker (Cloudflare)

This worker ingests H5 click events and exposes aggregated preference stats.

## Endpoints
- `POST /api/click` -> ingest one event
- `GET /api/prefs?days=7` -> aggregated prefs for last N days
- `GET /health` -> health check

## Deploy quick steps
1. Create a KV namespace in Cloudflare (e.g. `DAILY_PREF_KV`)
2. Create a Worker (e.g. `daily-click-api`) and paste `click-tracker.js`
3. Bind KV namespace as `DAILY_PREF_KV`
4. Deploy and copy URL (example: `https://daily-click-api.<sub>.workers.dev`)

## Test
```bash
curl -X POST 'https://YOUR_WORKER/api/click' \
  -H 'content-type: application/json' \
  -d '{"type":"open","section":"highlights","title":"test"}'

curl 'https://YOUR_WORKER/api/prefs?days=7'
```
