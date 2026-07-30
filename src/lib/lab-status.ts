export type LabFreshness = "fresh" | "stale" | "offline" | "unknown";

export interface LabPublicStatus {
  schemaVersion: 1;
  server: {
    id: "lab-2";
    state: "online" | "offline" | "unknown";
  };
  experiment: {
    project: "MMdedup-v2";
    phase: { zh: string; en: string };
    task: { zh: string; en: string };
    state: "running" | "idle" | "completed" | "failed" | "unknown";
    startedAt: string | null;
    progress: {
      completed: number;
      total: number;
      percent: number;
      unit: string;
      authoritative: true;
    } | null;
  } | null;
  resources: {
    cpu: {
      state: "busy" | "idle" | "unknown";
      utilizationPercent: number;
    } | null;
    gpu: {
      model: string;
      state: "busy" | "idle" | "unavailable" | "unknown";
      utilizationPercent: number;
      memoryUsedMiB: number;
      memoryTotalMiB: number;
      temperatureC: number | null;
    } | null;
    memory: {
      usedGiB: number;
      totalGiB: number;
    } | null;
    disk: {
      usedPercent: number;
      freeGiB: number;
    } | null;
  };
  health: {
    serviceRestarts: number | null;
    oomDetected: boolean | null;
    nanDetected: boolean | null;
  };
  observedAt: string;
  freshness: {
    state: LabFreshness;
    ageSeconds: number | null;
  };
  heartbeats: Array<{
    observedAt: string;
  }>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const hasOnlyKeys = (value: Record<string, unknown>, allowed: string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));

const isNullableFiniteNumber = (value: unknown) =>
  value === null || (typeof value === "number" && Number.isFinite(value));

const isPercent = (value: unknown) =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 100;

const isCpu = (value: unknown) =>
  value === null ||
  (isRecord(value) &&
    hasOnlyKeys(value, ["state", "utilizationPercent"]) &&
    ["busy", "idle", "unknown"].includes(String(value.state)) &&
    isPercent(value.utilizationPercent));

const isGpu = (value: unknown) =>
  value === null ||
  (isRecord(value) &&
    hasOnlyKeys(value, [
      "model",
      "state",
      "utilizationPercent",
      "memoryUsedMiB",
      "memoryTotalMiB",
      "temperatureC",
    ]) &&
    typeof value.model === "string" &&
    ["busy", "idle", "unavailable", "unknown"].includes(
      String(value.state),
    ) &&
    isPercent(value.utilizationPercent) &&
    typeof value.memoryUsedMiB === "number" &&
    value.memoryUsedMiB >= 0 &&
    typeof value.memoryTotalMiB === "number" &&
    value.memoryTotalMiB > 0 &&
    isNullableFiniteNumber(value.temperatureC));

const isMemory = (value: unknown) =>
  value === null ||
  (isRecord(value) &&
    hasOnlyKeys(value, ["usedGiB", "totalGiB"]) &&
    typeof value.usedGiB === "number" &&
    value.usedGiB >= 0 &&
    typeof value.totalGiB === "number" &&
    value.totalGiB > 0);

const isDisk = (value: unknown) =>
  value === null ||
  (isRecord(value) &&
    hasOnlyKeys(value, ["usedPercent", "freeGiB"]) &&
    isPercent(value.usedPercent) &&
    typeof value.freeGiB === "number" &&
    value.freeGiB >= 0);

const isExperiment = (value: unknown) => {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  if (
    !hasOnlyKeys(value, [
      "project",
      "phase",
      "task",
      "state",
      "startedAt",
      "progress",
    ]) ||
    value.project !== "MMdedup-v2" ||
    !["running", "idle", "completed", "failed", "unknown"].includes(
      String(value.state),
    ) ||
    !(value.startedAt === null || typeof value.startedAt === "string")
  ) {
    return false;
  }
  for (const localized of [value.phase, value.task]) {
    if (
      !isRecord(localized) ||
      !hasOnlyKeys(localized, ["zh", "en"]) ||
      typeof localized.zh !== "string" ||
      typeof localized.en !== "string"
    ) {
      return false;
    }
  }
  if (value.progress === null) return true;
  if (!isRecord(value.progress)) return false;
  return (
    hasOnlyKeys(value.progress, [
      "completed",
      "total",
      "percent",
      "unit",
      "authoritative",
    ]) &&
    Number.isInteger(value.progress.completed) &&
    (value.progress.completed as number) >= 0 &&
    Number.isInteger(value.progress.total) &&
    (value.progress.total as number) >= 1 &&
    (value.progress.completed as number) <= (value.progress.total as number) &&
    isPercent(value.progress.percent) &&
    typeof value.progress.unit === "string" &&
    value.progress.authoritative === true
  );
};

export const isLabPublicStatus = (value: unknown): value is LabPublicStatus => {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "schemaVersion",
      "server",
      "experiment",
      "resources",
      "health",
      "observedAt",
      "freshness",
      "heartbeats",
    ])
  ) {
    return false;
  }
  const candidate = value as unknown as LabPublicStatus;
  const resources = isRecord(candidate.resources)
    ? candidate.resources
    : null;
  const health = isRecord(candidate.health) ? candidate.health : null;
  return (
    candidate.schemaVersion === 1 &&
    isRecord(candidate.server) &&
    hasOnlyKeys(candidate.server, ["id", "state"]) &&
    candidate.server?.id === "lab-2" &&
    ["online", "offline", "unknown"].includes(candidate.server.state ?? "") &&
    isExperiment(candidate.experiment) &&
    Boolean(resources) &&
    hasOnlyKeys(resources!, ["cpu", "gpu", "memory", "disk"]) &&
    isCpu(candidate.resources.cpu) &&
    isGpu(candidate.resources.gpu) &&
    isMemory(candidate.resources.memory) &&
    isDisk(candidate.resources.disk) &&
    Boolean(health) &&
    hasOnlyKeys(health!, ["serviceRestarts", "oomDetected", "nanDetected"]) &&
    isNullableFiniteNumber(candidate.health.serviceRestarts) &&
    [true, false, null].includes(candidate.health.oomDetected) &&
    [true, false, null].includes(candidate.health.nanDetected) &&
    typeof candidate.observedAt === "string" &&
    Number.isFinite(Date.parse(candidate.observedAt)) &&
    isRecord(candidate.freshness) &&
    hasOnlyKeys(candidate.freshness, ["state", "ageSeconds"]) &&
    ["fresh", "stale", "offline", "unknown"].includes(
      candidate.freshness?.state ?? "",
    ) &&
    isNullableFiniteNumber(candidate.freshness.ageSeconds) &&
    (candidate.freshness.ageSeconds === null ||
      (Number.isInteger(candidate.freshness.ageSeconds) &&
        candidate.freshness.ageSeconds >= 0)) &&
    Array.isArray(candidate.heartbeats) &&
    candidate.heartbeats.length <= 60 &&
    candidate.heartbeats.every(
      (heartbeat) =>
        isRecord(heartbeat) &&
        hasOnlyKeys(heartbeat, ["observedAt"]) &&
        typeof heartbeat.observedAt === "string" &&
        Number.isFinite(Date.parse(heartbeat.observedAt)),
    )
  );
};

const fixture = (
  freshness: LabFreshness,
  experiment: LabPublicStatus["experiment"],
): LabPublicStatus => {
  const now = new Date();
  const ageSeconds =
    freshness === "fresh"
      ? 18
      : freshness === "stale"
        ? 240
        : freshness === "offline"
          ? 720
          : null;
  const observedAt =
    ageSeconds === null
      ? new Date(0).toISOString()
      : new Date(now.getTime() - ageSeconds * 1000).toISOString();
  const heartbeats = Array.from({ length: 54 }, (_, index) => ({
    observedAt: new Date(now.getTime() - (59 - index) * 60_000).toISOString(),
  }));

  return {
    schemaVersion: 1,
    server: {
      id: "lab-2",
      state:
        freshness === "offline"
          ? "offline"
          : freshness === "unknown"
            ? "unknown"
            : "online",
    },
    experiment,
    resources: {
      cpu: {
        state: experiment ? "busy" : "idle",
        utilizationPercent: experiment ? 82.4 : 5.2,
      },
      gpu: {
        model: "RTX 3090",
        state: "idle",
        utilizationPercent: 0,
        memoryUsedMiB: 38,
        memoryTotalMiB: 24576,
        temperatureC: 52,
      },
      memory: {
        usedGiB: 7.5,
        totalGiB: 62,
      },
      disk: {
        usedPercent: 17,
        freeGiB: 2908,
      },
    },
    health: {
      serviceRestarts: experiment ? 0 : null,
      oomDetected: experiment ? false : null,
      nanDetected: experiment ? false : null,
    },
    observedAt,
    freshness: {
      state: freshness,
      ageSeconds,
    },
    heartbeats: freshness === "unknown" ? [] : heartbeats,
  };
};

const runningExperiment: NonNullable<LabPublicStatus["experiment"]> = {
  project: "MMdedup-v2",
  phase: {
    zh: "文本规模验证",
    en: "Text-scale validation",
  },
  task: {
    zh: "文本 100K 乱序审计",
    en: "Text 100K shuffle audit",
  },
  state: "running",
  startedAt: new Date(Date.now() - 52 * 60_000).toISOString(),
  progress: {
    completed: 2,
    total: 4,
    percent: 50,
    unit: "subruns",
    authoritative: true,
  },
};

export const getDevelopmentFixture = () => {
  if (!import.meta.env.DEV) return null;
  const name = new URLSearchParams(window.location.search).get("labFixture");
  if (!name) return null;
  if (name === "running") return fixture("fresh", runningExperiment);
  if (name === "idle") return fixture("fresh", null);
  if (name === "stale") return fixture("stale", runningExperiment);
  if (name === "offline") return fixture("offline", runningExperiment);
  if (name === "unknown") return fixture("unknown", null);
  return null;
};
