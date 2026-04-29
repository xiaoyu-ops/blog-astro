---
title: "yu_agent — Unified Multi-Model Agent Framework"
date: 2025-01-01
description: "A personal exploration into LLM agent architecture — OpenAI-compatible, supporting 8+ providers with four reasoning modes and a multi-tier memory system."
tags: ["Python", "LLM", "Agent", "Qdrant", "Neo4j", "MCP"]
---

## Overview

A personal project to explore LLM agent design from scratch. The goal was to build a unified framework that abstracts away provider differences and experiments with different reasoning strategies — without relying on heavyweight orchestration libraries.

## Features

- **Unified API across 8+ LLM providers** — DeepSeek, Tongyi, Kimi, and others behind a single OpenAI-compatible interface
- **4 reasoning modes** — Simple · ReAct · Reflection · PlanAndSolve, switchable per task
- **Built-in tool system** with MCP protocol support
- **4-tier memory architecture** — in-context → working memory → Qdrant vector search → Neo4j knowledge graph

## Motivation

Most agent frameworks (LangChain, LlamaIndex) abstract too much and make it hard to understand what's actually happening. This was an attempt to build the core primitives myself and develop a clearer mental model of how agents work at the reasoning and memory layer.

## Links

- [GitHub: xiaoyu-ops/yu_agent](https://github.com/xiaoyu-ops/yu_agent)
