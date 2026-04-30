---
title: "Sangfor Technologies — AI Algorithm Intern"
date: 2026-02-01
description: "Built a dual-path clustering pipeline for a self-evolving endpoint security agent to identify rare attack patterns (Rare TTP). Achieved >70% identification accuracy and generated 2,000+ high-value training samples."
tags: ["Python", "Clustering", "Security", "AI", "Internship"]
---

## Position

**AI Algorithm Intern** · Sangfor Technologies · Feb 2026 – Apr 2026 · Shenzhen

## Project Background

Sangfor's endpoint security product requires continuous evolution to counter novel attacks. Traditional rule-based defenses cannot handle **rare attack patterns (Rare TTP, Tactics Techniques Procedures)**, which are typical characteristics of Advanced Persistent Threats (APT).

**Core Challenges**:
- Rare attack samples are extremely scarce (positive sample shortage), rendering traditional supervised learning ineffective
- Need to automatically discover unknown attack patterns rather than relying on manual rules
- Identification results must be interpretable for security operations team review

**Solution**: Built a **dual-path clustering pipeline** that combines semantic vector similarity and process tree structural patterns to automatically identify Rare TTP and generate high-value training samples to feed back into the security agent.

---

## System Architecture

![Sangfor Dual-Path Clustering Architecture](/images/architecture/sangfor-arch.svg)

### Overall Flow

```
Endpoint Behavior Data (Process Tree · API Calls · File Operations)
           │
           ├──► Path A: Semantic Vectors
           │     · Embedding Encoding
           │     · Embedding-based Similarity Clustering
           │
           └──► Path B: Process Tree DFS Serialization
                 · Structural Pattern Matching
                 · Preserving Parent-Child Relationships and Execution Order
           │
           ▼
    ┌─────────────────┐
    │  Dual-Path Fusion Layer  │
    │  Vector Similarity + Structural Matching  │
    │  Joint Scoring → Anomaly Detection  │
    │  Rare TTP Identification  │
    └─────────────────┘
           │
           ▼
    Output: Rare Attack Pattern Annotations + High-Value Training Samples
```

---

## Path A: Semantic Vector Clustering

### Behavior Embedding Encoding

Encode endpoint behaviors (API call sequences, file operations, registry accesses, etc.) into fixed-dimensional vectors:

```python
# Behavior sequence encoding example
def encode_behavior(api_calls, file_ops, registry_ops):
    # 1. Build behavior vocabulary
    behavior_tokens = api_calls + file_ops + registry_ops
    
    # 2. Encode using pre-trained model (or self-trained)
    embedding = behavior_encoder.encode(behavior_tokens)
    
    # 3. Aggregate into fixed-length vector
    return aggregate_embedding(embedding)
```

### Similarity Clustering

Use **HDBSCAN** or **DBSCAN** for density-based clustering:
- Normal behaviors form dense clusters (high-density regions)
- Rare attacks fall in sparse regions (low-density regions)
- Anomalies are automatically identified through density thresholds

```python
from sklearn.cluster import DBSCAN

# Density clustering
clusterer = DBSCAN(eps=0.5, min_samples=10)
labels = clusterer.fit_predict(behavior_embeddings)

# Samples with label -1 = outliers (Rare TTP candidates)
rare_ttp_candidates = embeddings[labels == -1]
```

---

## Path B: Process Tree Structure Matching

### DFS Serialization

Convert process trees into Depth-First Search (DFS) sequences to preserve structural information:

```
Original Process Tree:
  cmd.exe
  ├── powershell.exe
  │   ├── net.exe (query user)
  │   └── reg.exe (query run key)
  └── explorer.exe

DFS Serialization:
  "cmd.exe[powershell.exe[net.exe|reg.exe]|explorer.exe]"
```

### Structural Pattern Matching

Use **Tree Edit Distance** or **Subtree Isomorphism Detection** to measure process tree similarity:

| Match Type | Method | Purpose |
|-----------|--------|---------|
| Exact Match | Hash Comparison | Known Malware Family Identification |
| Approximate Match | Tree Edit Distance | Variant Attack Discovery |
| Subtree Match | Subtree Isomorphism | Attack Stage Identification |

---

## Dual-Path Fusion

### Joint Scoring Mechanism

Fuse scores from both paths to improve Rare TTP identification accuracy:

$$
Score_{fusion} = \alpha \cdot Score_{semantic} + (1-\alpha) \cdot Score_{structural}$$

Where:
- $Score_{semantic}$ = Anomaly score from the semantic vector path (inverse density from density clustering)
- $Score_{structural}$ = Anomaly score from the process tree path (structural matching divergence)
- $\alpha$ = Fusion weight (tuned on validation set, typically 0.6 ~ 0.7)

### Decision Logic

```python
def is_rare_ttp(semantic_score, structural_score, threshold=0.8):
    fusion_score = 0.65 * semantic_score + 0.35 * structural_score
    
    # Both paths abnormal → High confidence Rare TTP
    if semantic_score > threshold and structural_score > threshold:
        return "HIGH_CONFIDENCE"
    
    # Single path abnormal → Medium confidence, requires manual review
    elif fusion_score > threshold:
        return "MEDIUM_CONFIDENCE"
    
    # Normal behavior
    else:
        return "BENIGN"
```

---

## Self-Evolving Agent Loop

### Training Sample Generation

Identified Rare TTP automatically enters the training sample pool:

```
Rare TTP Identification
    │
    ├──► Operations Team Review (>80% pass rate)
    │     │
    │     ├──► Pass → Add to training set
    │     │
    │     └──► Reject → Analyze cause, optimize model
    │
    └──► Periodic Agent Retraining
          │
          └──► Detection capability improves → Discover more Rare TTP
```

### Sample Quality Control

- **Operations pass rate** > 80%: Ensures training sample accuracy
- **Diversity constraints**: Prevents over-sampling of similar attacks
- **Time decay**: Weight of old samples gradually decreases to adapt to attack evolution

---

## Results

| Metric | Value | Description |
|--------|-------|-------------|
| Rare Sample Identification Accuracy | **>70%** | Identification capability in positive-sample-scarce scenarios |
| Operations Pass Rate | **>80%** | Proportion passing operations team review |
| High-Value Training Samples Generated | **2,000+** | Used for continuous agent evolution |
| Endpoints Covered | Enterprise-grade | Sangfor endpoint security product deployment |
| Attack Types Covered | APT / 0-day / Variant Trojans | Multiple rare attack patterns |

---

## Tech Stack

| Technology | Purpose |
|-----------|---------|
| Python | Data processing, model training |
| scikit-learn | Density clustering (DBSCAN / HDBSCAN) |
| sentence-transformers | Behavior sequence embedding |
| NetworkX | Process tree structure analysis |
| pandas / numpy | Data cleaning and feature engineering |

---

## Internship Takeaways

1. **Industrial-grade AI deployment experience**: Complete workflow from algorithm design to production deployment
2. **Security domain knowledge**: In-depth understanding of endpoint security, APT attack patterns, and the TTP framework
3. **Data-driven mindset**: Continuous system optimization through metrics (accuracy, pass rate)
4. **Cross-team collaboration**: Efficient communication with product, operations, and R&D teams

---

## Links

- Internship content involves company confidentiality; GitHub repository is private
- For more information, feel free to reach out via email
