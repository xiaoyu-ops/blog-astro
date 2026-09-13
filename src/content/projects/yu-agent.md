---
title: "yu_agent"
titleEn: "yu_agent: Rebuilding the Core Pieces to Understand Agents"
description: "一个学习阶段的 Python Agent 框架：实现统一 LLM 接口、四类 Agent、工具与 MCP、分层记忆和 RAG，也诚实记录尚未解决的路由与自修正问题。"
descriptionEn: "A learning-stage Python agent framework implementing a unified LLM interface, four agent types, tools and MCP, layered memory, and RAG—along with its unresolved routing and self-correction limits."
date: "2025-01-01"
order: 3
tags:
  - Python
  - Agent
  - RAG
  - MCP
  - Qdrant
  - Neo4j
tagsEn:
  - Python
  - Agent
  - RAG
  - MCP
  - Qdrant
  - Neo4j
---

## 为什么又写一个 Agent 框架

yu_agent 是一个学习阶段的项目，设计参考《Hello Agents》教材，再把 Memory、RAG、MCP 和多模型适配补进同一套 Python 代码里。

使用成熟框架可以很快搭出 Demo，但很多关键过程被封装在组件内部：模型究竟收到了哪些消息、工具结果如何回填、ReAct 为什么会停、长期记忆怎样参与下一次生成。这个项目选择把这些环节显式写出来，目的不是替代 LangChain 或 LangGraph，而是建立一套可以逐行跟踪的 Agent 心智模型。

当前仓库版本为 **0.1.3 / Alpha**。它适合作为学习、实验和二次开发的基础，不应被描述成经过生产负载验证的通用 Agent 平台。

---

## 代码里的真实结构

![yu_agent 的 LLM、Agent、工具、协议、上下文与记忆模块](/images/architecture/yu-agent-arch.svg)

框架主要由五部分组成：

- `AgentsLLM`：把多家 OpenAI-compatible API 收敛为统一调用接口；
- `Simple / ReAct / Reflection / PlanAndSolve`：四个独立 Agent 类；
- `ToolRegistry`：注册、描述和执行本地工具；
- `MCPClient / MCPServer`：通过 FastMCP 连接或暴露外部工具；
- `MemoryManager + ContextBuilder`：管理工作、情景、语义记忆并组装上下文。

旧页面写了“根据任务动态切换四种推理模式”，但源码中并没有这样一个自动路由器。四种模式是四个可单独实例化的 Agent，应该由调用方明确选择。

---

## 统一 LLM 接口：解决配置差异，不假装自动容灾

`AgentsLLM` 基于 OpenAI Python SDK。它支持 OpenAI、DeepSeek、Qwen、ModelScope、Kimi、智谱、Ollama、vLLM 和通用本地接口，通过以下顺序确定 provider：

1. 专用环境变量；
2. API Key 的少量格式特征；
3. `base_url` 的域名或本地端口；
4. `auto` 通用配置回退。

```python
llm = AgentsLLM(
    model="deepseek-chat",
    provider="deepseek",
)
```

这层抽象减少了改模型时重复处理认证、Base URL 和默认模型的代码，但它不是真正的动态模型路由：

- provider 在实例创建时确定，运行期间不会按任务复杂度自动换模型；
- 没有针对 429、超时或供应商故障的 fallback chain；
- Key 前缀并不能可靠区分所有 OpenAI-compatible 服务，显式传入 provider 更安全。

因此页面不再使用“自动选择最优模型”或“8+ 提供商智能路由”这类超出实现的表述。

---

## 四种 Agent，其实是四种不同的控制流

### SimpleAgent

最短路径：整理消息后直接调用模型。它适合普通问答，也是验证 LLM 配置是否正确的最小入口。

### ReActAgent

ReAct 使用 `Thought → Action → Observation` 文本协议。模型从 Prompt 中读取工具描述，输出 `tool_name[input]`；框架执行工具，把 Observation 追加到历史后继续下一轮。默认 `max_steps=5`，达到上限就停止。

```text
Question
   ↓
Thought + Action
   ├─ Finish[...] → return
   └─ tool[input] → execute → Observation → next step
```

它的优点是过程透明，缺点也很直接：输出解析依赖格式，模型稍微偏离约定就会终止；如果连续调用相同工具和参数，目前只能等到 `max_steps` 熔断，尚未实现状态哈希和主动纠偏。

### ReflectionAgent

Reflection 先生成初稿，再让模型给出批评并据此改写，最多进行配置的迭代次数。如果反馈中出现“无需改进”或对应英文句子，就提前停止。

这是一种 LLM-as-Critic 的应用层循环，能够展示“生成—检查—修订”的基本结构，但它并不等于基于测试或 Schema 的可靠自修正。

### PlanAndSolveAgent

Planner 先要求模型输出 Python 列表，再通过 `ast.literal_eval` 解析；Executor 按顺序执行每一步，并把已有结果带给下一步。

它适合观察计划分解如何影响后续上下文，也暴露了一个典型脆弱点：模型如果没有返回指定代码块，计划会解析失败。更稳健的版本应使用结构化输出和 Pydantic 校验，而不是继续扩大正则或字符串兼容逻辑。

---

## 工具与 MCP：把“能调用”拆成几层

本地工具实现统一的名称、描述和执行接口，由 `ToolRegistry` 管理。仓库内包含计算器、搜索、终端、笔记、记忆与 RAG 等示例工具。

MCP 是可选协议层：

- `MCPClient` 支持内存、脚本命令以及 HTTP / SSE 等连接方式；
- `MCPServer` 基于 FastMCP 注册 tool、resource 和 prompt；
- MCP 工具可以展开成框架内部的独立工具，再交给 ReAct 或 SimpleAgent 使用。

仓库里还保留了 Selenium MCP 示例，用来验证“外部工具发现 → 参数调用 → 结果回填”这条链路。它是协议实验，不代表框架已经具备浏览器任务的权限隔离、审计和生产级恢复能力。

---

## 记忆不是一个向量库

当前 `MemoryManager` 默认管理三类记忆，并可选启用感知记忆：

| 类型 | 主要职责 | 典型存储 |
| --- | --- | --- |
| Working | 当前任务的短期信息，受容量和 token 上限约束 | 内存 |
| Episodic | 带时间、会话和事件属性的经历 | SQLite + Qdrant 索引 |
| Semantic | 概念、规则和可复用知识 | 文档存储、向量与图关系 |
| Perceptual（可选） | 外部观察或感知片段 | 具体实现可替换 |

工作记忆默认容量为 10、总预算为 2,000 token、TTL 为 120 分钟。重要工作记忆可以迁移到情景记忆；语义记忆则通过 Qdrant 做相似检索，并可借助 Neo4j 查实体关系。

### 一次检索是怎样进入 Prompt 的

`ContextBuilder` 从当前消息、记忆和 RAG 结果中收集候选，过滤过低相关度，再使用相关性、时效性和 MMR 控制重复内容，最后在 token 预算内组装上下文。

这比把向量库返回值全部粘进 Prompt 更可控，但仍有两个需要继续改进的地方：

- `MemoryManager.retrieve_memories()` 汇总各类型结果后主要按 importance 排序，可能掩盖子模块已经计算的相似度；
- 记忆自动分类目前包含关键词启发式，适合演示，不适合复杂知识治理。

旧页面把 Qdrant 与 Neo4j 写成固定 `0.7 : 0.3` 的“全局融合公式”，容易让人以为所有检索都统一采用该分数。实际代码在不同模块里有自己的排序逻辑，因此这里不再把它当成系统级定律。

---

## “自愈”做到哪一步了

当前框架真正完成的是：

- Reflection 的多轮审查与改写；
- 工具异常包装为 Observation，让模型有机会换一种行动；
- 对部分模型输出做防御性解析；
- `max_steps` 与最大迭代次数兜底。

尚未完成的是统一的结构化自修正闭环，例如捕获 `Pydantic ValidationError` 后，把 JSON Schema、字段级错误和原始输出一起反馈给模型，再限制次数重试。它在知识库里是明确的后续设计，不应写成已经落地的功能。

这一区分也解释了为什么页面现在用“框架实验”而不是“闭环自愈系统”来描述项目。

---

## 这个项目留下了什么

yu_agent 没有用一个最终准确率证明自己。它真正产出的，是一组可以独立阅读和替换的 Agent 基础组件，以及对若干设计缺口的直接认识：

- 兼容 OpenAI API 不等于拥有可靠的模型路由；
- `max_steps` 能停止死循环，但不能理解死循环；
- Reflection 能改写答案，但不等于可验证的自修正；
- 有 Qdrant 和 Neo4j 不代表检索融合自然正确；
- Prompt 约定适合教学，生产系统更需要结构化协议和可观测状态。

后来在 JunkFilter 中实现 ReAct、SSE 和工具调用时，这些经验直接影响了更具体的工程取舍。反过来，JunkFilter 的消息队列、幂等和进程生命周期问题，也说明 yu_agent 仍需要更多真实应用才能继续完善。

---

## 项目地址

- [GitHub：xiaoyu-ops/yu_agent](https://github.com/xiaoyu-ops/yu_agent)
