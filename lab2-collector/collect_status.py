#!/usr/bin/env python3
"""Collect a small, allowlisted LAB-2 status report and optionally publish it."""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable


DEFAULT_DISK_PATH = "/srv/experiment"
DEFAULT_STATUS_FILE = (
    "/srv/experiment/services/public-status/public-experiment-status.json"
)
DEFAULT_UNIT_PREFIX = "mmdedup-"
SELF_UNIT_NAME = "mmdedup-public-status.service"
REQUEST_TIMEOUT_SECONDS = 5
RETRY_DELAYS_SECONDS = (0, 2, 5)
AUTHORITATIVE_SOURCE = "authoritative_campaign_state"
AUTHORITATIVE_SOURCE_MAX_AGE_SECONDS = 180
COMPLETED_SOURCE_MAX_AGE_SECONDS = 24 * 60 * 60


def run_command(arguments: list[str], timeout: float = 3.0) -> str | None:
    try:
        result = subprocess.run(
            arguments,
            check=True,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except (FileNotFoundError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return None
    return result.stdout.strip()


def read_cpu_sample(path: Path = Path("/proc/stat")) -> tuple[int, int] | None:
    try:
        first_line = path.read_text(encoding="utf-8").splitlines()[0]
    except (OSError, IndexError):
        return None
    parts = first_line.split()
    if not parts or parts[0] != "cpu":
        return None
    try:
        values = [int(value) for value in parts[1:]]
    except ValueError:
        return None
    if len(values) < 4:
        return None
    idle = values[3] + (values[4] if len(values) > 4 else 0)
    return sum(values), idle


def collect_cpu(
    sample: Callable[[], tuple[int, int] | None] = read_cpu_sample,
) -> dict[str, Any] | None:
    before = sample()
    if before is None:
        return None
    time.sleep(0.1)
    after = sample()
    if after is None:
        return None
    total_delta = after[0] - before[0]
    idle_delta = after[1] - before[1]
    if total_delta <= 0:
        return None
    utilization = round(max(0.0, min(100.0, (1 - idle_delta / total_delta) * 100)), 1)
    return {
        "state": "busy" if utilization >= 20 else "idle",
        "utilizationPercent": utilization,
    }


def collect_memory(path: Path = Path("/proc/meminfo")) -> dict[str, float] | None:
    try:
        rows = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return None
    values: dict[str, int] = {}
    for row in rows:
        key, separator, raw_value = row.partition(":")
        if not separator:
            continue
        try:
            values[key] = int(raw_value.strip().split()[0])
        except (IndexError, ValueError):
            continue
    total_kib = values.get("MemTotal")
    available_kib = values.get("MemAvailable")
    if total_kib is None or available_kib is None or total_kib <= 0:
        return None
    return {
        "usedGiB": round((total_kib - available_kib) / 1024 / 1024, 1),
        "totalGiB": round(total_kib / 1024 / 1024, 1),
    }


def collect_disk(path: str = DEFAULT_DISK_PATH) -> dict[str, float] | None:
    try:
        usage = shutil.disk_usage(path)
    except OSError:
        return None
    if usage.total <= 0:
        return None
    return {
        "usedPercent": round((usage.used / usage.total) * 100, 1),
        "freeGiB": round(usage.free / 1024 / 1024 / 1024, 1),
    }


def collect_gpu(
    runner: Callable[[list[str], float], str | None] = run_command,
) -> dict[str, Any] | None:
    output = runner(
        [
            "nvidia-smi",
            "--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu",
            "--format=csv,noheader,nounits",
        ],
        3.0,
    )
    if not output:
        return None
    row = output.splitlines()[0]
    parts = [part.strip() for part in row.split(",")]
    if len(parts) != 5:
        return None
    try:
        utilization = float(parts[1])
        memory_used = float(parts[2])
        memory_total = float(parts[3])
        temperature = float(parts[4])
    except ValueError:
        return None
    return {
        "model": parts[0][:64],
        "state": "busy" if utilization >= 5 else "idle",
        "utilizationPercent": round(max(0.0, min(100.0, utilization)), 1),
        "memoryUsedMiB": round(max(0.0, memory_used), 1),
        "memoryTotalMiB": round(max(1.0, memory_total), 1),
        "temperatureC": round(temperature, 1),
    }


def find_active_unit(
    prefix: str = DEFAULT_UNIT_PREFIX,
    runner: Callable[[list[str], float], str | None] = run_command,
) -> str | None:
    output = runner(
        [
            "systemctl",
            "--user",
            "list-units",
            "--type=service",
            "--state=running,activating",
            "--no-legend",
            "--plain",
        ],
        3.0,
    )
    if not output:
        return None
    units = []
    for row in output.splitlines():
        unit = row.split(maxsplit=1)[0] if row.strip() else ""
        if (
            unit != SELF_UNIT_NAME
            and unit.startswith(prefix)
            and unit.endswith(".service")
        ):
            units.append(unit)
    return sorted(units)[0] if units else None


def unit_restart_count(
    unit: str | None,
    runner: Callable[[list[str], float], str | None] = run_command,
) -> int | None:
    if unit is None:
        return None
    value = runner(
        ["systemctl", "--user", "show", unit, "--property=NRestarts", "--value"],
        3.0,
    )
    try:
        return int(value) if value is not None else None
    except ValueError:
        return None


def load_public_experiment(path: str) -> dict[str, Any] | None:
    try:
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def localized_text(value: Any, fallback_zh: str, fallback_en: str) -> dict[str, str]:
    if not isinstance(value, dict):
        return {"zh": fallback_zh, "en": fallback_en}
    zh = value.get("zh")
    en = value.get("en")
    return {
        "zh": zh[:80] if isinstance(zh, str) and zh else fallback_zh,
        "en": en[:120] if isinstance(en, str) and en else fallback_en,
    }


def authoritative_source_is_fresh(
    source: dict[str, Any],
    *,
    now: datetime | None = None,
) -> bool:
    if source.get("telemetrySource") != AUTHORITATIVE_SOURCE:
        return False
    record_status = source.get("recordStatus")
    timestamp_key = "sourceObservedAt" if record_status == "OPEN" else "stateChangedAt"
    max_age = (
        AUTHORITATIVE_SOURCE_MAX_AGE_SECONDS
        if record_status == "OPEN"
        else COMPLETED_SOURCE_MAX_AGE_SECONDS
    )
    if record_status not in {"OPEN", "CLOSED"}:
        return False
    observed_at = source.get(timestamp_key)
    if not isinstance(observed_at, str):
        return False
    try:
        observed = datetime.fromisoformat(observed_at.replace("Z", "+00:00"))
    except ValueError:
        return False
    if observed.tzinfo is None:
        return False
    now = now or datetime.now(timezone.utc)
    age_seconds = (now - observed.astimezone(timezone.utc)).total_seconds()
    return 0 <= age_seconds <= max_age


def experiment_from_source(
    source: dict[str, Any] | None,
    active_unit: str | None,
    *,
    now: datetime | None = None,
) -> dict[str, Any] | None:
    source = source or {}
    if active_unit is None and not authoritative_source_is_fresh(source, now=now):
        return None
    state = source.get("state")
    if state not in {"running", "idle", "completed", "failed", "unknown"}:
        state = "running"
    # Campaign metadata describes workflow intent, while the active user service
    # is the runtime proof.  Do not claim that an experiment is running merely
    # because a fresh campaign record is OPEN/READY.
    if state == "running" and active_unit is None:
        state = "idle"
    elif state in {"idle", "unknown"} and active_unit is not None:
        state = "running"
    started_at = source.get("startedAt")
    if not isinstance(started_at, str):
        started_at = None

    progress = None
    completed = source.get("completed")
    total = source.get("total")
    unit = source.get("unit")
    if (
        isinstance(completed, int)
        and not isinstance(completed, bool)
        and isinstance(total, int)
        and not isinstance(total, bool)
        and 0 <= completed <= total
        and total > 0
        and isinstance(unit, str)
        and unit
    ):
        progress = {
            "completed": completed,
            "total": total,
            "percent": round(completed / total * 100, 1),
            "unit": unit[:32],
            "authoritative": True,
        }

    return {
        "project": "MMdedup-v2",
        "phase": localized_text(source.get("phase"), "当前阶段", "Current phase"),
        "task": localized_text(
            source.get("task"), "MMdedup 实验", "MMdedup experiment"
        ),
        "state": state,
        "startedAt": started_at,
        "progress": progress,
    }


def optional_boolean(source: dict[str, Any] | None, key: str) -> bool | None:
    value = source.get(key) if source else None
    return value if isinstance(value, bool) else None


def build_status(
    *,
    disk_path: str = DEFAULT_DISK_PATH,
    status_file: str = DEFAULT_STATUS_FILE,
    unit_prefix: str = DEFAULT_UNIT_PREFIX,
    runner: Callable[[list[str], float], str | None] = run_command,
) -> dict[str, Any]:
    active_unit = find_active_unit(unit_prefix, runner)
    source = load_public_experiment(status_file)
    return {
        "schemaVersion": 1,
        "server": {"id": "lab-2", "state": "online"},
        "experiment": experiment_from_source(source, active_unit),
        "resources": {
            "cpu": collect_cpu(),
            "gpu": collect_gpu(runner),
            "memory": collect_memory(),
            "disk": collect_disk(disk_path),
        },
        "health": {
            "serviceRestarts": unit_restart_count(active_unit, runner),
            "oomDetected": optional_boolean(source, "oomDetected"),
            "nanDetected": optional_boolean(source, "nanDetected"),
        },
        "observedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


def encode_report(report: dict[str, Any]) -> bytes:
    return json.dumps(
        report, ensure_ascii=False, separators=(",", ":"), sort_keys=True
    ).encode("utf-8")


def signature_headers(body: bytes, secret: str, timestamp: int) -> dict[str, str]:
    digest = hmac.new(
        secret.encode("utf-8"),
        str(timestamp).encode("ascii") + b"." + body,
        hashlib.sha256,
    ).hexdigest()
    return {
        "Content-Type": "application/json",
        "User-Agent": "lab2-public-status/1",
        "X-MMdedup-Timestamp": str(timestamp),
        "X-MMdedup-Signature": f"sha256={digest}",
    }


def publish_status(endpoint: str, secret: str, report: dict[str, Any]) -> None:
    body = encode_report(report)
    if len(body) > 8 * 1024:
        raise RuntimeError("sanitized status exceeds 8 KiB")

    last_error: Exception | None = None
    for delay in RETRY_DELAYS_SECONDS:
        if delay:
            time.sleep(delay)
        timestamp = int(time.time())
        request = urllib.request.Request(
            endpoint,
            data=body,
            headers=signature_headers(body, secret, timestamp),
            method="POST",
        )
        try:
            with urllib.request.urlopen(
                request, timeout=REQUEST_TIMEOUT_SECONDS
            ) as response:
                if response.status != 202:
                    raise RuntimeError(f"status endpoint returned {response.status}")
                return
        except (urllib.error.URLError, TimeoutError, RuntimeError) as error:
            last_error = error
    raise RuntimeError("status upload failed after short retries") from last_error


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="print sanitized JSON without sending a request",
    )
    return parser.parse_args()


def main() -> int:
    arguments = parse_arguments()
    report = build_status(
        disk_path=os.environ.get("LAB2_DISK_PATH", DEFAULT_DISK_PATH),
        status_file=os.environ.get("LAB2_EXPERIMENT_STATUS_FILE", DEFAULT_STATUS_FILE),
        unit_prefix=os.environ.get("LAB2_UNIT_PREFIX", DEFAULT_UNIT_PREFIX),
    )

    if arguments.dry_run:
        print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
        return 0

    endpoint = os.environ.get("LAB2_STATUS_ENDPOINT")
    secret = os.environ.get("LAB2_HMAC_SECRET")
    if not endpoint or not secret:
        print("missing LAB2_STATUS_ENDPOINT or LAB2_HMAC_SECRET", file=sys.stderr)
        return 2
    try:
        publish_status(endpoint, secret, report)
    except RuntimeError as error:
        print(str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
