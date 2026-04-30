---
title: "JunkFilter — 基于 Agent 的内容评估系统"
date: 2025-03-01
description: "异构 Go + Python 分布式管道，用于 RSS 内容过滤，具备三级去重和 LangGraph 多 Agent 评估功能。LLM API 成本降低 30%。"
tags: ["Go", "Python", "LangGraph", "分布式系统", "Tauri"]
---

## 概述

一个异构 Go + Python 分布式管道，用于 RSS 内容过滤，打包为跨平台桌面应用，支持 iOS 推送通知。

## 架构

- **三级去重**：布隆过滤器 → Redis → PostgreSQL
- **LangGraph 多 Agent** 评估工作流，具备 ReAct 推理能力
- **语义缓存** 和动态调优，优化 LLM 成本
- 通过 **Vue3 + Tauri** 构建跨平台桌面应用，支持 iOS 推送通知

## 成果

- 通过语义缓存 **降低 30%** LLM API 成本

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

## 链接

- [GitHub: xiaoyu-ops/Junk-Filter](https://github.com/xiaoyu-ops/Junk-Filter)
