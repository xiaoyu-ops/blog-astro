import { Validator } from "@cfworker/json-schema";
import schema from "../../status-contract/lab2-status-v1.schema.json" with {
  type: "json",
};
import type {
  PublicStatus,
  StatusHeartbeat,
  StatusReport,
  StoredStatus,
  WorkerEnv,
} from "./types";

const MAX_BODY_BYTES = 8 * 1024;
const MAX_CLOCK_SKEW_SECONDS = 5 * 60;
const REPLAY_WINDOW_SECONDS = 10 * 60;
const RATE_WINDOW_SECONDS = 60;
const RATE_LIMIT = 6;
const FRESH_WINDOW_SECONDS = 6 * 60;
const OFFLINE_WINDOW_SECONDS = 10 * 60;
const LATEST_KEY = "lab2:latest";
const HEARTBEATS_KEY = "lab2:heartbeats";
const VIEWS_BASELINE_TOTAL = 84;
const validator = new Validator(schema as never, "2020-12");

const json = (value: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
  });

const errorResponse = (status: number, code: string) =>
  json({ error: code }, status, { "cache-control": "no-store" });

const parseSignature = (value: string | null) => {
  if (!value?.startsWith("sha256=")) return null;
  const digest = value.slice("sha256=".length).toLowerCase();
  return /^[a-f0-9]{64}$/.test(digest) ? digest : null;
};

const hexToBytes = (hex: string) => {
  const output = new Uint8Array(hex.length / 2);
  for (let index = 0; index < hex.length; index += 2) {
    output[index / 2] = Number.parseInt(hex.slice(index, index + 2), 16);
  }
  return output;
};

const verifyHmac = async (
  secret: string,
  timestamp: string,
  rawBody: string,
  signature: string,
) => {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    "HMAC",
    key,
    hexToBytes(signature),
    new TextEncoder().encode(`${timestamp}.${rawBody}`),
  );
};

const sanitizeReport = (input: StatusReport): StatusReport => {
  const progress = input.experiment?.progress;
  if (progress && progress.completed > progress.total) {
    throw new Error("invalid_progress");
  }

  return {
    schemaVersion: 1,
    server: {
      id: "lab-2",
      state: "online",
    },
    experiment: input.experiment
      ? {
          project: "MMdedup-v2",
          phase: {
            zh: input.experiment.phase.zh,
            en: input.experiment.phase.en,
          },
          task: {
            zh: input.experiment.task.zh,
            en: input.experiment.task.en,
          },
          state: input.experiment.state,
          startedAt: input.experiment.startedAt,
          progress: progress
            ? {
                completed: progress.completed,
                total: progress.total,
                percent:
                  Math.round((progress.completed / progress.total) * 1000) / 10,
                unit: progress.unit,
                authoritative: true,
              }
            : null,
        }
      : null,
    resources: {
      cpu: input.resources.cpu
        ? {
            state: input.resources.cpu.state,
            utilizationPercent: input.resources.cpu.utilizationPercent,
          }
        : null,
      gpu: input.resources.gpu
        ? {
            model: input.resources.gpu.model,
            state: input.resources.gpu.state,
            utilizationPercent: input.resources.gpu.utilizationPercent,
            memoryUsedMiB: input.resources.gpu.memoryUsedMiB,
            memoryTotalMiB: input.resources.gpu.memoryTotalMiB,
            temperatureC: input.resources.gpu.temperatureC,
          }
        : null,
      memory: input.resources.memory
        ? {
            usedGiB: input.resources.memory.usedGiB,
            totalGiB: input.resources.memory.totalGiB,
          }
        : null,
      disk: input.resources.disk
        ? {
            usedPercent: input.resources.disk.usedPercent,
            freeGiB: input.resources.disk.freeGiB,
          }
        : null,
    },
    health: {
      serviceRestarts: input.health.serviceRestarts,
      oomDetected: input.health.oomDetected,
      nanDetected: input.health.nanDetected,
    },
    observedAt: input.observedAt,
  };
};

const guardRequest = async (
  env: WorkerEnv,
  timestamp: number,
  signature: string,
) => {
  const id = env.LAB2_GUARD.idFromName("lab-2");
  const stub = env.LAB2_GUARD.get(id);
  return stub.fetch("https://guard.internal/check", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ timestamp, signature }),
  });
};

const shanghaiDate = (now: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

const visitorHash = async (request: Request) => {
  const forwardedFor = request.headers
    .get("x-forwarded-for")
    ?.split(",")[0]
    ?.trim();
  const address =
    forwardedFor || request.headers.get("cf-connecting-ip") || "unknown";
  const userAgent = request.headers.get("user-agent") || "unknown";
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${address}\n${userAgent}`),
  );
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
};

const handleViewPost = async (
  request: Request,
  env: WorkerEnv,
  now: Date,
) => {
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > 1024) {
    return errorResponse(413, "payload_too_large");
  }

  let input: unknown;
  try {
    input = JSON.parse(rawBody);
  } catch {
    return errorResponse(400, "invalid_json");
  }
  const path =
    input && typeof input === "object" && "path" in input
      ? (input as { path?: unknown }).path
      : null;
  if (
    typeof path !== "string" ||
    !path.startsWith("/") ||
    path.length > 512
  ) {
    return errorResponse(400, "invalid_path");
  }

  const id = env.LAB2_GUARD.idFromName("views");
  const stub = env.LAB2_GUARD.get(id);
  return stub.fetch("https://guard.internal/views", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      date: shanghaiDate(now),
      visitor: await visitorHash(request),
    }),
  });
};

const writeStatus = async (
  env: WorkerEnv,
  report: StatusReport,
  receivedAt: string,
) => {
  const previous = await env.LAB2_STATUS.get<StoredStatus>(LATEST_KEY, "json");
  const existing =
    previous?._heartbeats ??
    (await env.LAB2_STATUS.get<StatusHeartbeat[]>(HEARTBEATS_KEY, "json")) ??
    [];
  const heartbeats = existing
    .filter((heartbeat) => heartbeat.observedAt !== report.observedAt)
    .concat({ observedAt: report.observedAt })
    .slice(-60);
  const stored: StoredStatus = {
    ...report,
    _receivedAt: receivedAt,
    _heartbeats: heartbeats,
  };

  await env.LAB2_STATUS.put(LATEST_KEY, JSON.stringify(stored));
};

const unknownStatus = (): PublicStatus => ({
  schemaVersion: 1,
  server: {
    id: "lab-2",
    state: "unknown",
  },
  experiment: null,
  resources: {
    cpu: null,
    gpu: null,
    memory: null,
    disk: null,
  },
  health: {
    serviceRestarts: null,
    oomDetected: null,
    nanDetected: null,
  },
  observedAt: new Date(0).toISOString(),
  freshness: {
    state: "unknown",
    ageSeconds: null,
  },
  heartbeats: [],
});

const readStatus = async (env: WorkerEnv, now = new Date()) => {
  const stored = await env.LAB2_STATUS.get<StoredStatus>(LATEST_KEY, "json");
  if (!stored) return unknownStatus();
  const heartbeats =
    stored._heartbeats ??
    (await env.LAB2_STATUS.get<StatusHeartbeat[]>(HEARTBEATS_KEY, "json")) ??
    [];

  const receivedAt = Date.parse(stored._receivedAt);
  if (!Number.isFinite(receivedAt)) return unknownStatus();
  const ageSeconds = Math.max(0, Math.floor((now.getTime() - receivedAt) / 1000));
  const freshness =
    ageSeconds <= FRESH_WINDOW_SECONDS
      ? "fresh"
      : ageSeconds <= OFFLINE_WINDOW_SECONDS
        ? "stale"
        : "offline";
  const {
    _receivedAt: _internalReceivedAt,
    _heartbeats: _internalHeartbeats,
    ...report
  } = stored;

  return {
    ...report,
    server: {
      id: "lab-2" as const,
      state: freshness === "offline" ? ("offline" as const) : report.server.state,
    },
    freshness: {
      state: freshness,
      ageSeconds,
    },
    heartbeats: heartbeats.slice(-60),
  } satisfies PublicStatus;
};

const handlePost = async (request: Request, env: WorkerEnv) => {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    return errorResponse(413, "payload_too_large");
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return errorResponse(413, "payload_too_large");
  }

  const timestampHeader = request.headers.get("x-mmdedup-timestamp");
  const timestamp = Number(timestampHeader);
  const signature = parseSignature(
    request.headers.get("x-mmdedup-signature"),
  );
  if (
    !timestampHeader ||
    !Number.isInteger(timestamp) ||
    !signature ||
    !env.LAB2_HMAC_SECRET
  ) {
    return errorResponse(401, "unauthorized");
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestamp) > MAX_CLOCK_SKEW_SECONDS) {
    return errorResponse(401, "expired_signature");
  }
  if (
    !(await verifyHmac(
      env.LAB2_HMAC_SECRET,
      timestampHeader,
      rawBody,
      signature,
    ))
  ) {
    return errorResponse(401, "unauthorized");
  }

  const guard = await guardRequest(env, timestamp, signature);
  if (!guard.ok) {
    return errorResponse(guard.status, guard.status === 409 ? "replay" : "rate_limited");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return errorResponse(400, "invalid_json");
  }

  const validation = validator.validate(parsed);
  if (!validation.valid) {
    return errorResponse(400, "invalid_schema");
  }

  let report: StatusReport;
  try {
    report = sanitizeReport(parsed as StatusReport);
  } catch {
    return errorResponse(400, "invalid_progress");
  }

  await writeStatus(env, report, new Date().toISOString());
  return new Response(null, {
    status: 202,
    headers: { "cache-control": "no-store" },
  });
};

export const handleRequest = async (
  request: Request,
  env: WorkerEnv,
  now = new Date(),
) => {
  const url = new URL(request.url);
  if (url.pathname === "/api/views/track") {
    if (request.method === "POST") return handleViewPost(request, env, now);
    return errorResponse(405, "method_not_allowed");
  }
  if (url.pathname !== "/api/lab2/status") {
    return errorResponse(404, "not_found");
  }
  if (request.method === "POST") return handlePost(request, env);
  if (request.method === "GET") {
    return json(await readStatus(env, now), 200, {
      "cache-control": "public, max-age=15, stale-if-error=30",
    });
  }
  return errorResponse(405, "method_not_allowed");
};

export class LabStatusGuard {
  private readonly state: DurableObjectState;

  constructor(
    state: DurableObjectState,
    _env: WorkerEnv,
  ) {
    this.state = state;
  }

  private async trackView(request: Request) {
    const input = (await request.json()) as {
      date?: string;
      visitor?: string;
    };
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(input.date ?? "") ||
      !/^[a-f0-9]{64}$/.test(input.visitor ?? "")
    ) {
      return errorResponse(400, "invalid_view_request");
    }

    const stored =
      (await this.state.storage.get<{
        total: number;
        date: string;
        today: number;
        visitors: string[];
      }>("views")) ?? {
        total: VIEWS_BASELINE_TOTAL,
        date: input.date!,
        today: 0,
        visitors: [],
      };

    if (stored.date !== input.date) {
      stored.date = input.date!;
      stored.today = 0;
      stored.visitors = [];
    }

    const counted = !stored.visitors.includes(input.visitor!);
    if (counted) {
      stored.total += 1;
      stored.today += 1;
      stored.visitors.push(input.visitor!);
    }
    await this.state.storage.put("views", stored);

    return json(
      {
        total: stored.total,
        today: stored.today,
        date: stored.date,
        counted,
      },
      200,
      { "cache-control": "no-store" },
    );
  }

  async fetch(request: Request) {
    if (request.method !== "POST") return errorResponse(405, "method_not_allowed");
    if (new URL(request.url).pathname === "/views") {
      return this.trackView(request);
    }

    const input = (await request.json()) as {
      timestamp?: number;
      signature?: string;
    };
    if (
      !Number.isInteger(input.timestamp) ||
      typeof input.signature !== "string"
    ) {
      return errorResponse(400, "invalid_guard_request");
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const stored =
      (await this.state.storage.get<{
        requestTimes: number[];
        replays: Record<string, number>;
      }>("guard")) ?? { requestTimes: [], replays: {} };
    const requestTimes = stored.requestTimes.filter(
      (value) => nowSeconds - value < RATE_WINDOW_SECONDS,
    );
    const replays = Object.fromEntries(
      Object.entries(stored.replays).filter(
        ([, expiresAt]) => expiresAt > nowSeconds,
      ),
    );

    if (replays[input.signature]) return errorResponse(409, "replay");
    if (requestTimes.length >= RATE_LIMIT) {
      return errorResponse(429, "rate_limited");
    }

    requestTimes.push(nowSeconds);
    replays[input.signature] = nowSeconds + REPLAY_WINDOW_SECONDS;
    await this.state.storage.put("guard", { requestTimes, replays });
    return new Response(null, { status: 204 });
  }
}

export default {
  fetch(request: Request, env: WorkerEnv) {
    return handleRequest(request, env);
  },
};
