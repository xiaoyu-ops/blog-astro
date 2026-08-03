export type LabFreshness = "fresh" | "stale" | "offline" | "unknown";

export interface LabPublicStatus {
  schemaVersion: 1;
  server: {
    id: "lab-2";
    state: "online" | "offline" | "unknown";
  };
  telemetry?: {
    state: "reporting";
    trigger: "heartbeat" | "state-change" | "manual";
    source: "lab2-read-only-collector";
  };
  collector?: {
    state: "reporting" | "delayed" | "offline" | "unknown";
    trigger: "heartbeat" | "state-change" | "manual" | "unknown";
  };
  experiment: {
    project: "MMdedup-v2";
    campaignId?: string | null;
    taskId?: string | null;
    phase: { zh: string; en: string };
    task: { zh: string; en: string };
    state: "running" | "idle" | "completed" | "failed" | "unknown";
    startedAt: string | null;
    stateChangedAt?: string | null;
    progress: {
      completed: number;
      total: number;
      percent: number;
      unit: string;
      authoritative: true;
    } | null;
    failure?: {
      category: "exit_code" | "oom" | "nan" | "timeout" | "unknown";
      exitCode: number | null;
    } | null;
    runtimeEvidence?: {
      state: "active" | "inactive" | "unknown";
      activeUnitCount: number;
      source: "systemd";
    };
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
  resourceSamples?: Array<{
    observedAt: string;
    cpuPercent: number | null;
    gpuPercent: number | null;
    memoryUsedGiB: number | null;
    diskUsedPercent: number | null;
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
      "campaignId",
      "taskId",
      "phase",
      "task",
      "state",
      "startedAt",
      "stateChangedAt",
      "progress",
      "failure",
      "runtimeEvidence",
    ]) ||
    value.project !== "MMdedup-v2" ||
    !["running", "idle", "completed", "failed", "unknown"].includes(
      String(value.state),
    ) ||
    !(value.startedAt === null || typeof value.startedAt === "string")
  ) {
    return false;
  }
  if (
    !(
      value.campaignId === undefined ||
      value.campaignId === null ||
      typeof value.campaignId === "string"
    ) ||
    !(
      value.taskId === undefined ||
      value.taskId === null ||
      typeof value.taskId === "string"
    ) ||
    !(
      value.stateChangedAt === undefined ||
      value.stateChangedAt === null ||
      typeof value.stateChangedAt === "string"
    )
  ) {
    return false;
  }
  if (value.failure !== undefined && value.failure !== null) {
    if (
      !isRecord(value.failure) ||
      !hasOnlyKeys(value.failure, ["category", "exitCode"]) ||
      !["exit_code", "oom", "nan", "timeout", "unknown"].includes(
        String(value.failure.category),
      ) ||
      !(value.failure.exitCode === null || Number.isInteger(value.failure.exitCode))
    ) {
      return false;
    }
  }
  if (value.runtimeEvidence !== undefined) {
    if (
      !isRecord(value.runtimeEvidence) ||
      !hasOnlyKeys(value.runtimeEvidence, [
        "state",
        "activeUnitCount",
        "source",
      ]) ||
      !["active", "inactive", "unknown"].includes(
        String(value.runtimeEvidence.state),
      ) ||
      !Number.isInteger(value.runtimeEvidence.activeUnitCount) ||
      (value.runtimeEvidence.activeUnitCount as number) < 0 ||
      value.runtimeEvidence.source !== "systemd"
    ) {
      return false;
    }
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
      "telemetry",
      "collector",
      "experiment",
      "resources",
      "health",
      "observedAt",
      "freshness",
      "heartbeats",
      "resourceSamples",
    ])
  ) {
    return false;
  }
  const candidate = value as unknown as LabPublicStatus;
  const resources = isRecord(candidate.resources)
    ? candidate.resources
    : null;
  const health = isRecord(candidate.health) ? candidate.health : null;
  const telemetry = candidate.telemetry;
  const collector = candidate.collector;
  const resourceSamples = candidate.resourceSamples ?? [];
  return (
    candidate.schemaVersion === 1 &&
    isRecord(candidate.server) &&
    hasOnlyKeys(candidate.server, ["id", "state"]) &&
    candidate.server?.id === "lab-2" &&
    ["online", "offline", "unknown"].includes(candidate.server.state ?? "") &&
    (telemetry === undefined ||
      (isRecord(telemetry) &&
        hasOnlyKeys(telemetry, ["state", "trigger", "source"]) &&
        telemetry.state === "reporting" &&
        ["heartbeat", "state-change", "manual"].includes(
          String(telemetry.trigger),
        ) &&
        telemetry.source === "lab2-read-only-collector")) &&
    (collector === undefined ||
      (isRecord(collector) &&
        hasOnlyKeys(collector, ["state", "trigger"]) &&
        ["reporting", "delayed", "offline", "unknown"].includes(
          String(collector.state),
        ) &&
        ["heartbeat", "state-change", "manual", "unknown"].includes(
          String(collector.trigger),
        ))) &&
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
    ) &&
    Array.isArray(resourceSamples) &&
    resourceSamples.length <= 30 &&
    resourceSamples.every(
      (sample) =>
        isRecord(sample) &&
        hasOnlyKeys(sample, [
          "observedAt",
          "cpuPercent",
          "gpuPercent",
          "memoryUsedGiB",
          "diskUsedPercent",
        ]) &&
        typeof sample.observedAt === "string" &&
        Number.isFinite(Date.parse(sample.observedAt)) &&
        isNullableFiniteNumber(sample.cpuPercent) &&
        isNullableFiniteNumber(sample.gpuPercent) &&
        isNullableFiniteNumber(sample.memoryUsedGiB) &&
        isNullableFiniteNumber(sample.diskUsedPercent)
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
    collector: {
      state:
        freshness === "fresh"
          ? "reporting"
          : freshness === "stale"
            ? "delayed"
            : freshness === "offline"
              ? "offline"
              : "unknown",
      trigger: "heartbeat",
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
    resourceSamples: [],
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

const failedExperiment: NonNullable<LabPublicStatus["experiment"]> = {
  ...runningExperiment,
  state: "failed",
  startedAt: null,
  stateChangedAt: new Date().toISOString(),
  progress: null,
  failure: { category: "exit_code", exitCode: 2 },
  runtimeEvidence: {
    state: "inactive",
    activeUnitCount: 0,
    source: "systemd",
  },
};

export const getDevelopmentFixture = () => {
  if (!import.meta.env.DEV) return null;
  const name = new URLSearchParams(window.location.search).get("labFixture");
  if (!name) return null;
  if (name === "running") return fixture("fresh", runningExperiment);
  if (name === "failed") return fixture("fresh", failedExperiment);
  if (name === "idle") return fixture("fresh", null);
  if (name === "stale") return fixture("stale", runningExperiment);
  if (name === "offline") return fixture("offline", runningExperiment);
  if (name === "unknown") return fixture("unknown", null);
  return null;
};
