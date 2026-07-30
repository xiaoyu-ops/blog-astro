# LAB-2 public status Worker

This isolated package owns only `GET` and `POST /api/lab2/status`. It stores the
latest allowlisted snapshot and 60 heartbeats in KV, while a Durable Object
serializes replay protection and write-rate limiting.

## Local verification

```bash
pnpm --dir status-worker check
pnpm --dir status-worker test
```

The committed `wrangler.jsonc` intentionally contains
`REPLACE_WITH_KV_NAMESPACE_ID`. Create the production namespace first, replace
that placeholder with its ID, then add `LAB2_HMAC_SECRET` with
`wrangler secret put`. Never put the secret in this file, Git, logs, or chat.

## Deployment gate

Before deployment, verify all of the following:

- Wrangler is authenticated to the intended Cloudflare account.
- The KV namespace is dedicated to this Worker.
- The route is exactly `blog.xiaoyu666.cyou/api/lab2/status*`.
- The Durable Object migration is present.
- `pnpm test` and `pnpm build` pass from the repository root.
- A signed POST succeeds, an invalid signature fails, and `/api/views/track`
  remains unchanged.

Do not treat `wrangler deploy`, a Git push, or CI success as proof that the
public endpoint is working. Verify the public GET response separately.
