# LAB-2 实验状态组件实施规格

> 用途：交给个人主页项目直接实施。  
> 目标站点：`https://blog.xiaoyu666.cyou/`  
> 目标仓库：`/Users/wuzhuoyang/code/blog-astro`  
> 数据来源：LAB-2 上的 MMdedup-v2 实验状态  
> 状态：待实现

## 1. 要解决的问题

目前需要通过对话和 SSH 临时核验 LAB-2，才能知道：

- 服务器是否在线；
- 当前有没有实验在运行；
- 正在运行哪项实验、完成到哪里；
- GPU 空闲是“没有任务”，还是当前任务主要使用 CPU/磁盘；
- 是否出现 OOM、NaN、服务重启或磁盘风险；
- 结果最后一次在什么时候更新。

目标是在个人主页提供一个可信、轻量、不会泄露服务器内部信息的状态入口。

首页只展示一眼能读懂的摘要；点击后可进入 `/lab-status/` 查看更多资源和实验进度。它不是运维后台，不展示原始日志、SSH 地址、内部目录或密钥。

## 2. 已确认的现状

### 个人主页

- 技术栈：Astro 7 + Tailwind CSS 4。
- 主页文件：`src/pages/index.astro`。
- 已有组件：右侧 `NOW / 正在进行`，数据来自 `src/data/now.json`。
- 已有测试：
  - `scripts/homepage-now.test.mjs`
  - `scripts/homepage-analytics.test.mjs`
  - `scripts/site-language.test.mjs`
- 已有中英文切换，新增文案必须同时提供中文和英文。
- 当前仓库是静态站点，浏览器不能也不应该直接 SSH 到 LAB-2。
- 公网当前位于 Cloudflare 后面，`/api/views/track` 已能返回 JSON；但该 API 的服务端源码不在当前仓库，实施前必须确认它由 Cloudflare Worker、Vercel Function 还是其他服务维护。

### LAB-2

- 对外显示名称：`LAB-2`。
- GPU：RTX 3090 24GB。
- 正式实验目录：`/srv/experiment`。
- 实验以 `systemd --user`、Docker、机器可读结果文件持续执行。
- SSH 别名 `lab-2-linux` 只供维护端使用，禁止出现在公网页面或公开 JSON 中。

### 最近一次已核验状态

以下只是 2026-07-30 15:35 CST 的历史快照，不能作为网页的实时数据：

- 当前任务：文本 100K 验证；
- 子任务进度：2/4；
- 已完成的 seed 42：候选召回率 100%，700 个安全样本 0 误删；
- GPU 利用率 0%，因为当时任务主要使用 CPU 和磁盘；
- 服务无重启、无 OOM/NaN；
- 实验盘使用率约 17%。

这组事实说明组件必须把“服务器状态”“任务状态”和“GPU 状态”分开，不能用 GPU 利用率推断是否有任务。

## 3. 推荐的最终形态

采用“首页摘要卡 + 详情页”的组合，不单独建立一套重型监控网站。

### 首页摘要卡

放在现有 `NOW` 组件内部，位于当前事项列表和“已归档”之间：

```text
┌────────────────────────────────┐
│ LAB-2                      ● LIVE│
│ 文本 100K 验证                  │
│ 2 / 4  ██████████░░░░░░  50%   │
│ CPU 忙碌 · GPU 空闲 · 磁盘 17%  │
│ 18 秒前更新               查看 › │
└────────────────────────────────┘
```

显示规则：

- 第一行：`LAB-2` + `LIVE / STALE / OFFLINE / UNKNOWN`。
- 第二行：当前实验的友好名称，不展示内部 service/container 名。
- 第三行：只有存在权威的 `completed/total` 时才显示百分比。
- 第四行：明确区分 CPU、GPU 和磁盘。
- 第五行：最后更新时间和详情入口。
- 如果任务没有可靠进度，只显示“运行中 · 已运行 4 小时”，禁止根据文件大小猜百分比。

### 详情页 `/lab-status/`

详情页提供：

- 当前实验：项目、阶段、任务、开始时间、可靠进度；
- 资源：CPU、GPU、显存、内存、实验盘；
- 健康：服务重启次数、OOM、NaN、采集延迟；
- 最近 60 分钟心跳条；
- 最近一次完成的实验摘要；
- 数据口径和最后更新时间。

详情页仍不展示：

- IP、SSH 主机名、用户名；
- `/srv/...` 等内部路径；
- systemd unit、Docker container 的真实名称；
- 原始命令和日志；
- Git 凭据、Token、环境变量；
- 数据集中的个人或敏感信息。

## 4. 视觉方向

### 设计原则

- 延续现有首页克制、轻量、个人化的风格，不做成 Grafana 式后台。
- 使用现有 CSS 变量、边框、字体和圆角，不引入新的 UI 框架。
- 唯一的标志性元素是“最近 60 分钟心跳轨道”：60 个细格代表最近 60 次采样。
- 动效只用于新鲜数据到达时的轻微脉冲，并遵守 `prefers-reduced-motion`。

### 状态颜色

- `LIVE`：沿用站点前景色，配低饱和绿色状态点。
- `STALE`：琥珀色，文案“数据延迟”。
- `OFFLINE`：低饱和红色，文案“服务器未上报”。
- `UNKNOWN`：灰色，文案“状态暂不可用”。

颜色只是辅助，所有状态必须有文字和图标，不能只依赖颜色。

### 可参考的交互

- GitHub Status：明确区分总状态、组件状态和历史状态；
  `https://www.githubstatus.com/`
- Better Stack Uptime：强调最后检测时间、故障与恢复；
  `https://betterstack.com/uptime`
- Uptime Kuma：轻量的服务状态与心跳历史；
  `https://github.com/louislam/uptime-kuma`

只借鉴信息层级，不复制它们的完整视觉体系。

## 5. 安全的数据链

推荐架构：

```text
LAB-2 只读采集器
        │ 每 60 秒，出站 HTTPS
        ▼
状态写入 API
        │ 校验签名、字段和时间
        ▼
KV / Durable Object / 小型持久存储
        │ 公开只读、脱敏 JSON
        ▼
个人主页首页卡 + /lab-status/
```

核心要求：

1. LAB-2 只主动向外发送状态，不开放新的公网入站端口。
2. 浏览器永远不能持有写入密钥。
3. 状态 API 必须在服务端计算新鲜度。
4. 超过 3 分钟没有新上报时，页面不能继续显示绿色 `LIVE`。
5. API 故障时显示 `UNKNOWN`，不能沿用缓存并伪装为实时。

### 后端选择

优先顺序：

1. 如果现有 `/api/views/track` 的服务端可维护，在同一后端增加 `/api/lab2/status`。
2. 如果现有后端不可维护，新建独立 Cloudflare Worker，并绑定 `/api/lab2/status*` 路由。
3. 不使用频繁 Git commit 更新 JSON。
4. 不让公网页面直接访问 Tailscale 或 SSH。

## 6. API 契约

### 写入接口

```http
POST /api/lab2/status
Content-Type: application/json
X-MMdedup-Timestamp: 1785400000
X-MMdedup-Signature: sha256=<HMAC_SHA256>
```

签名内容：

```text
timestamp + "." + raw_request_body
```

服务端要求：

- 时间偏差不得超过 5 分钟；
- 防止相同时间戳和签名重放；
- 请求体不超过 8 KB；
- 严格校验 JSON Schema；
- 写接口限流；
- 写密钥只存于服务端环境变量和 LAB-2 的权限 `0600` 环境文件；
- 日志不得记录签名或请求头中的秘密。

### 读取接口

```http
GET /api/lab2/status
```

返回：

```json
{
  "schemaVersion": 1,
  "server": {
    "id": "lab-2",
    "state": "online"
  },
  "experiment": {
    "project": "MMdedup-v2",
    "phase": "text-100k",
    "task": "文本 100K 乱序审计",
    "state": "running",
    "startedAt": "2026-07-30T11:53:58+08:00",
    "progress": {
      "completed": 2,
      "total": 4,
      "percent": 50,
      "unit": "subruns",
      "authoritative": true
    }
  },
  "resources": {
    "cpu": {
      "state": "busy",
      "utilizationPercent": 99.8
    },
    "gpu": {
      "model": "RTX 3090",
      "state": "idle",
      "utilizationPercent": 0,
      "memoryUsedMiB": 38,
      "memoryTotalMiB": 24576,
      "temperatureC": 54
    },
    "memory": {
      "usedGiB": 7.5,
      "totalGiB": 62
    },
    "disk": {
      "usedPercent": 17,
      "freeGiB": 2969
    }
  },
  "health": {
    "serviceRestarts": 0,
    "oomDetected": false,
    "nanDetected": false
  },
  "observedAt": "2026-07-30T15:35:00+08:00",
  "freshness": {
    "state": "fresh",
    "ageSeconds": 18
  }
}
```

字段规则：

- `freshness` 必须由读取 API 根据当前服务端时间计算，不能相信采集器自行声称 `fresh`。
- `progress.percent` 必须由 `completed/total` 计算。
- 不存在权威总量时，整个 `progress` 可为 `null`。
- 缺少某个资源字段时返回 `null`，前端必须优雅降级。
- 公开返回中不得出现原始 hostname、路径、service、container、command 或 log。

### 缓存

- API：`Cache-Control: public, max-age=15, stale-if-error=30`。
- 前端：页面可见时每 30 秒刷新一次。
- 页面重新获得焦点时立即刷新。
- 单次请求超时 5 秒。
- 采集间隔 60 秒。
- `ageSeconds > 180` 时强制显示 `STALE/OFFLINE`，不能显示 `LIVE`。

## 7. LAB-2 采集器

采集器只执行白名单内的只读命令：

- GPU：`nvidia-smi --query-gpu=... --format=csv,noheader,nounits`
- CPU：读取 `/proc/stat`，用两次采样计算利用率
- 内存：读取 `/proc/meminfo`
- 磁盘：`df -P /srv/experiment`
- 服务：只读取明确允许的 MMdedup systemd unit 状态
- 实验进度：优先读取 campaign/run 产生的机器可读状态文件

不要：

- 扫描整个磁盘；
- 上传原始日志；
- 上传目录列表；
- 上传数据集名称或样本内容；
- 根据 SQLite 文件大小、输出文件数或 GPU 利用率猜任务进度；
- 为了状态页启动或停止实验。

### 权威进度来源

每个实验最好额外生成：

```json
{
  "schemaVersion": 1,
  "displayNameZh": "文本 100K 乱序审计",
  "displayNameEn": "Text 100K shuffle audit",
  "state": "running",
  "completed": 2,
  "total": 4,
  "unit": "subruns",
  "startedAt": "2026-07-30T11:53:58+08:00",
  "updatedAt": "2026-07-30T15:35:00+08:00"
}
```

只有这个文件或 campaign runner 明确提供 `completed/total` 时，网页才显示进度百分比。

### systemd 建议

- `mmdedup-public-status.service`：执行一次采集和上报。
- `mmdedup-public-status.timer`：每 60 秒触发一次。
- 网络失败使用短退避重试，但不能阻塞实验。
- 采集器本身无权启动、停止或修改实验。
- 上报失败只写本地日志，不重新启用此前已停用的 GPU 空闲通知。

## 8. 前端状态机

```text
LOADING
  ├─ fresh + experiment running → LIVE / 运行中
  ├─ fresh + no experiment      → LIVE / 当前无实验
  ├─ age 181–600s               → STALE / 数据延迟
  ├─ age >600s                  → OFFLINE / 未收到上报
  └─ request/schema error       → UNKNOWN / 状态暂不可用
```

重要语义：

- GPU `idle` + experiment `running`：显示“任务运行中 · GPU 空闲”，不能显示“服务器空闲”。
- 没有任务 + GPU `idle`：显示“当前无实验”。
- 服务器在线但采集器异常：显示“状态数据延迟”，不能推断实验已停止。
- 失败和异常必须保留“最后更新于”。

## 9. 实现文件建议

个人主页仓库：

```text
src/
├── components/
│   ├── LabStatusCard.astro
│   └── LabStatusDetails.astro
├── lib/
│   ├── lab-status-schema.ts
│   └── lab-status-client.ts
└── pages/
    ├── index.astro
    └── lab-status.astro

scripts/
└── lab-status.test.mjs
```

后端若独立放在同一仓库：

```text
status-worker/
├── src/index.ts
├── wrangler.toml
├── package.json
└── test/
```

LAB-2：

```text
/srv/experiment/services/public-status/
├── collect_status.py
├── public-status.env
└── schema.json
```

不要把 `public-status.env`、Token 或签名秘密提交到 Git。

## 10. 实施顺序

### 第 1 步：确认后端归属

- 查清 `/api/views/track` 当前由谁提供。
- 确认能否增加 GET/POST `/api/lab2/status`。
- 决定使用现有后端还是独立 Cloudflare Worker。

### 第 2 步：先做假数据组件

- 用固定 fixture 实现首页卡和详情页。
- 完成中英文、移动端、错误和过期状态。
- 此时不连接 LAB-2。

### 第 3 步：实现并测试状态 API

- 写入签名校验；
- JSON Schema 校验；
- 服务端新鲜度；
- 公开响应脱敏；
- 重放、限流和异常测试。

### 第 4 步：部署 LAB-2 采集器

- 先在终端打印脱敏 JSON；
- 人工确认公开字段；
- 再配置写入密钥和 systemd timer；
- 观察至少 10 次连续上报。

### 第 5 步：端到端接入

- 首页卡读取真实 API；
- 断开采集器验证 stale/offline；
- 恢复后验证自动回到 live；
- 检查不会影响正在运行的实验。

### 第 6 步：发布与公网验证

- `pnpm test`
- `pnpm build`
- 提交并推送 `main`
- 等待公网部署
- 分别用桌面和 375px 手机视口验证线上页面
- 公网检查 JSON 中不存在敏感字段

## 11. 验收清单

### 正确性

- [ ] 新鲜数据正确显示 `LIVE`。
- [ ] 3 分钟未更新不再显示 `LIVE`。
- [ ] API 失败显示 `UNKNOWN`。
- [ ] GPU 空闲不会被解释成“无任务”。
- [ ] 只有权威 `completed/total` 才显示百分比。
- [ ] 时间统一保存 ISO 8601，页面按用户本地时区显示。

### 安全

- [ ] LAB-2 没有新增公网入站端口。
- [ ] 浏览器包中没有写密钥。
- [ ] 公共 JSON 没有 IP、SSH 名称、路径、service/container 名或日志。
- [ ] 写请求有 HMAC、时间窗、防重放和限流。
- [ ] 密钥可单独轮换。

### 前端

- [ ] 中文和英文都完整。
- [ ] 375px、768px、桌面端不溢出。
- [ ] 键盘可访问，状态不只靠颜色。
- [ ] 支持 `prefers-reduced-motion`。
- [ ] 页面首次加载和轮询失败时不产生明显布局跳动。
- [ ] 现有 NOW、访问统计、语言切换测试继续通过。

### 端到端

- [ ] 连续 10 次 60 秒上报成功。
- [ ] 停止采集器后 3 分钟内进入 `STALE`。
- [ ] 恢复采集器后自动回到 `LIVE`。
- [ ] 状态采集不会启动、停止或重跑实验。
- [ ] 线上页面而不只是本地构建已验证。

## 12. 实施前还需要确认的资料

个人主页任务需要确认以下事项：

1. `/api/views/track` 的后端平台和源码位置；
2. 对 Cloudflare 或 Vercel 项目的部署权限；
3. 状态 API 最终使用同域 `/api/lab2/status`，还是独立子域；
4. 是否接受首页摘要卡 + `/lab-status/` 详情页的组合；
5. 详情页是否公开展示“MMdedup-v2”项目名；
6. 是否需要最近 60 分钟心跳历史，还是只保留当前状态；
7. 状态页面是否完全公开，或仅向持有链接的人展示。

推荐默认值：

- 同域 `/api/lab2/status`；
- 首页摘要 + 公开详情页；
- 公开项目名和阶段名，但隐藏所有内部标识；
- 保留最近 60 分钟心跳；
- 不发送空闲通知，只提供网页状态；
- 每 60 秒采集、每 30 秒前端刷新、3 分钟判定 stale。

## 13. 非目标

本功能不负责：

- 替代 Grafana/Prometheus；
- 远程控制实验；
- 启停 Docker/systemd；
- 展示原始实验日志；
- 通知 GPU 空闲；
- 扫描 Windows 或 LAB-2 全盘；
- 判断算法是否优越；
- 自动修改实验历史文档。

它只负责以安全、可解释的方式，把 LAB-2 的当前运行事实展示到个人主页。
