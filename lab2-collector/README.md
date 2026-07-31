# LAB-2 public status collector

This collector reads a small allowlist of LAB-2 resource and experiment signals,
builds a sanitized v1 status report, and sends it to the public status Worker.

## Safety boundary

- No inbound port is opened.
- The collector cannot start, stop, restart, or edit an experiment.
- It does not upload logs, paths, service names, container names, commands, or
  data samples.
- Missing or non-authoritative values are sent as `null`.
- The real HMAC secret belongs only in the Worker Secret and the LAB-2
  `public-status.env` file with mode `0600`.

## Pre-deployment checks

```bash
python3 -m unittest discover -s tests
python3 collect_status.py --dry-run
```

Inspect the dry-run JSON before creating `public-status.env` or enabling the
timer. Install the unit templates under `~/.config/systemd/user/`, then run the
service once manually before enabling `mmdedup-public-status.timer`.

The timer publishes every two minutes. Combined with the Worker's single KV
write per report, this stays below the free-tier daily KV write limit while
remaining inside the three-minute `fresh` window.
