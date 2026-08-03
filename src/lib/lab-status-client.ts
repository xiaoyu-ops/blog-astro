import {
  getDevelopmentFixture,
  isLabPublicStatus,
  type LabFreshness,
  type LabPublicStatus,
} from "./lab-status";

const stateCopy: Record<
  LabFreshness,
  { zh: string; en: string }
> = {
  fresh: { zh: "在线", en: "LIVE" },
  stale: { zh: "数据延迟", en: "STALE" },
  offline: { zh: "未上报", en: "OFFLINE" },
  unknown: { zh: "暂不可用", en: "UNKNOWN" },
};

const setText = (
  root: HTMLElement,
  name: string,
  chinese: string,
  english = chinese,
) => {
  const zh = root.querySelector<HTMLElement>(`[data-lab-${name}-zh]`);
  const en = root.querySelector<HTMLElement>(`[data-lab-${name}-en]`);
  if (zh) zh.textContent = chinese;
  if (en) en.textContent = english;
};

const number = (value: number | null | undefined, suffix = "") =>
  typeof value === "number" && Number.isFinite(value)
    ? `${Math.round(value * 10) / 10}${suffix}`
    : "—";

const booleanHealth = (
  value: boolean | null,
  healthyZh: string,
  healthyEn: string,
  detectedZh: string,
  detectedEn: string,
) =>
  value === null
    ? { zh: "未记录", en: "Not reported" }
    : value
      ? { zh: detectedZh, en: detectedEn }
      : { zh: healthyZh, en: healthyEn };

const formatUpdated = (status: LabPublicStatus) => {
  const observedAt = Date.parse(status.observedAt);
  if (!Number.isFinite(observedAt) || observedAt <= 0) {
    return { zh: "等待首次上报", en: "Waiting for the first report" };
  }
  const date = new Date(observedAt);
  const age = status.freshness.ageSeconds;
  if (typeof age === "number") {
    if (age < 60) {
      return { zh: `${age} 秒前上报`, en: `Reported ${age}s ago` };
    }
    const minutes = Math.floor(age / 60);
    if (minutes < 60) {
      return { zh: `${minutes} 分钟前上报`, en: `Reported ${minutes}m ago` };
    }
  }
  return {
    zh: `更新 ${date.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    })}`,
    en: `Updated ${date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    })}`,
  };
};

const renderTrend = (
  root: HTMLElement,
  selector: string,
  values: Array<number | null>,
  peakSelector: string,
) => {
  const container = root.querySelector<HTMLElement>(selector);
  const peak = root.querySelector<HTMLElement>(peakSelector);
  if (!container) return;
  container.replaceChildren();
  for (const value of values) {
    const bar = document.createElement("i");
    bar.setAttribute("aria-hidden", "true");
    bar.style.setProperty(
      "--bar-height",
      typeof value === "number" ? `${Math.max(0, Math.min(100, value))}%` : "2px",
    );
    container.append(bar);
  }
  const numeric = values.filter((value): value is number => typeof value === "number");
  if (peak) peak.textContent = numeric.length ? `峰值 ${Math.round(Math.max(...numeric))}%` : "—";
};

const experimentStateCopy = (
  state: NonNullable<LabPublicStatus["experiment"]>["state"],
) => {
  const values = {
    running: { zh: "运行中", en: "Running" },
    idle: { zh: "空闲", en: "Idle" },
    completed: { zh: "已完成", en: "Completed" },
    failed: { zh: "异常", en: "Failed" },
    unknown: { zh: "状态未知", en: "Status unknown" },
  } as const;
  return values[state];
};

const formatDuration = (startedAt: string | null) => {
  const started = startedAt ? Date.parse(startedAt) : Number.NaN;
  if (!Number.isFinite(started) || started > Date.now()) {
    return { zh: "时长未知", en: "Duration unknown" };
  }
  const minutes = Math.max(0, Math.floor((Date.now() - started) / 60_000));
  if (minutes < 60) {
    return { zh: `已运行 ${minutes} 分钟`, en: `Running for ${minutes} min` };
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) {
    return {
      zh: `已运行 ${hours} 小时 ${remainingMinutes} 分钟`,
      en: `Running for ${hours}h ${remainingMinutes}m`,
    };
  }
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return {
    zh: `已运行 ${days} 天 ${remainingHours} 小时`,
    en: `Running for ${days}d ${remainingHours}h`,
  };
};

const renderExperimentProgress = (
  root: HTMLElement,
  experiment: LabPublicStatus["experiment"],
) => {
  const container = root.querySelector<HTMLElement>("[data-lab-progress]");
  if (!container) return;
  const progress = experiment?.progress;
  if (!progress?.authoritative) {
    container.hidden = true;
    return;
  }
  const percent = Math.max(0, Math.min(100, progress.percent));
  container.hidden = false;
  const copy = container.querySelector<HTMLElement>("[data-lab-progress-copy]");
  const track = container.querySelector<HTMLElement>("[data-lab-progress-track]");
  const fill = container.querySelector<HTMLElement>("[data-lab-progress-fill]");
  if (copy) {
    copy.textContent = `${progress.completed} / ${progress.total} ${progress.unit} · ${percent}%`;
  }
  track?.setAttribute("aria-valuenow", String(percent));
  fill?.style.setProperty("--lab-progress", `${percent}%`);
};

const renderHeartbeats = (root: HTMLElement, status: LabPublicStatus) => {
  const grid = root.querySelector<HTMLElement>("[data-lab-heartbeats]");
  if (!grid) return;
  const cells = Array.from(grid.children) as HTMLElement[];
  const minutes = new Set(
    status.heartbeats.map((heartbeat) =>
      Math.floor(Date.parse(heartbeat.observedAt) / 60_000),
    ),
  );
  const nowMinute = Math.floor(Date.now() / 60_000);
  let reported = 0;
  cells.forEach((cell, index) => {
    const minute = nowMinute - (cells.length - 1 - index);
    const hit = minutes.has(minute);
    cell.classList.toggle("is-reported", hit);
    cell.classList.toggle("is-gap", !hit);
    if (hit) reported += 1;
  });
  const zh = `最近 60 分钟收到 ${reported} 次上报`;
  const en = `${reported} reports received in the last 60 minutes`;
  grid.dataset.languageAriaZh = zh;
  grid.dataset.languageAriaEn = en;
  grid.setAttribute(
    "aria-label",
    document.documentElement.dataset.lang === "en" ? en : zh,
  );
};

const renderStatus = (
  root: HTMLElement,
  status: LabPublicStatus,
  previousObservedAt: string | null,
) => {
  const freshness = status.freshness.state;
  root.dataset.state = freshness;
  setText(root, "state", stateCopy[freshness].zh, stateCopy[freshness].en);

  const experiment = status.experiment;
  setText(
    root,
    "task",
    experiment?.task.zh ?? "未收到实验状态",
    experiment?.task.en ?? "Experiment status not reported",
  );
  setText(
    root,
    "phase",
    experiment ? `MMdedup-v2 · ${experiment.phase.zh}` : "MMdedup-v2",
    experiment ? `MMdedup-v2 · ${experiment.phase.en}` : "MMdedup-v2",
  );

  const cpu = status.resources.cpu;
  const gpu = status.resources.gpu;
  const gpuStateZh =
    gpu?.state === "busy"
      ? "GPU 忙碌"
      : gpu?.state === "idle"
        ? "GPU 空闲"
        : "GPU 未知";
  const gpuStateEn =
    gpu?.state === "busy"
      ? "GPU busy"
      : gpu?.state === "idle"
        ? "GPU idle"
        : "GPU unknown";
  setText(
    root,
    "summary",
    `主机 CPU ${number(cpu?.utilizationPercent, "%")} · ${gpuStateZh}`,
    `Host CPU ${number(cpu?.utilizationPercent, "%")} · ${gpuStateEn}`,
  );

  const updated = formatUpdated(status);
  setText(root, "updated", updated.zh, updated.en);
  setText(
    root,
    "server-value",
    status.server.state === "online"
      ? "在线"
      : status.server.state === "offline"
        ? "未上报"
        : "未知",
    status.server.state === "online"
      ? "Online"
      : status.server.state === "offline"
        ? "Offline"
        : "Unknown",
  );
  setText(
    root,
    "experiment-value",
    experiment
      ? experimentStateCopy(experiment.state).zh
      : "未同步",
    experiment
      ? experimentStateCopy(experiment.state).en
      : "Not reported",
  );
  const collectorState = status.collector?.state ??
    (freshness === "fresh"
      ? "reporting"
      : freshness === "stale"
        ? "delayed"
        : freshness === "offline"
          ? "offline"
          : "unknown");
  const collectorCopy = {
    reporting: { zh: "正常上报", en: "Reporting" },
    delayed: { zh: "上报延迟", en: "Delayed" },
    offline: { zh: "链路中断", en: "Offline" },
    unknown: { zh: "状态未知", en: "Unknown" },
  } as const;
  setText(
    root,
    "collector-value",
    collectorCopy[collectorState].zh,
    collectorCopy[collectorState].en,
  );
  const trigger = root.querySelector<HTMLElement>("[data-lab-collector-trigger]");
  if (trigger) {
    trigger.textContent =
      status.collector?.trigger === "state-change"
        ? "事件即时上报"
        : status.collector?.trigger === "heartbeat"
          ? "定时心跳"
          : "上报来源未知";
  }
  const cpuBusy = (cpu?.utilizationPercent ?? 0) >= 20;
  const gpuBusy = (gpu?.utilizationPercent ?? 0) >= 5;
  setText(
    root,
    "workload-value",
    gpuBusy ? (cpuBusy ? "CPU＋GPU任务" : "GPU任务") : cpuBusy ? "CPU任务" : "资源空闲",
    gpuBusy ? (cpuBusy ? "CPU + GPU job" : "GPU job") : cpuBusy ? "CPU job" : "Resources idle",
  );
  const runState = experiment
    ? experimentStateCopy(experiment.state)
    : { zh: "实验状态未同步", en: "Experiment status not reported" };
  const duration = experiment
    ? formatDuration(experiment.startedAt)
    : { zh: "时长未知", en: "Duration unknown" };
  setText(root, "run-state", runState.zh, runState.en);
  setText(root, "duration", duration.zh, duration.en);
  renderExperimentProgress(root, experiment);
  const failureLine = root.querySelector<HTMLElement>("[data-lab-failure]");
  if (failureLine) {
    const failure = experiment?.failure;
    const failed = experiment?.state === "failed";
    failureLine.hidden = !failed;
    if (failed) {
      const category = failure?.category ?? "unknown";
      const exit = failure?.exitCode;
      setText(
        root,
        "failure",
        `实验失败 · ${category}${typeof exit === "number" ? ` · 退出码 ${exit}` : ""}`,
        `Experiment failed · ${category}${typeof exit === "number" ? ` · exit ${exit}` : ""}`,
      );
    }
  }
  setText(
    root,
    "cpu-value",
    number(cpu?.utilizationPercent, "%"),
  );
  setText(
    root,
    "gpu-value",
    gpu
      ? `${number(gpu.utilizationPercent, "%")} · ${number(gpu.memoryUsedMiB, " MiB")}`
      : "—",
  );
  setText(
    root,
    "memory-value",
    status.resources.memory
      ? `${number(status.resources.memory.usedGiB)} / ${number(status.resources.memory.totalGiB)} GiB`
      : "—",
  );
  setText(
    root,
    "disk-value",
    status.resources.disk
      ? `${number(status.resources.disk.usedPercent, "%")} · ${number(status.resources.disk.freeGiB, " GiB")}`
      : "—",
    status.resources.disk
      ? `${number(status.resources.disk.usedPercent, "%")} · ${number(status.resources.disk.freeGiB, " GiB")}`
      : "—",
  );
  setText(
    root,
    "restart-value",
    status.health.serviceRestarts === null
      ? "未记录"
      : `${status.health.serviceRestarts} 次`,
    status.health.serviceRestarts === null
      ? "Not reported"
      : `${status.health.serviceRestarts}`,
  );
  const oom = booleanHealth(
    status.health.oomDetected,
    "正常",
    "Normal",
    "检测到 OOM",
    "OOM detected",
  );
  const nan = booleanHealth(
    status.health.nanDetected,
    "正常",
    "Normal",
    "检测到 NaN",
    "NaN detected",
  );
  setText(root, "oom-value", oom.zh, oom.en);
  setText(root, "nan-value", nan.zh, nan.en);
  renderHeartbeats(root, status);
  const samples = status.resourceSamples ?? [];
  renderTrend(root, "[data-lab-cpu-trend]", samples.map((sample) => sample.cpuPercent), "[data-lab-cpu-peak]");
  renderTrend(root, "[data-lab-gpu-trend]", samples.map((sample) => sample.gpuPercent), "[data-lab-gpu-peak]");

  if (
    previousObservedAt &&
    previousObservedAt !== status.observedAt &&
    freshness === "fresh"
  ) {
    root.classList.remove("has-new-data");
    requestAnimationFrame(() => root.classList.add("has-new-data"));
    window.setTimeout(() => root.classList.remove("has-new-data"), 700);
  }
};

const fetchStatus = async () => {
  const fixture = getDevelopmentFixture();
  if (fixture) return fixture;

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch("/api/lab2/status", {
      headers: { accept: "application/json" },
      credentials: "same-origin",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("status request failed");
    const value: unknown = await response.json();
    if (!isLabPublicStatus(value)) throw new Error("unsupported status schema");
    return value;
  } finally {
    window.clearTimeout(timeout);
  }
};

const roots = Array.from(
  document.querySelectorAll<HTMLElement>("[data-lab-status-root]"),
);

if (roots.length > 0) {
  let lastStatus: LabPublicStatus | null = null;
  let loading = false;

  const refresh = async () => {
    if (loading || document.visibilityState === "hidden") return;
    loading = true;
    try {
      const status = await fetchStatus();
      roots.forEach((root) =>
        renderStatus(root, status, lastStatus?.observedAt ?? null),
      );
      lastStatus = status;
    } catch {
      if (lastStatus) {
        const unavailable: LabPublicStatus = {
          ...lastStatus,
          freshness: { state: "unknown", ageSeconds: null },
        };
        roots.forEach((root) =>
          renderStatus(root, unavailable, lastStatus?.observedAt ?? null),
        );
      } else {
        roots.forEach((root) => {
          root.dataset.state = "unknown";
          setText(root, "state", "暂不可用", "UNKNOWN");
          setText(root, "task", "状态暂不可用", "Status unavailable");
        });
      }
    } finally {
      loading = false;
    }
  };

  void refresh();
  window.setInterval(() => void refresh(), 30_000);
  window.addEventListener("focus", () => void refresh());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void refresh();
  });
}
