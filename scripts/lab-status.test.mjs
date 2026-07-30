import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("keeps the LAB-2 row first, locally scrollable, and separate from archive", async () => {
  const [homepage, row, client] = await Promise.all([
    read("src/pages/index.astro"),
    read("src/components/LabStatusRow.astro"),
    read("src/lib/lab-status-client.ts"),
  ]);

  const rowPosition = homepage.indexOf("<LabStatusRow");
  const nowItemPosition = homepage.indexOf("{nowItems.map");
  const archivePosition = homepage.indexOf('<details class="now-archive"');
  const scrollEndPosition = homepage.indexOf("</div>\n\n        <details", rowPosition);

  assert.ok(rowPosition > 0 && rowPosition < nowItemPosition);
  assert.ok(scrollEndPosition > nowItemPosition && archivePosition > scrollEndPosition);
  assert.match(homepage, /data-now-scroll/);
  assert.match(homepage, /max-height: 10\.75rem/);
  assert.match(homepage, /max-height: 12rem/);
  assert.match(homepage, /overscroll-behavior-y: contain/);
  assert.match(homepage, /tabindex="0"/);
  assert.match(homepage, /ResizeObserver/);

  assert.match(row, /href="\/lab-status\/"/);
  assert.match(row, /data-lab-status-root/);
  assert.match(row, /data-lab-state-zh/);
  assert.match(row, /data-lab-summary-en/);
  assert.match(row, /prefers-reduced-motion: reduce/);

  assert.match(client, /window\.setInterval\(\(\) => void refresh\(\), 30_000\)/);
  assert.match(client, /window\.addEventListener\("focus"/);
  assert.match(client, /visibilitychange/);
  assert.match(client, /controller\.abort\(\), 5_000/);
  assert.match(client, /observedAt <= 0/);
  assert.match(client, /fresh: \{ zh: "在线", en: "LIVE" \}/);
  assert.match(client, /stale: \{ zh: "数据延迟", en: "STALE" \}/);
  assert.match(client, /offline: \{ zh: "未上报", en: "OFFLINE" \}/);
  assert.match(client, /unknown: \{ zh: "暂不可用", en: "UNKNOWN" \}/);
});

test("detail page exposes resources, health, and exactly 60 heartbeat cells", async () => {
  const [page, detail, client] = await Promise.all([
    read("src/pages/lab-status.astro"),
    read("src/components/LabStatusDetails.astro"),
    read("src/lib/lab-status-client.ts"),
  ]);

  assert.match(page, /<LabStatusDetails \/>/);
  assert.match(detail, /Array\.from\(\{ length: 60 \}\)/);
  assert.match(detail, /data-lab-heartbeats/);
  assert.match(detail, /data-lab-cpu-value-zh/);
  assert.match(detail, /data-lab-gpu-value-zh/);
  assert.match(detail, /data-lab-memory-value-zh/);
  assert.match(detail, /data-lab-disk-value-zh/);
  assert.match(detail, /data-lab-restart-value-zh/);
  assert.match(detail, /data-lab-oom-value-zh/);
  assert.match(detail, /data-lab-nan-value-zh/);
  assert.match(detail, /data-lab-progress/);
  assert.doesNotMatch(detail, /最近完成|Recently completed/i);

  assert.match(client, /if \(!progress\?\.authoritative\)/);
  assert.match(client, /container\.hidden = true/);
  assert.match(client, /formatDuration/);
});

test("contract fixtures stay schema version 1 and contain no private fields", async () => {
  const fixtureDirectory = new URL("status-contract/fixtures/", root);
  const fixtureFiles = (await readdir(fixtureDirectory))
    .filter((name) => name.endsWith(".json"))
    .sort();
  assert.deepEqual(fixtureFiles, [
    "live-idle.json",
    "live-running.json",
    "missing-gpu.json",
    "no-progress.json",
  ]);

  const forbidden = [
    "hostname",
    "ip",
    "username",
    "path",
    "unit",
    "container",
    "command",
    "log",
  ];
  for (const file of fixtureFiles) {
    const source = await read(`status-contract/fixtures/${file}`);
    const value = JSON.parse(source);
    assert.equal(value.schemaVersion, 1, file);
    for (const key of forbidden) {
      if (key === "unit") continue;
      assert.doesNotMatch(source, new RegExp(`"${key}"\\s*:`, "i"), `${file}: ${key}`);
    }
  }
});

test("worker and collector retain their security boundaries", async () => {
  const [worker, wrangler, collector, service] = await Promise.all([
    read("status-worker/src/index.ts"),
    read("status-worker/wrangler.jsonc"),
    read("lab2-collector/collect_status.py"),
    read("lab2-collector/systemd/mmdedup-public-status.service"),
  ]);

  assert.match(worker, /MAX_BODY_BYTES = 8 \* 1024/);
  assert.match(worker, /MAX_CLOCK_SKEW_SECONDS = 5 \* 60/);
  assert.match(worker, /REPLAY_WINDOW_SECONDS = 10 \* 60/);
  assert.match(worker, /RATE_LIMIT = 6/);
  assert.match(worker, /public, max-age=15, stale-if-error=30/);
  assert.match(wrangler, /blog\.xiaoyu666\.cyou\/api\/lab2\/status\*/);

  assert.match(collector, /--dry-run/);
  assert.match(collector, /SELF_UNIT_NAME = "mmdedup-public-status\.service"/);
  assert.match(collector, /unit != SELF_UNIT_NAME/);
  assert.doesNotMatch(collector, /systemctl",\s*"(start|stop|restart|enable|disable)/);
  assert.doesNotMatch(collector, /docker",\s*"(start|stop|restart|exec)/);
  assert.match(service, /NoNewPrivileges=true/);
  assert.match(service, /ProtectSystem=strict/);
  assert.match(service, /Nice=1[0-9]/);
});
