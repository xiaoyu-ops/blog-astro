# LAB-2 状态组件运行手册

本文档记录实现后的本地验证、部署顺序和回滚边界。规格与产品决策见
`LAB2_SERVER_STATUS_WIDGET_SPEC.md`，实施前信息见
`LAB2_SERVER_STATUS_WIDGET_INFO_CHECKLIST.md`。

## 本地验证

```bash
pnpm install
pnpm test
pnpm build
pnpm dev
```

开发环境可用查询参数切换固定前端样板：

- `/?labFixture=running`
- `/?labFixture=idle`
- `/?labFixture=stale`
- `/?labFixture=offline`
- `/?labFixture=unknown`
- `/?labFixture=failed`
- `/lab-status/?labFixture=running`

这些 fixture 只在 `import.meta.env.DEV` 为真时生效，不会进入公网状态逻辑。

## 部署顺序

1. 部署 Worker，但保持首页尚未发布。
2. 创建 KV、确认 Durable Object migration 和精确路由。
3. 通过 `wrangler secret put LAB2_HMAC_SECRET` 设置 Worker 端密钥。
4. 在 LAB-2 安装采集器，先执行 `--dry-run`，再手动运行一次 service。
5. 确认签名 POST/GET 和字段脱敏后启用 timer。
6. 启用 `mmdedup-public-status.path`，修改权威状态文件副本并验证15秒内事件上报。
7. 演练 `LIVE → STALE → OFFLINE → LIVE`，不得触碰实验服务。
8. 核验外部看门狗的状态去重和恢复通知测试。
9. 核验Netdata只监听`127.0.0.1:19999`。
10. 公网API与同刻SSH状态一致后发布站点前端；不要求额外24小时观察。

## 明确的完成边界

- 本地测试通过，不代表 Cloudflare 已部署。
- Worker 部署成功，不代表 LAB-2 已稳定上报。
- Git push 或托管 CI 成功，不代表公网可见。
- 公网完成需要分别核验 API、首页、详情页、桌面端和 375px 手机端。

## 回滚

- 采集器异常：禁用并停止 `mmdedup-public-status.timer`，不操作实验服务。
- Worker 异常：撤销精确路由或回滚 Worker 版本。
- 前端异常：只回滚前端提交，Worker 与采集器可继续运行。
- 密钥疑似泄漏：同时轮换 Worker secret 与 LAB-2 的 `0600` 环境文件。

`.graphify/`、`output/` 和任何 secret 文件都不得进入本功能提交。
