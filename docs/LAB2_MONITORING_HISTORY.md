# LAB-2 监控开发历史

本文档只追加，不改写已经记录的操作。

## 2026-08-03：公开监控真实性升级开始

- 决策：不整体替换现有签名推送和个人主页；采用“公开状态投影＋私有详细监控＋外部看门狗”。
- 用户要求：取消24小时观察期，以自动化测试、故障模拟和同刻实机对账关闭任务。
- 开始状态：`main`与`origin/main`均为`b44d27e`，工作区干净；公开API显示LAB-2在线、实验失败、GPU空闲，与SSH核验一致。
- 修改：采集器增加状态文件变化事件上报、campaign身份、安全失败字段、systemd运行证据和上报触发类型。
- 修改：Worker增加采集链路状态、最多30个资源降采样点、每分钟外部看门狗和状态转换去重Webhook。
- 修改：详情页增加服务器、采集链路、实验和资源活动分层，显示相对上报年龄、安全失败信息及一小时CPU/GPU趋势。
- 测试：站点14项、Worker12项、采集器13项全部通过；Astro生产构建通过。
- Graphify：TypeScript运行时已确认，但`.graphify/graph.json`缺失；本轮影响范围以源码、测试和实机证据为准，阶段关闭后再更新图谱。
- 待完成：部署Worker、LAB-2 path unit与采集器；安装仅localhost可访问的Netdata；故障模拟、线上页面与公开API对账。

## 2026-08-03：部署与即时验收

- Cloudflare Worker已部署，Version ID：`9d8cdbe3-602c-4d3b-884d-4d7a618c2004`；精确路由保持`/api/lab2/status*`，一分钟cron已生效。
- LAB-2采集器SHA-256：`9632be42d65b25f77a681ba15410ce7e94204dfca65ef78200b84fd09e2f2f4c`。
- `mmdedup-public-status.timer`与`mmdedup-public-status.path`均为`active/waiting`。
- 实机事件测试：只改变权威状态文件mtime，不改变内容；约2秒后公开API的`observedAt`更新，`collector.trigger=state-change`，事件service退出码0。
- Netdata镜像固定为`netdata/netdata@sha256:689145f603fed0ca341b4d8a0fb9910cd9d8c0590b0530cd24ae1912a9c7f8f3`。
- Netdata user service为`active/running`、`NRestarts=0`、容器healthy；只监听`127.0.0.1:19999`。API发现约2000张主机/容器图表，`nvidia_smi`采集器已提供GPU利用率、显存、温度、功耗和时钟图表。
- 站点提交`587127535729c74bfb9359af7d80f9fb50f2f8ee`已推送到`origin/main`；公网HTML已包含采集链路、最近一小时趋势和安全失败区域。
- 375px手机验收：文档宽度与视口均为375px，无横向溢出；失败fixture正确显示“实验失败、退出码2”。
- 最终同刻对账（2026-08-03 22:35:55 CST）：API freshness 22秒、collector reporting、实验failed且systemd活动单元0；API GPU 0%/38 MiB/53°C与`nvidia-smi`一致；API磁盘18.3%、约2822 GiB可用，与主机`df`的四舍五入显示一致。
- 自动验证：站点14项、Worker12项、采集器14项全部通过；Astro生产构建通过；`git diff --check`通过。
- 外部看门狗状态计算、状态转换去重、恢复事件和Webhook发送均有自动测试。`LAB2_ALERT_WEBHOOK_URL`尚未设置，因为用户尚未选择通知目的地；这不影响网页、freshness或外部cron检测，但在配置前不会产生站外通知。
- 关闭决定：用户明确取消24小时观察期；以上即时验收满足本轮关闭门禁。

## 2026-08-03 监控字段与通知渠道闭环修订

- campaign runner和公开状态适配器新增权威任务开始时间、任务计数进度以及安全失败类别/退出码；当前v18失败任务已从systemd证据回填为开始于`2026-08-03T13:37:02Z`、进度`0/1 task`、`exit_code=2`。
- LAB-2容器回归测试`12 passed`，公开API已验证上述字段完整出现，未公开日志、命令或路径。
- Cloudflare Email绑定部署成功，但真实发送返回`could not find account config of sending domain`；当前Wrangler令牌访问Email Sending管理API返回`Unauthorized (2036)`。
- ntfy随机主题作为备用渠道完成真实测试，但Cloudflare出口收到HTTP 429，判定不可靠并撤回，不作为生产告警方案。
- 因此通知代码已就绪但渠道保持未绑定；待账户所有者在Cloudflare Email Service启用`xiaoyu666.cyou`的Email Sending后，再绑定固定收件人并执行一次真实邮件验收。
- 稳定Worker版本`7ccebd13-d956-4739-88bc-3051e14c8de5`已部署；站点14项、Worker13项、采集器14项和Astro生产构建全部通过。下一cron周期将看门狗状态恢复为真实的`experiment_failed`，证明定时计算与状态转换去重未被通知渠道影响。
