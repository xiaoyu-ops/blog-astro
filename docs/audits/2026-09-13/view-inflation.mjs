import { handleRequest, LabStatusGuard } from "/Users/wuzhuoyang/code/blog-astro/status-worker/src/index.ts";

class MemoryStorage {
  values = new Map();
  async get(key) { return this.values.get(key); }
  async put(key, value) { this.values.set(key, value); }
}

const storage = new MemoryStorage();
const guard = new LabStatusGuard({ storage }, {});
const env = {
  LAB2_STATUS: { async get() { return null; }, async put() {} },
  LAB2_GUARD: {
    idFromName() { return {}; },
    get() { return { fetch(input, init) { return guard.fetch(new Request(input, init)); } }; },
  },
  LAB2_HMAC_SECRET: "local-test-secret",
};

const request = (userAgent) => new Request("https://local.test/api/views/track", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "cf-connecting-ip": "203.0.113.7",
    "x-forwarded-for": "203.0.113.7",
    "user-agent": userAgent,
  },
  body: JSON.stringify({ path: "/" }),
});

const results = [];
for (const userAgent of ["same-ip-a", "same-ip-b", "same-ip-c"]) {
  const response = await handleRequest(request(userAgent), env, new Date("2026-09-13T12:00:00Z"));
  results.push({ userAgent, status: response.status, body: await response.json() });
}

console.log(JSON.stringify({ results, storedViews: await storage.get("views") }, null, 2));
