import type { WorkerEnv } from "./types";

const MAX_VIEW_BODY_BYTES = 1024;
const RATE_WINDOW_SECONDS = 60;
const PER_IP_RATE_LIMIT = 60;
const GLOBAL_RATE_LIMIT = 300;
const VISITOR_CAP = 512;
const VIEWS_BASELINE_TOTAL = 84;
const ALLOWED_ORIGIN = "https://blog.xiaoyu666.cyou";

const json = (value: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });
const errorResponse = (status: number, code: string) => json({ error: code }, status, { "cache-control": "no-store" });

const readBodyUpTo = async (request: Request, limit: number) => {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let body = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return body + decoder.decode();
      bytes += value.byteLength;
      if (bytes > limit) {
        await reader.cancel("payload_too_large");
        return null;
      }
      body += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
};

const shanghaiDate = (now: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

const visitorHash = async (request: Request, date: string, secret: string) => {
  const address = request.headers.get("cf-connecting-ip");
  if (!address || !secret) return null;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${date}\n${address}`));
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
};

type ViewState = { total: number; date: string; today: number; visitors: string[]; saturated?: boolean; global?: { window: number; count: number }; perVisitor?: Record<string, { window: number; count: number }> };

const handleViewPost = async (request: Request, env: WorkerEnv, now: Date) => {
  if (!env.ANALYTICS_HASH_SECRET || !request.headers.get("cf-connecting-ip")) return errorResponse(503, "analytics_identity_unavailable");
  const rawBody = await readBodyUpTo(request, MAX_VIEW_BODY_BYTES);
  if (rawBody === null) return errorResponse(413, "payload_too_large");
  let input: unknown;
  try { input = JSON.parse(rawBody); } catch { return errorResponse(400, "invalid_json"); }
  const path = input && typeof input === "object" && "path" in input ? (input as { path?: unknown }).path : null;
  if (typeof path !== "string" || !path.startsWith("/") || path.length > 512) return errorResponse(400, "invalid_path");
  const date = shanghaiDate(now);
  const visitor = await visitorHash(request, date, env.ANALYTICS_HASH_SECRET);
  if (!visitor) return errorResponse(503, "analytics_identity_unavailable");
  const stub = env.LAB2_GUARD.get(env.LAB2_GUARD.idFromName("views"));
  return stub.fetch("https://guard.internal/views", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ date, visitor }) });
};

export const handleRequest = async (request: Request, env: WorkerEnv, now = new Date()) => {
  const url = new URL(request.url);
  if (url.pathname === "/api/lab2/status") return errorResponse(410, "monitoring_retired");
  if (url.pathname !== "/api/views/track") return errorResponse(404, "not_found");
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "access-control-allow-origin": ALLOWED_ORIGIN, "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "Content-Type", "access-control-max-age": "86400", vary: "Origin" } });
  if (request.method !== "POST") return errorResponse(405, "method_not_allowed");
  const origin = request.headers.get("origin");
  if (origin && origin !== ALLOWED_ORIGIN) return errorResponse(403, "origin_not_allowed");
  const upstream = await handleViewPost(request, env, now);
  // Durable Object responses may have immutable headers in production.
  const response = new Response(upstream.body, upstream);
  response.headers.set("access-control-allow-origin", ALLOWED_ORIGIN);
  response.headers.set("vary", "Origin");
  return response;
};

export class LabStatusGuard {
  private readonly state: DurableObjectState;
  constructor(state: DurableObjectState, _env: WorkerEnv) { this.state = state; }
  private async trackView(request: Request) {
    const input = (await request.json()) as { date?: string; visitor?: string };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date ?? "") || !/^[a-f0-9]{64}$/.test(input.visitor ?? "")) return errorResponse(400, "invalid_view_request");
    const current = await this.state.storage.get<ViewState>("views");
    const sameDay = current?.date === input.date;
    const legacyVisitors = sameDay ? (current?.visitors ?? []) : [];
    const visitors = [...new Set(legacyVisitors.filter((value) => /^[a-f0-9]{64}$/.test(value)))].slice(0, VISITOR_CAP);
    const stored: ViewState = {
      total: current?.total ?? VIEWS_BASELINE_TOTAL,
      date: input.date!,
      today: sameDay ? (current?.today ?? visitors.length) : 0,
      visitors,
      saturated: Boolean(sameDay && (current?.saturated || legacyVisitors.length > VISITOR_CAP)),
      global: sameDay ? current?.global : undefined,
      perVisitor: sameDay ? Object.fromEntries(Object.entries(current?.perVisitor ?? {}).filter(([key]) => /^[a-f0-9]{64}$/.test(key)).slice(-VISITOR_CAP)) : {},
    };
    const now = Math.floor(Date.now() / 1000);
    const minute = Math.floor(now / RATE_WINDOW_SECONDS);
    const global = stored.global?.window === minute ? stored.global : { window: minute, count: 0 };
    const perVisitor = stored.perVisitor ?? {};
    const bucket = perVisitor[input.visitor!]?.window === minute ? perVisitor[input.visitor!] : { window: minute, count: 0 };
    if (global.count >= GLOBAL_RATE_LIMIT || bucket.count >= PER_IP_RATE_LIMIT) return errorResponse(429, "rate_limited");
    global.count += 1; bucket.count += 1; perVisitor[input.visitor!] = bucket;
    const counted = !stored.saturated && !stored.visitors.includes(input.visitor!);
    if (counted && stored.visitors.length < VISITOR_CAP) { stored.total += 1; stored.today += 1; stored.visitors.push(input.visitor!); }
    else if (counted) stored.saturated = true;
    stored.global = global; stored.perVisitor = Object.fromEntries(Object.entries(perVisitor).slice(-VISITOR_CAP));
    await this.state.storage.put("views", stored);
    return json({ total: stored.total, today: stored.today, date: stored.date, counted: counted && !stored.saturated, saturated: Boolean(stored.saturated) }, 200, { "cache-control": "no-store" });
  }
  async fetch(request: Request) { return request.method === "POST" && new URL(request.url).pathname === "/views" ? this.trackView(request) : errorResponse(404, "not_found"); }
}

export default { fetch(request: Request, env: WorkerEnv) { return handleRequest(request, env); } };
