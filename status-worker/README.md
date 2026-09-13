# Blog analytics Worker

This Worker serves `POST /api/views/track` for the homepage. The former LAB-2
monitoring endpoint returns `410 monitoring_retired`; there is no public status
route, collector, or scheduled watchdog. The Durable Object binding remains
because it owns the existing analytics total and its migration identity.

The browser calls the Worker directly at
`https://lab2-public-status.wuzhuoyang252.workers.dev/api/views/track`. Requests
must carry the production Origin, Cloudflare `cf-connecting-ip`, and a deployed
`ANALYTICS_HASH_SECRET`; missing identity inputs fail closed. The Worker uses a
day-scoped keyed IP fingerprint, limits each fingerprint to 60 requests/minute
and the Worker to 300 requests/minute, and streams request bodies with a 1 KiB
limit.

Daily unique IP storage is bounded at 512 fingerprints. Once full, responses
include `saturated: true`; the displayed daily value is then a lower bound and
the homepage adds `+`. Existing totals are preserved while legacy visitor state
is normalized and obsolete rate arrays are discarded. A date rollover starts a
fresh bounded daily set.

## Verification and deployment

```bash
pnpm --dir status-worker check
pnpm --dir status-worker test
pnpm build
```

Set `ANALYTICS_HASH_SECRET` with Wrangler secret management before deployment.
The root `vercel.json` keeps the analytics connection target in `connect-src`,
and `scripts/validate-build.mjs` scans every emitted HTML file for CSP coverage
and retired monitoring or third-party references.
