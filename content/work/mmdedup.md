---
title: "MMdedup — Multimodal Deduplication Pipeline"
date: 2025-06-01
description: "High-throughput data-cleaning pipeline for multimodal LLM training datasets. 90% storage reduction, 3.6× throughput over SemDeDup. Submitted to VLDB'26."
tags: ["Python", "Data Systems", "LLM", "Research"]
---

## Overview

A high-throughput data-cleaning pipeline for multimodal LLM training datasets. The pipeline handles text, image, and audio modalities through a two-phase architecture: content-based classification followed by modality-specific deduplication.

## Architecture

![MMdedup Architecture](/images/mmdedup-architecture.png)

The pipeline operates in two phases:
- **Phase 1 — Sorter**: Content-based checks (magic number sorting, printability analysis) and semantic parsing to classify raw data by modality
- **Phase 2 — Modality-Specific Deduplication**: Exact and near-duplicate detection for text (N-gram + Jaccard), images (CLIP embeddings + K-means), and audio (spectral fingerprinting + MinHash LSH)

## Results

- **90% storage reduction** on TB-scale datasets
- **3.6× throughput improvement** over the SemDeDup baseline
- Submitted to **VLDB'26**; national invention patent and software copyright filed

## Links

- [GitHub: xiaoyu-ops/VLDB26](https://github.com/xiaoyu-ops/VLDB26)
