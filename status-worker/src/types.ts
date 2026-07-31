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
  phase: LocalizedText;
  task: LocalizedText;
  state: "running" | "idle" | "completed" | "failed" | "unknown";
  startedAt: string | null;
  progress: ExperimentProgress | null;
};

export type StatusReport = {
  schemaVersion: 1;
  server: {
    id: "lab-2";
    state: "online";
  };
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
};

export interface WorkerEnv {
  LAB2_STATUS: KVNamespace;
  LAB2_GUARD: DurableObjectNamespace;
  LAB2_HMAC_SECRET: string;
}
