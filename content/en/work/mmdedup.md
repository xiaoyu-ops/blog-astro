---
title: "MMdedup — Multimodal Deduplication Pipeline"
date: 2025-06-01
description: "A high-throughput data cleaning pipeline for multimodal large language model training datasets. 90% storage reduction, 3.6× throughput improvement over SemDeDup. Under submission."
tags: ["Python", "Data Systems", "Large Language Models", "Research"]
---

## Overview

**MMdedup** is a high-throughput data cleaning pipeline for multimodal large language model (LLM) training datasets. The pipeline processes three modalities—text, image, and audio—using a **two-stage architecture**: content-based classification (Sorter) followed by modality-specific deduplication.

**Core Challenge**: Multimodal datasets (TB-scale) contain massive amounts of duplicate content. Training directly on such data leads to model overfitting and wasted compute resources. Traditional deduplication methods (e.g., SemDeDup) target only a single modality and cannot handle industrial-scale data volumes.

**Results**:
- **90% storage reduction** on TB-scale datasets
- **3.6× throughput improvement** over the SemDeDup baseline
- Currently under submission; **national invention patent** and **software copyright** have been applied for

---

## System Architecture

![MMdedup Architecture Diagram](/images/architecture/mmdedup-arch.svg)

### Two-Stage Pipeline

```
Raw Multimodal Data (Text · Image · Audio)
           │
           ▼
    ┌─────────────────┐
    │  Stage 1: Sorter │
    │  · Magic Number Sorting        │
    │  · Printability Analysis       │
    │  · Semantic Parsing → Modality Classification │
    └─────────────────┘
           │
           ▼
    ┌─────────────────────────────┐
    │    Stage 2: Modality-Specific Deduplication       │
    │  ┌─────────┬─────────┬─────┐│
    │  │  Text   │  Image  │ Audio││
    │  │N-gram   │CLIP     │Spectral││
    │  │Jaccard  │K-means  │Fingerprint││
    │  │MinHash  │Faiss    │LSH   ││
    │  └─────────┴─────────┴─────┘│
    └─────────────────────────────┘
           │
           ▼
    Deduplicated Dataset (Storage ↓90%, Throughput ↑3.6×)
```

---

## Stage 1: Sorter — Content Classification

The Sorter's role is to classify raw data by modality, providing the correct input for the subsequent deduplication stage.

### Magic Number Sorting

Quickly identify file types via magic bytes in the file header:

| File Type | Magic Number | Description |
|---------|------|------|
| JPEG | `FF D8 FF` | Image file |
| PNG | `89 50 4E 47` | Image file |
| WAV | `52 49 46 46` | Audio file |
| MP3 | `49 44 33` | Audio file |
| UTF-8 Text | No magic number; printability analysis | Text file |

### Printability Analysis

For files without explicit magic numbers, determine whether they are text by analyzing byte distribution:
- Calculate the proportion of byte values within the printable character range (0x20–0x7E)
- Proportion > 80% → classified as text
- Proportion < 20% → requires further parsing (likely binary image/audio)

### Semantic Parsing

For edge cases (e.g., HTML pages with embedded images), perform shallow parsing to extract:
- `<img>` tag `src` attributes → image URLs
- `<audio>` tags → audio resources
- Plain text content → text data

---

## Stage 2: Modality-Specific Deduplication

### Text Deduplication

**Exact Deduplication**:
- **N-gram + Jaccard Similarity**: Split text into n-grams (n=5) and compute Jaccard similarity
- Similarity > 0.95 → classified as duplicate

**Approximate Deduplication (Large Scale)**:
- **MinHash LSH**: Represent documents as MinHash signatures and use Locality-Sensitive Hashing (LSH) to quickly find candidate duplicate pairs
- Time complexity: O(n) instead of O(n²)

```python
# MinHash signature generation (simplified)
def minhash_signature(text, num_perm=128):
    shingles = set(ngrams(text, n=5))
    signature = []
    for i in range(num_perm):
        min_hash = min(hash((shingle, i)) for shingle in shingles)
        signature.append(min_hash)
    return signature
```

### Image Deduplication

**Feature Extraction**:
- **CLIP Embeddings**: Use the OpenAI CLIP model to encode images into 512-dimensional vectors
- Distance in vector space = semantic similarity

**Clustering & Deduplication**:
- **K-means Clustering**: Partition the vector space into k clusters
- **Faiss Index**: GPU-accelerated Approximate Nearest Neighbor (ANN) search

**Distributed Sharding (Key Design)**:

At TB-scale (hundreds of millions of vectors), we adopt **Voronoi spatial sharding**:

```
512-dimensional space partitioned into k (e.g., k=2000) Voronoi cells
    │
    ├── Node 1: responsible for vector indices of Cluster [0-100]
    ├── Node 2: responsible for vector indices of Cluster [101-200]
    └── ...
    
Each shard internally uses Faiss IVFFlat or IndexFlatIP
```

**Synchronization Overhead**:
- Do not synchronize the full index; only synchronize **cluster centroids**
- 2000 × 512-dimensional float32 vectors ≈ 4 MB
- Broadcast overhead is negligible (microsecond-level) on a 10 Gbps network

**Cross-Node Duplicate Discovery Mechanism**:

```
Stage 1: Parallel Feature Extraction
    Node A processes Image A → CLIP embedding → 512-dim vector
    Node B processes Image B → CLIP embedding → 512-dim vector
    
Stage 2: Centroid-based Routing
    Node A computes the distance between Image A's vector and the global k centroids
    → obtains Cluster_ID (assume 42)
    → sends (Embedding, Image_ID) to the node responsible for Cluster 42 (Node C)
    
Stage 3: Local Exact Comparison
    Node C collects all vectors belonging to Cluster 42
    → performs O(N²) inner-product comparison
    → Images A and B converge at Node C; duplicates cannot hide
```

**Communication Optimization**:
- Raw image: several MB
- 512-dim vector: ~2 KB
- **Feature-level transmission reduces cross-node communication overhead by over 1000×**

### Audio Deduplication

**Spectral Fingerprinting**:
- Convert audio into a spectrogram
- Extract peak feature points as fingerprints
- Similar to the music recognition principle used by Shazam

**MinHash LSH Matching**:
- Represent spectral fingerprints as sets
- MinHash + LSH to quickly find similar audio clips

---

## Performance Optimizations & The Secret Behind "3.6×"

### 1. Compute/Communication Overlapping

```
Timeline →
Node A: [Embedding Batch 1] [Embedding Batch 2] [Embedding Batch 3]
Node B: [Embedding Batch 1] [Embedding Batch 2] [Embedding Batch 3]
Node C:           [Compare Batch 1]      [Compare Batch 2]      [Compare Batch 3]
```

While Node C is comparing the previous batch, Nodes A/B are computing embeddings for the current batch. **The pipeline masks communication latency**.

### 2. Complexity Dividend

Traditional SemDeDup processes overly large clusters on a single machine or performs inefficient global searches. MMdedup physically shards data, reducing N by a factor of k:

- Original complexity: O(N²) or O(N·logN)
- Sharded complexity: O((N/k)²) × k = O(N²/k)
- Even accounting for shuffle overhead, the saved computation time far exceeds network transfer time

### 3. Bottleneck Analysis

Industrial-scale stress testing reveals that the absolute system bottleneck is **GPU memory bandwidth**, not network IO:

- After index sharding, each node only needs to load vectors for its assigned clusters
- Avoids frequent GPU/CPU memory swapping
- **This is the underlying driver of the 3.6× improvement**

---

## Results

| Metric | Value | Baseline |
|------|------|---------|
| Storage Reduction | **90%** | Original TB-scale dataset |
| Throughput Improvement | **3.6×** | SemDeDup baseline |
| Modalities Covered | 3 | Text, Image, Audio |
| Data Scale | TB-scale | Hundred-million samples |
| Vector Dimension | 512-dim | CLIP embedding |
| Shard Count | 2000 | Voronoi cells |

---

## Academic Output

- **VLDB 2026 Under Submission**: Paper currently in review
- **National Invention Patent**: Applied for, pending authorization
- **Software Copyright**: Registered

---

## Links

- [GitHub: xiaoyu-ops/VLDB26](https://github.com/xiaoyu-ops/VLDB26)
