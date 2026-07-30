from __future__ import annotations

import hashlib
import hmac
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "collect_status.py"
SPEC = importlib.util.spec_from_file_location("collect_status", MODULE_PATH)
assert SPEC and SPEC.loader
collect_status = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(collect_status)


class CollectStatusTests(unittest.TestCase):
    def test_cpu_sample_and_utilization(self):
        with tempfile.TemporaryDirectory() as directory:
            stat = Path(directory) / "stat"
            stat.write_text("cpu  10 0 10 80 0 0 0 0\n", encoding="utf-8")
            self.assertEqual(collect_status.read_cpu_sample(stat), (100, 80))

        samples = iter([(100, 80), (200, 100)])
        result = collect_status.collect_cpu(lambda: next(samples))
        self.assertEqual(result["utilizationPercent"], 80.0)
        self.assertEqual(result["state"], "busy")

    def test_memory_parser(self):
        with tempfile.TemporaryDirectory() as directory:
            meminfo = Path(directory) / "meminfo"
            meminfo.write_text(
                "MemTotal:       1048576 kB\nMemAvailable:    524288 kB\n",
                encoding="utf-8",
            )
            self.assertEqual(
                collect_status.collect_memory(meminfo),
                {"usedGiB": 0.5, "totalGiB": 1.0},
            )

    def test_gpu_parser_and_active_unit_allowlist(self):
        def runner(arguments, _timeout):
            if arguments[0] == "nvidia-smi":
                return "NVIDIA GeForce RTX 3090, 0, 38, 24576, 52"
            return (
                "unrelated.service loaded active running Other\n"
                "mmdedup-public-status.service loaded active running Collector\n"
                "mmdedup-safe.service loaded active running MMdedup"
            )

        gpu = collect_status.collect_gpu(runner)
        self.assertEqual(gpu["state"], "idle")
        self.assertEqual(gpu["memoryTotalMiB"], 24576)
        self.assertEqual(
            collect_status.find_active_unit("mmdedup-", runner),
            "mmdedup-safe.service",
        )

    def test_collector_never_treats_its_own_unit_as_an_experiment(self):
        def runner(_arguments, _timeout):
            return (
                "mmdedup-public-status.service "
                "loaded active running Public status collector"
            )

        self.assertIsNone(collect_status.find_active_unit("mmdedup-", runner))

    def test_experiment_uses_only_friendly_fields_and_authoritative_progress(self):
        source = {
            "phase": {"zh": "阶段一", "en": "Phase one"},
            "task": {"zh": "安全核验", "en": "Safety verification"},
            "state": "running",
            "startedAt": "2026-07-30T20:00:00+08:00",
            "completed": 2,
            "total": 4,
            "unit": "subruns",
            "internalPath": "/must/not/leak",
            "container": "must-not-leak",
        }
        experiment = collect_status.experiment_from_source(
            source, "mmdedup-private.service"
        )
        serialized = json.dumps(experiment)
        self.assertEqual(experiment["progress"]["percent"], 50.0)
        self.assertNotIn("internalPath", serialized)
        self.assertNotIn("container", serialized)
        self.assertNotIn("mmdedup-private", serialized)

    def test_progress_is_null_when_not_authoritative(self):
        experiment = collect_status.experiment_from_source(
            {"completed": 2, "total": 0, "unit": "runs"},
            "mmdedup-safe.service",
        )
        self.assertIsNone(experiment["progress"])
        self.assertIsNone(
            collect_status.experiment_from_source({}, active_unit=None)
        )

    def test_hmac_headers_sign_exact_body(self):
        body = b'{"schemaVersion":1}'
        headers = collect_status.signature_headers(body, "secret", 123)
        expected = hmac.new(
            b"secret", b"123." + body, hashlib.sha256
        ).hexdigest()
        self.assertEqual(headers["X-MMdedup-Timestamp"], "123")
        self.assertEqual(
            headers["X-MMdedup-Signature"], f"sha256={expected}"
        )


if __name__ == "__main__":
    unittest.main()
