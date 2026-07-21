---
title: "yu_agent — 统一多模型 Agent 框架"
description: "对大语言模型 Agent 架构的个人探索 —— 兼容 OpenAI，支持 8+ 提供商，具备四种推理模式和多层级记忆系统。"
date: "2025-01-01"
order: 3
tags:
  - Python
  - 大语言模型
  - Agent
  - Qdrant
  - Neo4j
  - MCP
---

## 概述

**yu_agent** 是一个从零开始探索大语言模型 Agent 设计的个人项目。目标是构建一个**统一框架**，抽象化 LLM 提供商差异，并试验不同的推理策略 —— 不依赖重量级编排库（如 LangChain、LlamaIndex）。

**动机**：大多数 Agent 框架抽象过度，让人难以理解实际发生了什么。这是一次尝试，自己构建核心原语，在推理和记忆层面对 Agent 的工作方式建立更清晰的心智模型。

---

## 系统架构

![yu_agent 架构图](/images/architecture/yu-agent-arch.svg)

### 核心组件

```
用户输入
    │
    ▼
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  模型路由器  │ → │  推理引擎    │ → │  工具系统    │
│ 8+ 提供商   │    │ 4 种模式    │    │ MCP 协议    │
│ 自动检测    │    │ 动态切换    │    │ Function Call│
└─────────────┘    └─────────────┘    └─────────────┘
                                           │
                                    ┌─────────────┐
                                    │  4 层记忆架构 │
                                    │ ① 上下文内   │
                                    │ ② 工作记忆   │
                                    │ ③ Qdrant 向量│
                                    │ ④ Neo4j 图谱 │
                                    └─────────────┘
                                           │
                                           ▼
                                      输出结果 (SSE 流式)
```

---

## 多模型路由

### 统一抽象层

**核心问题**：不同 LLM 提供商的 API 格式、认证方式、功能支持各不相同，切换成本高。

**解决方案**：在 `AgentsLLM` 类中实现四级自动检测机制：

```python
class AgentsLLM:
    def __init__(self, api_key=None, base_url=None, model=None):
        self.provider = self._auto_detect_provider(api_key, base_url)
        self.client = self._build_client()
    
    def _auto_detect_provider(self, api_key, base_url):
        # 优先级 1: 环境变量（如 DEEPSEEK_API_KEY）
        if os.getenv("DEEPSEEK_API_KEY"):
            return "deepseek"
        
        # 优先级 2: API Key 前缀识别
        if api_key and api_key.startswith("ms-"):
            return "modelscope"
        
        # 优先级 3: base_url 域名特征
        if base_url and "deepseek" in base_url:
            return "deepseek"
        if base_url and "openai" in base_url:
            return "openai"
        
        # 优先级 4: 通用回退
        return "openai_compatible"
```

### 支持的提供商

| 提供商 | 检测方式 | 特点 |
|--------|---------|------|
| DeepSeek | 环境变量 / 域名 | 推理能力强，性价比高 |
| 通义 (Qwen) | 域名 / Key 前缀 | 中文优化好 |
| Kimi (Moonshot) | 域名 | 长上下文支持 |
| OpenAI | 域名 | 功能最全，基准测试 |
| ModelScope | Key 前缀 (`ms-`) | 国内模型聚合平台 |
| 本地模型 | base_url=localhost | 隐私保护，零成本 |

### 局限性 & 优化方向

**当前局限**：
- 模型与实例在生命周期内**强绑定**
- 缺乏针对 **429 限流** 的自动容灾（Fallback）机制

**优化方向**：
- **Router 层**：基于任务复杂度（简单 vs 复杂推理）分发至不同规格模型
- **异常降级**：在 `invoke()` 捕获特定错误后，自动切换至备用 Provider

---

## 推理引擎

### 4 种推理模式

| 模式 | 适用场景 | 核心机制 |
|------|---------|---------|
| **Simple** | 简单问答、翻译、摘要 | 直接调用 LLM，无中间步骤 |
| **ReAct** | 需要工具调用的任务 | 推理 → 行动 → 观察 → 循环 |
| **Reflection** | 高质量生成任务 | 生成 → 审查 → 修正（最多 3 轮） |
| **PlanAndSolve** | 多步复杂任务 | 先制定计划 → 按步骤执行 |

### 动态切换逻辑

```python
def select_reasoning_mode(task_description):
    """基于任务特征选择推理模式"""
    
    # 需要外部数据 → ReAct
    if any(kw in task_description for kw in ["查询", "搜索", "获取"]):
        return "react"
    
    # 需要高质量输出 → Reflection
    if any(kw in task_description for kw in ["写作", "生成", "优化"]):
        return "reflection"
    
    # 多步骤任务 → PlanAndSolve
    if any(kw in task_description for kw in ["步骤", "流程", "计划"]):
        return "plan_and_solve"
    
    # 默认 → Simple
    return "simple"
```

### 死循环破局

**当前防御**：依靠 `max_steps`（默认 5 步）作为熔断上限。

**痛点**：如果模型陷入逻辑怪圈（重复相同的 Action + 参数），系统只会原地打转直到步数耗尽。

**改进预案**：
- **重复动作检测**：连续两次执行相同动作时，强制在 Prompt 中注入"纠偏警告"
- **上下文管理**：引入历史窗口滑动或摘要机制，防止冗余的错误尝试撑爆上下文

---

## 工具系统

### 内置工具 + MCP 协议

**MCP（Model Context Protocol）**：标准化的工具调用协议，让模型能够：
- 发现可用工具
- 理解工具参数 schema
- 执行工具并获取结果

```python
# MCP 工具定义示例
TOOL_DEFINITIONS = [
    {
        "type": "function",
        "function": {
            "name": "search_knowledge",
            "description": "在知识库中搜索相关信息",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "搜索关键词"},
                    "top_k": {"type": "integer", "description": "返回结果数量"}
                },
                "required": ["query"]
            }
        }
    }
]
```

### Function Calling 兼容

支持 OpenAI 标准的 `tools` / `tool_choice` 参数，兼容任意实现该协议的提供商。

---

## 4 层记忆架构

### 架构设计

```
┌─────────────────────────────────────────┐
│  ① 上下文内记忆 (In-Context)               │
│     · 当前对话的 messages 列表             │
│     · 硬上限: 2000 token                   │
├─────────────────────────────────────────┤
│  ② 工作记忆 (Working Memory)               │
│     · 短期事实缓存                         │
│     · 最近 10 轮对话摘要                    │
├─────────────────────────────────────────┤
│  ③ 语义记忆 (Semantic Memory)             │
│     · Qdrant 向量数据库                    │
│     · 长期知识存储                         │
├─────────────────────────────────────────┤
│  ④ 情节记忆 (Episodic Memory)             │
│     · Neo4j 知识图谱                       │
│     · 实体关系网络                         │
└─────────────────────────────────────────┘
```

### 混合检索编排

**检索链路**：依次遍历 4 层记忆，按配额分配结果数量。

**融合评分公式**：

$$
Score = (S_{vector} \times 0.7 + S_{graph} \times 0.3) \times k_{importance}$$

其中：
- $S_{vector}$ = Qdrant 向量相似度得分
- $S_{graph}$ = Neo4j 图关系得分
- $k_{importance}$ = 重要度调节系数（范围 0.8 ~ 1.2）

**Token 控制**：
- **工作记忆**：硬上限 2000 token
- **RAG 结果**：字符级裁剪（`max_chars=1200`）

**设计缺憾**：最终全局排序仅依据 `importance` 字段，导致前期精细计算的向量/图融合分数在最后阶段被"掩盖"了，这是后续优化的核心点。

---

## 闭环自愈链路

### 现有的"准自愈"模式

| 机制 | 实现 | 效果 |
|------|------|------|
| **Reflection 模式** | LLM-as-Critic，生成-审查-修正循环 | 最多 3 轮，提升输出质量 |
| **工具异常回传** | 将代码报错包装成自然语言反馈给模型 | 模型自行调整策略 |
| **防御性解析** | `_coerce_sequence()` 修复括号缺失 | 兼容多种解析器 |

### 理想的 Self-Correction 架构

如果要实现真正的格式自愈：

```python
try:
    result = pydantic_model.parse(raw_output)
except ValidationError as e:
    # 组装纠错 Prompt
    correction_prompt = f"""
    原始输出: {raw_output}
    JSON Schema: {schema}
    错误信息: {e.errors()}
    
    请修正输出，使其符合 Schema 要求。
    """
    # 引导模型定向修复
    corrected = await llm.generate(correction_prompt)
```

---

## 技术栈

| 层级 | 技术 | 用途 |
|------|------|------|
| LLM 接口 | OpenAI SDK / HTTP | 统一调用层 |
| 向量数据库 | Qdrant | 语义记忆存储 |
| 图数据库 | Neo4j | 情节记忆/知识图谱 |
| 协议 | MCP | 工具标准化 |
| 部署 | Python 异步 (asyncio) | 高并发处理 |

---

## 设计哲学

> "大多数 Agent 框架（LangChain、LlamaIndex）抽象了太多，让人难以理解实际发生了什么。yu_agent 是一次尝试，自己构建核心原语，在推理和记忆层面对 Agent 的工作方式建立更清晰的心智模型。"

**核心原则**：
1. **显式优于隐式** —— 每个推理步骤都可见、可调试
2. **组合优于继承** —— 推理模式、记忆层、工具都可以独立替换
3. **协议优于实现** —— 通过 MCP 等标准协议解耦，不绑定特定框架

---

## 链接

- [GitHub: xiaoyu-ops/yu_agent](https://github.com/xiaoyu-ops/yu_agent)
