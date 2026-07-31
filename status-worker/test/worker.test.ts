import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Validator } from "@cfworker/json-schema";
import publicSchema from "../../status-contract/lab2-public-status-v1.schema.json" with {
  type: "json",
};
import reportSchema from "../../status-contract/lab2-status-v1.schema.json" with {
  type: "json",
};
import { LabStatusGuard, handleRequest } from "../src/index.ts";
import type { StatusReport, StoredStatus, WorkerEnv } from "../src/types.ts";

class MemoryKv {
  readonly values = new Map<string, string>();
  readonly putKeys: string[] = [];

  async get<T>(key: string, type?: string): Promise<T | string | null> {
    const value = this.values.get(key);
    if (value === undefined) return null;
    return type === "json" ? (JSON.parse(value) as T) : value;
  }

  async put(key: string, value: string) {
    this.putKeys.push(key);
    this.values.set(key, value);
  }
}

class MemoryStorage {
  readonly values = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async put(key: string, value: unknown) {
    this.values.set(key, value);
  }
}

const readFixture = async (name: string) =>
  JSON.parse(
    await readFile(
      new URL(`../../status-contract/fixtures/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as StatusReport;

const readPublicFixture = async (name: string) =>
  JSON.parse(
    await readFile(
      new URL(
        `../../status-contract/public-fixtures/${name}.json`,
        import.meta.url,
      ),
      "utf8",
    ),
  );

const createEnvironment = () => {
  const kv = new MemoryKv();
  const storage = new MemoryStorage();
  const guard = new LabStatusGuard(
    { storage } as unknown as DurableObjectState,
    {} as WorkerEnv,
  );
  const env = {
    LAB2_STATUS: kv as unknown as KVNamespace,
    LAB2_GUARD: {
      idFromName: () => ({ toString: () => "lab-2" }),
      get: () => ({
        fetch: (input: RequestInfo | URL, init?: RequestInit) =>
          guard.fetch(new Request(input, init)),
      }),
    } as unknown as DurableObjectNamespace,
    LAB2_HMAC_SECRET: "test-secret-with-enough-entropy",
  } satisfies WorkerEnv;
  return { env, kv, guard };
};

const signedRequest = (
  report: unknown,
  secret: string,
  timestamp = Math.floor(Date.now() / 1000),
) => {
  const body = JSON.stringify(report);
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  return new Request("https://example.com/api/lab2/status", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-mmdedup-timestamp": timestamp.toString(),
      "x-mmdedup-signature": `sha256=${signature}`,
    },
    body,
  });
};

const viewRequest = (address: string, userAgent = "test-browser") =>
  new Request("https://example.com/api/views/track", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": address,
      "user-agent": userAgent,
    },
    body: JSON.stringify({ path: "/" }),
  });

test("accepts every valid report fixture", async () => {
  for (const name of ["live-running", "live-idle", "missing-gpu", "no-progress"]) {
    const { env } = createEnvironment();
    const report = await readFixture(name);
    const response = await handleRequest(
      signedRequest(report, env.LAB2_HMAC_SECRET),
      env,
    );
    assert.equal(response.status, 202, name);
  }
});

test("accepts every fixed public status fixture and rejects private fields", async () => {
  const validator = new Validator(publicSchema as never, "2020-12", false);
  validator.addSchema(reportSchema as never);
  for (const name of [
    "live-running",
    "live-idle",
    "stale",
    "offline",
    "unknown",
  ]) {
    const fixture = await readPublicFixture(name);
    assert.equal(validator.validate(fixture).valid, true, name);
  }

  const privateFixture = {
    ...(await readPublicFixture("live-running")),
    hostname: "must-not-leak",
  };
  assert.equal(validator.validate(privateFixture).valid, false);
});

test("stores sanitized status with one KV put and recomputes authoritative progress", async () => {
  const { env, kv } = createEnvironment();
  const report = await readFixture("live-running");
  report.experiment!.progress!.percent = 12;
  const write = await handleRequest(
    signedRequest(report, env.LAB2_HMAC_SECRET),
    env,
  );
  assert.equal(write.status, 202);
  assert.deepEqual(kv.putKeys, ["lab2:latest"]);

  const read = await handleRequest(
    new Request("https://example.com/api/lab2/status"),
    env,
  );
  assert.equal(read.status, 200);
  assert.match(read.headers.get("cache-control") ?? "", /max-age=15/);
  const publicStatus = (await read.json()) as {
    freshness: { state: string };
    experiment: { progress: { percent: number } };
    heartbeats: unknown[];
  };
  assert.equal(publicStatus.freshness.state, "fresh");
  assert.equal(publicStatus.experiment.progress.percent, 50);
  assert.equal(publicStatus.heartbeats.length, 1);
  assert.equal(JSON.stringify(publicStatus).includes("_receivedAt"), false);
  assert.equal(JSON.stringify(publicStatus).includes("_heartbeats"), false);
});

test("migrates legacy heartbeat storage into the combined snapshot", async () => {
  const { env, kv } = createEnvironment();
  const previous = await readFixture("live-idle");
  const legacyHeartbeat = { observedAt: previous.observedAt };
  await kv.put(
    "lab2:latest",
    JSON.stringify({
      ...previous,
      _receivedAt: new Date().toISOString(),
    } satisfies StoredStatus),
  );
  await kv.put("lab2:heartbeats", JSON.stringify([legacyHeartbeat]));
  kv.putKeys.length = 0;

  const report = await readFixture("live-running");
  report.observedAt = new Date(
    Date.parse(previous.observedAt) + 120 * 1000,
  ).toISOString();
  const write = await handleRequest(
    signedRequest(report, env.LAB2_HMAC_SECRET),
    env,
  );
  assert.equal(write.status, 202);
  assert.deepEqual(kv.putKeys, ["lab2:latest"]);

  const combined = await kv.get<StoredStatus>("lab2:latest", "json");
  assert.equal(typeof combined, "object");
  assert.deepEqual((combined as StoredStatus)._heartbeats, [
    legacyHeartbeat,
    { observedAt: report.observedAt },
  ]);
});

test("returns a safe unknown response before the first report", async () => {
  const { env } = createEnvironment();
  const response = await handleRequest(
    new Request("https://example.com/api/lab2/status"),
    env,
  );
  const status = (await response.json()) as {
    server: { state: string };
    freshness: { state: string };
    heartbeats: unknown[];
  };
  assert.equal(response.status, 200);
  assert.equal(status.server.state, "unknown");
  assert.equal(status.freshness.state, "unknown");
  assert.deepEqual(status.heartbeats, []);
});

test("rejects invalid, expired, replayed, and oversized writes", async () => {
  const report = await readFixture("live-running");
  const { env } = createEnvironment();

  const invalid = signedRequest(report, "wrong-secret");
  assert.equal((await handleRequest(invalid, env)).status, 401);

  const expired = signedRequest(
    report,
    env.LAB2_HMAC_SECRET,
    Math.floor(Date.now() / 1000) - 301,
  );
  assert.equal((await handleRequest(expired, env)).status, 401);

  const replay = signedRequest(report, env.LAB2_HMAC_SECRET);
  const replayClone = replay.clone() as unknown as Request;
  assert.equal((await handleRequest(replay, env)).status, 202);
  assert.equal((await handleRequest(replayClone, env)).status, 409);

  const oversized = "x".repeat(8 * 1024 + 1);
  const oversizedRequest = new Request(
    "https://example.com/api/lab2/status",
    {
      method: "POST",
      headers: { "content-length": oversized.length.toString() },
      body: oversized,
    },
  );
  assert.equal((await handleRequest(oversizedRequest, env)).status, 413);
});

test("rejects unknown fields and impossible progress", async () => {
  const report = await readFixture("live-running");

  {
    const { env } = createEnvironment();
    const withPrivateField = { ...report, hostname: "must-not-leak" };
    const response = await handleRequest(
      signedRequest(withPrivateField, env.LAB2_HMAC_SECRET),
      env,
    );
    assert.equal(response.status, 400);
  }

  {
    const { env } = createEnvironment();
    report.experiment!.progress!.completed = 5;
    report.experiment!.progress!.total = 4;
    const response = await handleRequest(
      signedRequest(report, env.LAB2_HMAC_SECRET),
      env,
    );
    assert.equal(response.status, 400);
  }
});

test("computes stale and offline from server receipt time", async () => {
  const report = await readFixture("live-idle");

  for (const [age, expected] of [
    [181, "stale"],
    [601, "offline"],
  ] as const) {
    const { env, kv } = createEnvironment();
    const receivedAt = new Date("2026-07-30T12:00:00.000Z");
    const stored: StoredStatus = {
      ...report,
      _receivedAt: receivedAt.toISOString(),
    };
    await kv.put("lab2:latest", JSON.stringify(stored));
    await kv.put("lab2:heartbeats", JSON.stringify([]));
    const response = await handleRequest(
      new Request("https://example.com/api/lab2/status"),
      env,
      new Date(receivedAt.getTime() + age * 1000),
    );
    const status = (await response.json()) as {
      freshness: { state: string };
    };
    assert.equal(status.freshness.state, expected);
  }
});

test("guard rate limits the seventh distinct write in one minute", async () => {
  const { guard } = createEnvironment();
  for (let index = 0; index < 6; index += 1) {
    const response = await guard.fetch(
      new Request("https://guard.internal/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          timestamp: Math.floor(Date.now() / 1000),
          signature: index.toString().padStart(64, "0"),
        }),
      }),
    );
    assert.equal(response.status, 204);
  }

  const limited = await guard.fetch(
    new Request("https://guard.internal/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        timestamp: Math.floor(Date.now() / 1000),
        signature: "f".repeat(64),
      }),
    }),
  );
  assert.equal(limited.status, 429);
});

test("tracks unique daily visitors without storing raw identifiers", async () => {
  const { env, guard } = createEnvironment();
  const now = new Date("2026-07-30T16:00:00.000Z");

  const first = await handleRequest(viewRequest("203.0.113.10"), env, now);
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), {
    total: 85,
    today: 1,
    date: "2026-07-31",
    counted: true,
  });

  const duplicate = await handleRequest(viewRequest("203.0.113.10"), env, now);
  assert.deepEqual(await duplicate.json(), {
    total: 85,
    today: 1,
    date: "2026-07-31",
    counted: false,
  });

  const second = await handleRequest(viewRequest("203.0.113.11"), env, now);
  assert.deepEqual(await second.json(), {
    total: 86,
    today: 2,
    date: "2026-07-31",
    counted: true,
  });

  const stored = await (
    guard as unknown as { state: { storage: MemoryStorage } }
  ).state?.storage?.get?.("views");
  assert.equal(JSON.stringify(stored).includes("203.0.113"), false);
});

test("rejects malformed view tracking requests", async () => {
  const { env } = createEnvironment();
  const invalid = new Request("https://example.com/api/views/track", {
    method: "POST",
    body: JSON.stringify({ path: "not-a-path" }),
  });
  assert.equal((await handleRequest(invalid, env)).status, 400);
  assert.equal(
    (
      await handleRequest(
        new Request("https://example.com/api/views/track"),
        env,
      )
    ).status,
    405,
  );
});
