# LAB-2 private Netdata

The pinned user service starts Netdata with host metrics and Docker discovery,
but publishes its dashboard only on `127.0.0.1:19999`. It is intentionally not
part of the public status API.

Access it from a trusted Mac with an SSH tunnel:

```bash
ssh -N -L 19999:127.0.0.1:19999 lab-2-linux
```

Then open `http://127.0.0.1:19999`. Do not change the unit to `0.0.0.0` or add a
public reverse proxy. The image digest is pinned so a restart cannot silently
upgrade the monitoring agent.
