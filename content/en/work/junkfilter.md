---
title: "JunkFilter — Agent-Based Content Evaluation System"
date: 2025-03-01
description: "Heterogeneous Go + Python distributed pipeline for RSS content filtering with 3-tier deduplication and LangGraph multi-agent evaluation. 30% LLM API cost reduction."
tags: ["Go", "Python", "LangGraph", "Distributed Systems", "Tauri"]
---

## Overview

A heterogeneous Go + Python distributed pipeline for RSS content filtering, packaged as a cross-platform desktop app with iOS push notifications.

## Architecture

- **3-tier deduplication**: Bloom Filter → Redis → PostgreSQL
- **LangGraph multi-agent** evaluation workflow with ReAct reasoning
- **Semantic caching** and dynamic tuning for LLM cost optimization
- Cross-platform desktop app via **Vue3 + Tauri** with iOS push notifications

## Results

- **30% reduction** in LLM API costs via semantic caching

## Screenshots

### Home — Article Search
![JunkFilter Home](/images/junkfilter-home.png)

### Timeline — AI-Evaluated RSS Feed
![JunkFilter Timeline](/images/junkfilter-timeline.png)

### Reader View
![JunkFilter Reader](/images/junkfilter-reader.png)

### Agent Dashboard
![JunkFilter Agent](/images/junkfilter-agent.png)

### Configuration Center
![JunkFilter Config](/images/junkfilter-config.png)

### iOS Push Notifications
![JunkFilter Mobile](/images/junkfilter-mobile.png)

## Links

- [GitHub: xiaoyu-ops/Junk-Filter](https://github.com/xiaoyu-ops/Junk-Filter)
