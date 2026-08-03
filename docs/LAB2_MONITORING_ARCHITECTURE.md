# LAB-2 监控架构

## 目标

个人主页是公开、脱敏的状态投影，不是运维后台。权威状态分为四层：

1. 服务器：由 Cloudflare 收到 LAB-2 心跳的时间判断。
2. 采集链路：由 Worker 接收时间和采集触发类型判断。
3. 实验：由 campaign 状态文件描述意图，由 systemd 活动服务证明运行事实。
4. 资源：由 `/proc`、`nvidia-smi` 和目标文件系统的只读采样提供。

任何一层不得代替另一层。GPU 空闲不能证明实验空闲；服务器在线也不能证明实验成功。

## 数据链

```text
campaign state file ──PathChanged──┐
                                   ├─ LAB-2 read-only collector
2-minute heartbeat timer ──────────┘       │ HMAC signed POST
                                           ▼
                              Cloudflare Worker + KV
                                │              │
                       public status GET    1-minute watchdog
                                │              └─ optional webhook
                                ▼
                       homepage + /lab-status/

LAB-2 private operations: Netdata bound to localhost only, reached by SSH/Tailscale.
```

## 时效性

- campaign状态变化：目标15秒内进入公开API。
- 正常资源心跳：每120秒，外加最多5秒随机延迟。
- `fresh`：Worker最近180秒内收到上报。
- `stale`：181–600秒。
- `offline`：超过600秒。
- 页面：每30秒刷新，重新聚焦时立即刷新。

## 公开契约

继续使用兼容的`schemaVersion: 1`，新增字段保持可选，允许先部署Worker再部署采集器：

- `telemetry`：只读采集器及heartbeat/state-change/manual触发类型。
- `collector`：reporting/delayed/offline/unknown。
- `experiment.campaignId/taskId/stateChangedAt`。
- `experiment.failure`：安全失败类别和可选退出码。
- `experiment.runtimeEvidence`：systemd证据状态及活动单元数量，不含真实单元名。
- `resourceSamples`：最多30个公开降采样点，用于最近一小时CPU/GPU趋势。

仍禁止公开IP、用户名、路径、systemd单元名、容器名、命令、日志、环境变量和数据样本。

## 外部看门狗

Cloudflare每分钟独立计算`ok/delayed/offline/experiment_failed/unknown`。只有状态转换才写入告警状态，避免重复通知。Worker已经实现固定收件人的`LAB2_ALERT_EMAIL`和可选`LAB2_ALERT_WEBHOOK_URL`；正式邮件发送必须先在Cloudflare Email Service中为`xiaoyu666.cyou`启用Email Sending。未完成账户级发件域授权前保持渠道未绑定，watchdog仍正常计算与去重，但不伪装为已发送通知。

## 私有详细监控

Netdata只绑定LAB-2的`127.0.0.1:19999`，不开放公网。通过SSH端口转发或Tailscale内的受控入口查看。公开主页只接收降采样摘要，不直接代理Netdata。

## 关闭门禁

- 本地站点、Worker、采集器测试全部通过。
- Astro构建通过。
- LAB-2的timer与path unit均active。
- 状态文件变化能触发即时上报。
- 公开API与同刻SSH资源、systemd和实验状态一致。
- Netdata只监听localhost。
- 无需24小时观察期；以上即时验收通过即可关闭实施阶段。
