---
title: "yu_agent — Unified Multi-Model Agent Framework"
date: 2025-01-01
description: "A personal exploration into LLM Agent architecture — compatible with OpenAI, supporting 8+ providers, featuring four reasoning modes and a multi-tier memory system."
tags: ["Python", "LLM", "Agent", "Qdrant", "Neo4j", "MCP"]
---

## Overview

**yu_agent** is a personal project exploring LLM Agent design from scratch. The goal is to build a **unified framework** that abstracts away provider differences and experiments with different reasoning strategies — without relying on heavyweight orchestration libraries like LangChain or LlamaIndex.

**Motivation**: Most Agent frameworks abstract too much, making it hard to understand what actually happens. This is an attempt to build the core primitives myself and develop a clearer mental model of how Agents work at the reasoning and memory layers.

---

## System Architecture

![yu_agent Architecture Diagram](/images/architecture/yu-agent-arch.svg)

### Core Components

```
User Input
    │
    ▼
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│ Model Router│ → │ Reasoning   │ → │ Tool System │
│ 8+ Providers│    │ 4 Modes     │    │ MCP Protocol│
│ Auto-detect │    │ Dynamic     │    │ Function    │
└─────────────┘    └─────────────┘    └─────────────┘
                                           │
                                    ┌─────────────┐
                                    │ 4-Tier      │
                                    │ Memory      │
                                    │ Architecture│
                                    │ ① In-Context│
                                    │ ② Working   │
                                    │ ③ Qdrant    │
                                    │ ④ Neo4j     │
                                    └─────────────┘
                                           │
                                           ▼
                                      Output (SSE Streaming)
```

---

## Multi-Model Routing

### Unified Abstraction Layer

**Core Problem**: Different LLM providers vary in API format, authentication methods, and feature support, making switching costly.

**Solution**: Implement a four-level auto-detection mechanism in the `AgentsLLM` class:

```python
class AgentsLLM:
    def __init__(self, api_key=None, base_url=None, model=None):
        self.provider = self._auto_detect_provider(api_key, base_url)
        self.client = self._build_client()
    
    def _auto_detect_provider(self, api_key, base_url):
        # Priority 1: Environment variables (e.g., DEEPSEEK_API_KEY)
        if os.getenv("DEEPSEEK_API_KEY"):
            return "deepseek"
        
        # Priority 2: API Key prefix recognition
        if api_key and api_key.startswith("ms-"):
            return "modelscope"
        
        # Priority 3: base_url domain characteristics
        if base_url and "deepseek" in base_url:
            return "deepseek"
        if base_url and "openai" in base_url:
            return "openai"
        
        # Priority 4: Generic fallback
        return "openai_compatible"
```

### Supported Providers

| Provider | Detection Method | Characteristics |
|----------|------------------|---------------|
| DeepSeek | Environment variable / Domain | Strong reasoning, excellent value |
| Qwen (Tongyi) | Domain / Key prefix | Strong Chinese-language performance |
| Kimi (Moonshot) | Domain | Long context support |
| OpenAI | Domain | Full features, baseline benchmark |
| ModelScope | Key prefix (`ms-`) | Chinese model aggregation platform |
| Local Models | base_url=localhost | Privacy protection, zero cost |

### Limitations & Optimization Directions

**Current Limitations**:
- Model and instance are **strongly bound** for their lifecycle
- Lack of automatic **429 rate-limiting** fallback mechanism

**Optimization Directions**:
- **Router Layer**: Distribute tasks to different-sized models based on complexity (simple vs. complex reasoning)
- **Graceful Degradation**: After catching specific errors in `invoke()`, automatically switch to a backup Provider

---

## Reasoning Engine

### 4 Reasoning Modes

| Mode | Applicable Scenario | Core Mechanism |
|------|---------------------|----------------|
| **Simple** | Simple Q&A, translation, summarization | Direct LLM call, no intermediate steps |
| **ReAct** | Tasks requiring tool calls | Reason → Act → Observe → Loop |
| **Reflection** | High-quality generation tasks | Generate → Review → Revise (up to 3 rounds) |
| **PlanAndSolve** | Multi-step complex tasks | Plan first → Execute step by step |

### Dynamic Switching Logic

```python
def select_reasoning_mode(task_description):
    """Select reasoning mode based on task characteristics"""
    
    # Requires external data → ReAct
    if any(kw in task_description for kw in ["query", "search", "fetch"]):
        return "react"
    
    # Requires high-quality output → Reflection
    if any(kw in task_description for kw in ["write", "generate", "optimize"]):
        return "reflection"
    
    # Multi-step tasks → PlanAndSolve
    if any(kw in task_description for kw in ["steps", "process", "plan"]):
        return "plan_and_solve"
    
    # Default → Simple
    return "simple"
```

### Dead Loop Resolution

**Current Defense**: Relies on `max_steps` (default 5 steps) as a circuit-breaker limit.

**Pain Point**: If the model falls into a logical loop (repeating the same Action + parameters), the system will spin in place until the step limit is exhausted.

**Improvement Plan**:
- **Duplicate Action Detection**: When the same action is executed twice consecutively, force a "correction warning" injection into the Prompt
- **Context Management**: Introduce historical window sliding or summarization mechanisms to prevent redundant failed attempts from overflowing the context

---

## Tool System

### Built-in Tools + MCP Protocol

**MCP (Model Context Protocol)**: A standardized tool-calling protocol that enables models to:
- Discover available tools
- Understand tool parameter schemas
- Execute tools and retrieve results

```python
# MCP tool definition example
TOOL_DEFINITIONS = [
    {
        "type": "function",
        "function": {
            "name": "search_knowledge",
            "description": "Search for relevant information in the knowledge base",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Search keywords"},
                    "top_k": {"type": "integer", "description": "Number of results to return"}
                },
                "required": ["query"]
            }
        }
    }
]
```

### Function Calling Compatibility

Supports OpenAI-standard `tools` / `tool_choice` parameters, compatible with any provider implementing this protocol.

---

## 4-Tier Memory Architecture

### Architecture Design

```
┌─────────────────────────────────────────┐
│  ① In-Context Memory                     │
│     · Current conversation messages list │
│     · Hard limit: 2000 tokens            │
├─────────────────────────────────────────┤
│  ② Working Memory                        │
│     · Short-term fact cache              │
│     · Summary of last 10 conversation    │
│       rounds                             │
├─────────────────────────────────────────┤
│  ③ Semantic Memory                       │
│     · Qdrant vector database             │
│     · Long-term knowledge storage        │
├─────────────────────────────────────────┤
│  ④ Episodic Memory                       │
│     · Neo4j knowledge graph              │
│     · Entity relationship network        │
└─────────────────────────────────────────┘
```

### Hybrid Retrieval Orchestration

**Retrieval Pipeline**: Sequentially traverses 4 memory tiers, allocating result quotas per tier.

**Fusion Scoring Formula**:

$$
Score = (S_{vector} \times 0.7 + S_{graph} \times 0.3) \times k_{importance}$$

Where:
- $S_{vector}$ = Qdrant vector similarity score
- $S_{graph}$ = Neo4j graph relationship score
- $k_{importance}$ = Importance adjustment coefficient (range 0.8 ~ 1.2)

**Token Control**:
- **Working Memory**: Hard limit of 2000 tokens
- **RAG Results**: Character-level truncation (`max_chars=1200`)

**Design Flaw**: The final global ranking relies solely on the `importance` field, causing the finely calculated vector/graph fusion scores from earlier stages to be "masked" in the final stage. This is the core point for subsequent optimization.

---

## Closed-Loop Self-Healing Pipeline

### Existing "Quasi-Self-Healing" Modes

| Mechanism | Implementation | Effect |
|-----------|----------------|--------|
| **Reflection Mode** | LLM-as-Critic, generate-review-revise loop | Up to 3 rounds, improves output quality |
| **Tool Exception Feedback** | Wrap code errors as natural language feedback to the model | Model adjusts strategy autonomously |
| **Defensive Parsing** | `_coerce_sequence()` fixes missing brackets | Compatible with multiple parsers |

### Ideal Self-Correction Architecture

To achieve true format self-healing:

```python
try:
    result = pydantic_model.parse(raw_output)
except ValidationError as e:
    # Assemble correction prompt
    correction_prompt = f"""
    Original output: {raw_output}
    JSON Schema: {schema}
    Error message: {e.errors()}
    
    Please correct the output to conform to the Schema requirements.
    """
    # Guide model for targeted repair
    corrected = await llm.generate(correction_prompt)
```

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| LLM Interface | OpenAI SDK / HTTP | Unified call layer |
| Vector Database | Qdrant | Semantic memory storage |
| Graph Database | Neo4j | Episodic memory / knowledge graph |
| Protocol | MCP | Tool standardization |
| Deployment | Python async (asyncio) | High-concurrency processing |

---

## Design Philosophy

> "Most Agent frameworks (LangChain, LlamaIndex) abstract too much, making it hard to understand what actually happens. yu_agent is an attempt to build the core primitives myself and develop a clearer mental model of how Agents work at the reasoning and memory layers."

**Core Principles**:
1. **Explicit over Implicit** — Every reasoning step is visible and debuggable
2. **Composition over Inheritance** — Reasoning modes, memory layers, and tools can all be independently replaced
3. **Protocol over Implementation** — Decoupling through standard protocols like MCP, not binding to specific frameworks

---

## Links

- [GitHub: xiaoyu-ops/yu_agent](https://github.com/xiaoyu-ops/yu_agent)
