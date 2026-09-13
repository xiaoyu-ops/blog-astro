export type LocalizedText = {
  zh: string;
  en: string;
};

export type ExperimentProgress = {
  completed: number;
  total: number;
  percent: number;
  unit: string;
  authoritative: true;
};

export type ExperimentStatus = {
  project: "MMdedup-v2";
  campaignId?: string | null;
  taskId?: string | null;
  phase: LocalizedText;
  task: LocalizedText;
  state: "running" | "idle" | "completed" | "failed" | "unknown";
  startedAt: string | null;
  stateChangedAt?: string | null;
  progress: ExperimentProgress | null;
  failure?: {
    category: "exit_code" | "oom" | "nan" | "timeout" | "unknown";
    exitCode: number | null;
  } | null;
  runtimeEvidence?: {
    state: "active" | "inactive" | "unknown";
    activeUnitCount: number;
    source: "systemd";
  };
};

export type TelemetryStatus = {
  state: "reporting";
  trigger: "heartbeat" | "state-change" | "manual";
  source: "lab2-read-only-collector";
};

export type ResourceSample = {
  observedAt: string;
  cpuPercent: number | null;
  gpuPercent: number | null;
  memoryUsedGiB: number | null;
  diskUsedPercent: number | null;
};

export type StatusReport = {
  schemaVersion: 1;
  server: {
    id: "lab-2";
    state: "online";
  };
  telemetry?: TelemetryStatus;
  experiment: ExperimentStatus | null;
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
};

export type StatusHeartbeat = {
  observedAt: string;
};

export type StoredStatus = StatusReport & {
  _receivedAt: string;
  _heartbeats?: StatusHeartbeat[];
  _resourceSamples?: ResourceSample[];
};

export type FreshnessState = "fresh" | "stale" | "offline" | "unknown";

export type PublicStatus = Omit<StatusReport, "server"> & {
  server: {
    id: "lab-2";
    state: "online" | "offline" | "unknown";
  };
  freshness: {
    state: FreshnessState;
    ageSeconds: number | null;
  };
  heartbeats: StatusHeartbeat[];
  resourceSamples: ResourceSample[];
  collector: {
    state: "reporting" | "delayed" | "offline" | "unknown";
    trigger: "heartbeat" | "state-change" | "manual" | "unknown";
  };
};

export interface WorkerEnv {
  LAB2_GUARD: DurableObjectNamespace;
  ANALYTICS_HASH_SECRET?: string;
}
