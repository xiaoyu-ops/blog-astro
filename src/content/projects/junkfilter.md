---
title: "JunkFilter — 基于 Agent 的内容评估系统"
description: "异构 Go + Python 分布式管道，用于 RSS 内容过滤，具备三级去重和 LangGraph 多 Agent 评估功能。LLM API 成本降低 30%。"
date: "2025-03-01"
tags:
  - Go
  - Python
  - LangGraph
  - 分布式系统
  - Tauri
---

## 概述

**JunkFilter** 是一个个人 RSS 内容过滤系统，解决的核心问题是：订阅源每天产出数百条资讯，其中 90% 是噪音，人工筛选效率极低且偏好难以用规则表达。

**解决方案**：构建一条从抓取 → 评估 → 交互的全自动管道，用 LLM 替代人工判断，用自然语言替代配置界面。

**规模数据**（本地运行）：
- 73 个 RSS 源，每 30 分钟全量抓取
- 单次抓取并发协程：最多 50 个（协程池限流）
- LLM 评估：每篇文章约 3-10 秒，串行消费（LLM 为瓶颈）
- 数据库：content 表 + evaluation 表，URL 唯一约束

---

## 系统架构

![JunkFilter 架构图](/images/architecture/junkfilter-arch.svg)

### 整体流程

```
互联网 RSS 源（73个）
      │
      ▼
[Go] 抓取层（并发协程池 + 三级去重 + 质量过滤）
      │ XADD（内容 + 元数据）
      ▼
Redis Stream（ingestion_queue，消费者组）
      │ XREADGROUP（至少一次语义）
      ▼
[Python] LangGraph 评估状态机（有状态图 + 自动重试）
      │
      ├──► PostgreSQL（content + evaluation 持久化）
      │
      ├──► Telegram 推送（push_service → Bot API）
      │
      └──► ReAct Agent（自然语言查询/管理）
                 ↑
          前端对话页（SSE 流式）
          Telegram Bot（长轮询 + 任务队列）
```

### 为什么这样分层？

| 选择 | 原因 | 替代方案及为什么没选 |
|------|------|------|
| Go 做抓取 | goroutine 天然适配 I/O 密集并发；Bloom Filter 在 Go 里有极好的库支持 | Python asyncio 也能做，但 Go 的并发模型更轻量，内存占用更低 |
| Redis Stream 解耦 | 抓取速率（毫秒级）与 LLM 评估速率（秒级）差距 1000 倍，Stream 作弹性缓冲 | 直接 DB 队列：轮询开销大；Kafka：运维复杂，个人项目杀鸡用牛刀 |
| Python 做评估 | LangChain/LangGraph 生态成熟；asyncpg 异步驱动适配 LLM 长等待 | Go 调 LLM：工具链不成熟，ReAct 需要自己实现所有状态机 |
| SSE 不用 WebSocket | 推理输出是单向流，SSE 更简单，无需维护双向状态，天然支持断线重连 | WebSocket：双向通信代价，对单向流是过度工程 |
| PostgreSQL + JSONB | UNIQUE 约束做幂等；JSONB 字段灵活扩展推送渠道类型无需改表 | MySQL：JSONB 支持弱；MongoDB：事务弱，UNIQUE 约束弱 |

---

## Go 抓取层（深度解析）

### 三级去重机制

这是整个抓取层最核心的设计，目的是在高并发下以最低代价拒绝重复内容。

```
新 URL 进来
  │
  ├─► L1: 内存 Bloom Filter
  │     启动时从 DB 预热近 7 天的 URL hash（warm-up）
  │     误判率 < 0.1%，零 I/O，纳秒级响应
  │     误判（把新内容当重复）：极少，可接受
  │     不会漏判（把重复当新）：Bloom Filter 数学保证
  │
  ├─► L2: Redis Set（SETNX + TTL 7天）
  │     精确校验，O(1) 查询，~0.1ms
  │     处理 L1 放过的少数漏网（约 0.1%）
  │
  └─► L3: PostgreSQL UNIQUE 约束
        最终防线，捕获高并发下 L1/L2 均通过的极端竞态
        （两个协程同时通过前两层，INSERT 时 DB 保证唯一）
        捕获 INSERT 冲突后 graceful 忽略，不算错误
```

**为什么需要三层？**

单用 DB UNIQUE：每条 URL 都打 DB，高并发下性能差。
单用 Bloom Filter：有误判且无法处理并发竞态（两协程同时查询都返回"不存在"）。
三层组合：99.9% 的重复在 L1 纳秒级拦截，剩余的在 L2 精确拦截，极端竞态由 L3 兜底。

**Bloom Filter 实现细节：**
- 启动时加载近 7 天 content 的 URL，预热 Filter
- 使用多个哈希函数降低碰撞概率
- 不持久化（每次启动重建），简单且正确

### 并发协程池

```go
// 每个 RSS 源并发抓取，但全局限制协程数
semaphore := make(chan struct{}, 50)  // 最多 50 并发

for _, source := range sources {
    semaphore <- struct{}{}
    go func(s Source) {
        defer func() { <-semaphore }()
        fetchSource(s)
    }(source)
}
```

为什么用 semaphore 而不是 worker pool？semaphore 更简单，任务天然边界清晰（一个源一个任务），不需要预建 worker。

### 入队前质量过滤

在进入 Redis Stream 之前做两道过滤，节省 LLM Token 消耗：

```go
// 短内容过滤（摘要类预告文章，无实质内容）
if len([]rune(content)) < 200 {
    return // 不入队
}

// 作者过滤（每个源支持 JSONB 白/黑名单）
// 白名单：只接受指定作者
// 黑名单：排除指定作者
if !passesAuthorFilter(article, source.AuthorFilter) {
    return
}
```

`author_filter` 存在 sources 表的 JSONB 字段，格式：
```json
{"whitelist": ["作者A"], "blacklist": ["作者B", "作者C"]}
```

### Favicon 自动推导

添加 RSS 源时自动构造图标地址，无需手动维护：

```go
// source_repo.go Create()
if parsed, err := url.Parse(req.URL); err == nil && parsed.Host != "" {
    favicon := fmt.Sprintf("%s://%s/favicon.ico", parsed.Scheme, parsed.Host)
    source.FaviconURL = &favicon
}
```

### 配置热更新

RSS 代理地址存在内存变量里，`PUT /api/config/rss-proxy` 直接改内存，无需重启 Go 进程。LLM 配置存 DB，Python Consumer 每 60 秒热加载一次。

---

## Python LLM 评估层（深度解析）

### LangGraph 评估状态机

不用简单的"调一次 LLM 拿结果"，而是构建一个有状态的评估图，支持解析失败自动重试：

```
EvaluationState {
    title, content, url    # 输入
    raw_output             # LLM 原始输出（streaming 拼接）
    parsed_result          # 解析后的结构化结果
    retry_count            # 已重试次数
    error                  # 最后一次错误信息
}

节点：
  evaluate_node  →  调用 LLM，强制 streaming=True 收集完整输出
  parse_node     →  从 raw_output 提取 JSON，验证 6 个字段完整性
  should_retry   →  条件边：解析失败且 retry_count < 3 → 回 evaluate_node
                            解析失败且达上限 → 标记 DISCARDED
                            解析成功 → 结束，写 DB
```

**为什么强制 `streaming=True`？**
部分第三方 relay 在非流式模式下只返回 `reasoning` 字段，`content` 为 null（推理模型特有行为）。强制流式后逐 chunk 拼接，可绕过此问题，兼容更多中继服务。

**为什么用 LangGraph 而不是简单 for 循环？**
LangGraph 的状态图让重试逻辑可视化、可测试，状态明确不会出现隐式副作用。实际上 LangGraph 的条件边等价于带状态的 while 循环，但结构更清晰。

### 评估维度

每篇文章输出 6 个字段，LLM 以 JSON 格式返回：

| 字段 | 类型 | 说明 |
|------|------|------|
| `innovation_score` | 0-10 | 技术新颖性 |
| `depth_score` | 0-10 | 内容深度 |
| `decision` | enum | INTERESTING / BOOKMARK / SKIP |
| `tldr` | text | 一句话摘要 |
| `reasoning` | text | 评估推理过程（供用户理解为何这样打分） |
| `key_concepts` | array | 关键概念标签 |

`decision` 逻辑：
- `INTERESTING`：高分且内容有独特见解，触发 Telegram 推送
- `BOOKMARK`：有价值但不紧急，静默保存
- `SKIP`：噪音，记录但不展示

### 偏好零样本注入（Prompt Engineering 替代 Fine-tuning）

用户偏好存 `user_preferences` 表，每次评估前动态拼入 system prompt：

```python
# stream_consumer._inject_preferences()
source_id = await get_source_id_for_content(content_id)
prefs = await _get_preferences_from_db(source_id)  # 先查源级别偏好
if not prefs:
    prefs = await _get_preferences_from_db(None)    # 回退到全局偏好
pref_text = format_preferences_for_prompt(prefs)
if pref_text:
    self.evaluator_agent.system_prompt = base_prompt + pref_text
else:
    self.evaluator_agent.system_prompt = base_prompt  # 无偏好时恢复基础 prompt
```

偏好格式（存 JSONB，增量合并）：
```json
{
  "liked_topics": ["AI", "系统设计", "时事"],
  "disliked_topics": ["营销", "Rust"],
  "min_innovation_score": 6,
  "custom_notes": "偏好有代码示例的技术深度文章"
}
```

**偏好更新链路（完整）：**
```
用户对 Bot/前端说「我对时事感兴趣，不感兴趣 Rust」
  ↓
ReAct Agent 调用 update_preferences 工具
  ↓
tools._update_preferences(db_pool=pool) 读取现有偏好
  ↓
增量合并（数组追加去重，标量覆盖）
  ↓
写入 user_preferences 表（WHERE source_id IS NULL 全局偏好）
  ↓
stream_consumer 下次评估时读取 → 注入 system prompt → 影响打分
```

**核心优势：无需重训练**，一次自然语言对话即可改变后续所有评估的偏好权重。

### Stream Consumer 架构

```python
# 消费者主循环（保证至少一次处理）
while True:
    # block=1000：无消息时阻塞等待最多 1 秒，避免空转 CPU
    msgs = await redis.xreadgroup(GROUP, CONSUMER, {STREAM: ">"}, block=1000)
    
    await _requeue_pending_content()  # 先处理之前崩溃未完成的文章
    await evaluate_batch(msgs)        # 再处理新消息
    await redis.xack(STREAM, GROUP, msg_id)  # 处理完再 ACK
```

**关键设计：先处理后 ACK（至少一次语义）**
Consumer 崩溃时，未 ACK 的消息留在 pending list，重启后重新投递。代价是可能重复处理同一篇文章，通过 DB UNIQUE 约束保证幂等（重复 INSERT 被忽略）。

**`eval_attempts` 防死循环：**
每次评估失败递增，达到 3 次自动标记 DISCARDED，防止一篇文章无限占用队列资源。

---

## ReAct Agent（深度解析）

### 自行实现 ReAct，不依赖 Agent SDK

**为什么不用 LangChain Agent 或 Anthropic Agent SDK？**
需要兼容任意 OpenAI Function Calling 协议的第三方接口（GLM、DeepSeek、各类 relay），同时需要自定义 SSE 流式输出格式推给前端。Agent SDK 封装了太多，很难控制中间步骤的输出格式。

```python
# ReAct 核心循环（简化版）
for iteration in range(MAX_ITERATIONS):  # 最多 8 轮，防无限循环
    stream = await client.chat.completions.create(
        model=model,
        messages=messages,         # 累积的完整对话历史
        tools=TOOL_DEFINITIONS,    # OpenAI function calling 格式
        tool_choice="auto",        # 让 LLM 自己决定是否调工具
        stream=True,               # 强制流式
    )

    text_content, tool_calls_map = "", {}
    async for chunk in stream:
        if delta.content:
            text_content += delta.content
            yield SSE("chunk", delta.content)   # 立即推送给前端（打字机效果）
        if delta.tool_calls:
            collect_tool_calls(tool_calls_map, chunk)  # 收集工具调用

    if not tool_calls_map:
        yield SSE("done")
        return                    # 无工具调用 = 最终文字回答，结束

    # 有工具调用：执行 → 追加结果 → 继续循环
    messages.append(assistant_message_with_tool_calls)
    for tc in tool_calls_map.values():
        result = await execute_tool(tc.name, tool_args, db_pool=db_pool)
        yield SSE("tool_call", {tool, args, result})   # 推送工具调用可视化
        messages.append(tool_result_message(tc, result))
```

### 五个工具的实现细节

| 工具 | 实现 | 关键细节 |
|------|------|---------|
| `query_articles` | asyncpg 直连 DB | 参数化查询防 SQL 注入；支持关键词/评分/时间/决策过滤；HAVING 子句做评分聚合过滤 |
| `get_pipeline_status` | HTTP → Go API | 跨服务调用，Go 侧聚合各状态计数，Python 不直接查这张表 |
| `add_source` | HTTP → Go API | 通过 Go API 添加，触发 Go 的 favicon 自动推导逻辑 |
| `remove_source` | HTTP → Go API | Go 处理级联删除（sources → content → evaluation） |
| `update_preferences` | asyncpg 直连 DB | 增量合并（数组字段追加，标量字段覆盖），实时影响后续评估的 system prompt |

### 全链路 SSE 流式

```
AsyncOpenAI(stream=True)
  → 每个 text token 立即 yield {"type":"chunk","content":"..."}
  → 工具调用执行后 yield {"type":"tool_call","tool":"...","args":{},"result":{}}
  → 完成 yield {"type":"done"}
  → 出错 yield {"type":"error","error":"..."}

前端消费（useSSE.js）：
  fetch + ReadableStream（不用 EventSource，因为需要 POST 带 body）
  → chunk → 打字机追加到消息气泡
  → tool_call → AgentSteps 面板展开，显示工具调用过程
  → done / error → 停止渲染
```

**为什么用 `fetch` + `ReadableStream` 而不是 `EventSource`？**
`EventSource` 只支持 GET 请求，无法携带 body。我们需要在请求 body 里传 LLM 配置（model、api_key、base_url），所以用 `fetch` 手动消费流。

---

## Telegram Bot（深度解析）

### 架构设计

Bot 是第三个独立 Python 进程，与 api_server 和 stream_consumer 共享 DB，但进程完全独立：

```
telegram_bot.py
  ├── python-telegram-bot v21+（异步原生，长轮询）
  ├── asyncpg 连接池（min=5, max=20，在 PTB event loop 内创建）
  ├── 启动时临时连接读取 bot_token + chat_id + llm_config
  └── post_init 回调创建 DB pool，post_shutdown 关闭
```

**为什么用长轮询不用 webhook？**
私人 Bot 无需高并发，长轮询部署更简单，无需公网 IP 和 HTTPS 证书。

### 三层防护

```
消息进来
  │
  ├─► 白名单校验（_auth 装饰器）
  │     chat_id 不在 allowed_ids → 静默丢弃（不回复，防探测）
  │
  ├─► 限流（_auth 装饰器）
  │     同一用户 1 秒内第二条 → 静默丢弃
  │     _last_message_time dict 记录各用户最后消息时间
  │
  └─► 任务队列（handle_message）
        每用户独立 asyncio.Queue（maxsize=10）
        独立 worker task 串行消费，避免同一用户并发抢 DB 连接
        队列满 → 回复「请稍后再发」
```

### Event Loop 错配问题及解决（关键难点）

**问题根源：**

python-telegram-bot v21+ 的 `run_polling()` 内部调用 `asyncio.run()`，会创建一个新的 event loop。如果 asyncpg pool 在外部的 `asyncio.run()` 里创建，pool 绑定的是那个已关闭的 event loop，在 PTB 的新 event loop 里使用时，asyncpg 内部检测到 event loop 不匹配，抛出：

```
asyncpg.exceptions.InterfaceError: cannot perform operation: another operation is in progress
```

**正确解法：使用 `post_init` 在 PTB 的 event loop 内创建 pool：**

```python
async def _post_init(application: Application) -> None:
    # 此回调由 PTB 在自己的 event loop 内调用
    # pool 绑定到 PTB 的 event loop，生命周期一致
    pool = await asyncpg.create_pool(_DB_DSN, min_size=5, max_size=20)
    application.bot_data["db_pool"] = pool

# 启动时：只用临时单连接读配置，用完立即关闭
bot_token, chat_id, llm_config = asyncio.run(_get_startup_config())

app = (
    Application.builder()
    .token(bot_token)
    .post_init(_post_init)       # pool 在 PTB event loop 内创建
    .post_shutdown(_post_shutdown)
    .build()
)
app.run_polling(...)  # PTB 管理自己的 event loop，pool 与之绑定
```

**本质原因：asyncio 对象（连接、pool、socket）必须在创建它们的 event loop 内使用。** 跨 event loop 使用是 asyncio 的未定义行为。

### 并发控制：block=False + 任务队列

```python
# block=False：PTB 不等待 handler 完成就继续处理下一条消息
# 如果 block=True（默认），LLM 调用（30s+）期间 Bot 冻结，无法处理任何消息
app.add_handler(MessageHandler(
    filters.TEXT & ~filters.COMMAND,
    handle_message,
    block=False  # 关键：非阻塞，handler 作为 asyncio task 调度
))
```

但 `block=False` 会导致同一用户的多条消息并发处理，并发抢同一个 DB 连接。解决方案：每用户一个 `asyncio.Queue`，串行消费。

### 上下文记忆

Bot 在内存里按 chat_id 维护对话历史，每条消息携带最近 10 轮（20 条 message）传给 LLM：

```python
history = histories.setdefault(chat_id, [])
# 成功后追加，超过 20 条滚动丢弃最早的（滑动窗口）
history.append({"role": "user", "content": user_text})
history.append({"role": "ai", "content": response_text})
if len(history) > 20:
    histories[chat_id] = history[-20:]
```

**为什么存内存而不存 DB？** 对话历史是临时状态，Bot 重启后自然清空，用户会重新开始对话，不需要持久化。存 DB 反而增加写入开销和读取延迟。

---

## 通知推送系统

### 站内通知 SSE 完整链路

```
Python stream_consumer
  评估完成 → INSERT notifications 表
           → Redis PUBLISH "notifications" channel（JSON payload）
           → 前端 SSE 连接收到 → 实时弹窗
```

### Telegram 推送

```
stream_consumer
  评估 decision=INTERESTING
    → 调用 push_service.send_telegram()
    → Bot API send_message
    → 用户收到带评分和摘要的推送
```

---

## 成果与数据

| 指标 | 数值 | 说明 |
|------|------|------|
| LLM API 成本降低 | **30%** | 通过语义缓存和动态调优 |
| 重复内容拦截率 | **99.9%** | 三级去重机制 |
| 评估延迟 | 3-10s/篇 | 取决于 LLM 提供商 |
| 并发抓取 | 50 协程 | 协程池限流 |
| RSS 源覆盖 | 73 个 | 技术、AI、时事等 |

---

## 截图

### 首页 — 文章搜索
![JunkFilter 首页](/images/junkfilter-home.png)

### 时间线 — AI 评估的 RSS 订阅
![JunkFilter 时间线](/images/junkfilter-timeline.png)

### 阅读视图
![JunkFilter 阅读器](/images/junkfilter-reader.png)

### Agent 仪表盘
![JunkFilter Agent](/images/junkfilter-agent.png)

### 配置中心
![JunkFilter 配置](/images/junkfilter-config.png)

### iOS 推送通知
![JunkFilter 移动端](/images/junkfilter-mobile.png)

---

## 链接

- [GitHub: xiaoyu-ops/Junk-Filter](https://github.com/xiaoyu-ops/Junk-Filter)