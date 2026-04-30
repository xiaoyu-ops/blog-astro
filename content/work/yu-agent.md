---
title: "yu_agent — 统一多模型 Agent 框架"
date: 2025-01-01
description: "对大语言模型 Agent 架构的个人探索 —— 兼容 OpenAI，支持 8+ 提供商，具备四种推理模式和多层级记忆系统。"
tags: ["Python", "大语言模型", "Agent", "Qdrant", "Neo4j", "MCP"]
---

## 概述

一个从零开始探索大语言模型 Agent 设计的个人项目。目标是构建一个统一框架，抽象化提供商差异，并试验不同的推理策略 —— 不依赖重量级编排库。

## 特性

- **跨 8+ 大语言模型提供商的统一 API** —— 在 DeepSeek、通义、Kimi 等背后提供单一的 OpenAI 兼容接口
- **4 种推理模式** —— 简单 · ReAct · 反思 · 计划并解决，可按任务切换
- **内置工具系统**，支持 MCP 协议
- **4 层记忆架构** —— 上下文内 → 工作记忆 → Qdrant 向量搜索 → Neo4j 知识图谱

## 动机

大多数 Agent 框架（LangChain、LlamaIndex）抽象过度，让人难以理解实际发生了什么。这是一次尝试，自己构建核心原语，并在推理和记忆层面对 Agent 的工作方式建立更清晰的心智模型。

## 链接

- [GitHub: xiaoyu-ops/yu_agent](https://github.com/xiaoyu-ops/yu_agent)
