import assert from "node:assert/strict";
import test from "node:test";
import { LabStatusGuard, handleRequest } from "../src/index.ts";
import type { WorkerEnv } from "../src/types.ts";

class MemoryStorage {
  readonly values = new Map<string, unknown>();
  async get<T>(key: string) { return this.values.get(key) as T | undefined; }
  async put(key: string, value: unknown) { this.values.set(key, structuredClone(value)); }
}

const createEnvironment = () => {
  const storage = new MemoryStorage();
  const guard = new LabStatusGuard({ storage } as unknown as DurableObjectState, {} as WorkerEnv);
  const env = {
    LAB2_GUARD: {
      idFromName: () => ({ toString: () => "views" }),
      get: () => ({ fetch: (input: RequestInfo | URL, init?: RequestInit) => guard.fetch(new Request(input, init)) }),
    } as unknown as DurableObjectNamespace,
    ANALYTICS_HASH_SECRET: "test-analytics-secret",
  } as WorkerEnv;
  return { env, guard, storage };
};

const viewRequest = (ip: string, body = JSON.stringify({ path: "/" })) => new Request(
  "https://example.com/api/views/track",
  { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": ip, origin: "https://blog.xiaoyu666.cyou" }, body },
);

test("retired monitoring endpoint returns 410", async () => {
  const { env } = createEnvironment();
  const response = await handleRequest(new Request("https://example.com/api/lab2/status"), env);
  assert.equal(response.status, 410);
});

test("counts one daily visitor per Cloudflare IP regardless of user agent", async () => {
  const { env } = createEnvironment();
  const first = await handleRequest(viewRequest("203.0.113.10"), env, new Date("2026-07-30T16:00:00Z"));
  assert.equal(first.status, 200);
  assert.equal((await first.json() as { counted: boolean }).counted, true);
  const duplicate = viewRequest("203.0.113.10");
  duplicate.headers.set("user-agent", "attacker-changed-agent");
  const second = await handleRequest(duplicate, env, new Date("2026-07-30T16:00:00Z"));
  assert.equal((await second.json() as { counted: boolean }).counted, false);
});

test("rejects oversized view body while streaming", async () => {
  const { env } = createEnvironment();
  const response = await handleRequest(viewRequest("203.0.113.11", "x".repeat(1025)), env);
  assert.equal(response.status, 413);
});

test("cancels a multi-chunk body at the byte limit", async () => {
  const { env } = createEnvironment();
  let cancelled = false;
  const stream = new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(700)); controller.enqueue(new Uint8Array(700)); },
    cancel() { cancelled = true; },
  });
  const request = new Request("https://example.com/api/views/track", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.15", origin: "https://blog.xiaoyu666.cyou" }, body: stream, duplex: "half" } as RequestInit);
  assert.equal((await handleRequest(request, env)).status, 413);
  assert.equal(cancelled, true);
});

test("rejects non production origins", async () => {
  const { env } = createEnvironment();
  const request = viewRequest("203.0.113.12");
  request.headers.set("origin", "https://evil.example");
  assert.equal((await handleRequest(request, env)).status, 403);
});

test("answers the CORS preflight and fails closed without identity inputs", async () => {
  const { env } = createEnvironment();
  const options = new Request("https://example.com/api/views/track", { method: "OPTIONS", headers: { origin: "https://blog.xiaoyu666.cyou" } });
  const preflight = await handleRequest(options, env);
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get("access-control-allow-methods") ?? "", /POST/);
  const missingIp = viewRequest("203.0.113.13");
  missingIp.headers.delete("cf-connecting-ip");
  assert.equal((await handleRequest(missingIp, env)).status, 503);
  const missingSecret = { ...env, ANALYTICS_HASH_SECRET: undefined };
  assert.equal((await handleRequest(viewRequest("203.0.113.14"), missingSecret)).status, 503);
});

test("caps analytics requests in a minute", async () => {
  const { env } = createEnvironment();
  for (let i = 0; i < 60; i += 1) {
    const response = await handleRequest(viewRequest("203.0.113.20"), env);
    assert.equal(response.status, 200);
  }
  assert.equal((await handleRequest(viewRequest("203.0.113.20"), env)).status, 429);
});

test("reports saturation explicitly and keeps the compact state under the engineering budget", async () => {
  const { env, storage } = createEnvironment();
  const date = "2026-07-31";
  await storage.put("views", { total: 596, date, today: 512, visitors: Array.from({ length: 512 }, (_, i) => i.toString(16).padStart(64, "0")), saturated: false });
  const response = await handleRequest(viewRequest("203.0.113.99"), env, new Date("2026-07-31T04:00:00Z"));
  const body = await response.json() as { counted: boolean; saturated: boolean };
  assert.equal(body.counted, false);
  assert.equal(body.saturated, true);
  assert.ok(JSON.stringify(await storage.get("views")).length < 128 * 1024);
});

test("normalizes oversized legacy state while preserving totals and rolling over by day", async () => {
  const { env, storage } = createEnvironment();
  const oldVisitors = Array.from({ length: 600 }, (_, i) => i.toString(16).padStart(64, "0"));
  await storage.put("views", { total: 10000, date: "2026-07-31", today: 600, visitors: oldVisitors, saturated: false, rateTimesByVisitor: { obsolete: [1, 2, 3] } });
  const response = await handleRequest(viewRequest("203.0.113.100"), env, new Date("2026-07-31T04:00:00Z"));
  assert.equal(response.status, 200);
  const stored = await storage.get<Record<string, unknown>>("views");
  assert.equal(stored?.total, 10000);
  assert.equal(stored?.today, 600);
  assert.equal((stored?.visitors as string[]).length, 512);
  assert.equal("rateTimesByVisitor" in (stored ?? {}), false);
  assert.equal((await response.json() as { saturated: boolean }).saturated, true);
  const next = await handleRequest(viewRequest("203.0.113.101"), env, new Date("2026-08-01T04:00:00Z"));
  assert.equal((await next.json() as { today: number; saturated: boolean }).today, 1);
});
