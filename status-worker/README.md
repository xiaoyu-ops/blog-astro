# LAB-2 public status Worker

This isolated package owns `GET` and signed `POST /api/lab2/status`, plus the
public `POST /api/views/track` compatibility endpoint used by the homepage. It
stores the latest allowlisted LAB-2 snapshot and 60 heartbeats together in one
KV value, so each collector report consumes one KV `put`. A Durable Object
serializes replay protection, write-rate limiting, and privacy-preserving daily
visitor counts (only a SHA-256 visitor fingerprint is stored).

## Local verification

```bash
pnpm --dir status-worker check
pnpm --dir status-worker test
```

The committed `wrangler.jsonc` references the dedicated production KV namespace.
Add `LAB2_HMAC_SECRET` with `wrangler secret put` when creating a new
environment. Never put the secret in this file, Git, logs, or chat.

## Deployment gate

Before deployment, verify all of the following:

- Wrangler is authenticated to the intended Cloudflare account.
- The KV namespace is dedicated to this Worker.
- The route is exactly `blog.xiaoyu666.cyou/api/lab2/status*`.
- The Durable Object migration is present.
- `pnpm test` and `pnpm build` pass from the repository root.
- A signed LAB-2 POST succeeds and an invalid signature fails.
- `/api/views/track` returns `total`, `today`, `date`, and `counted`.

Do not treat `wrangler deploy`, a Git push, or CI success as proof that the
public endpoint is working. Verify the public GET response separately.
