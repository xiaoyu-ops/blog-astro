---
title: "MMdedup"
titleEn: "MMdedup: Multimodal Deduplication Is More Than Similarity Search"
description: "一个面向文本、图像、音频及图文对的数据清洗研究项目，重点区分候选召回、重复关系判断与安全删除，并为实验结果保留可追溯证据。"
descriptionEn: "A research system for cleaning text, image, audio, and image-caption data, separating candidate retrieval, duplicate relation typing, and safe deletion with traceable experiment evidence."
date: "2025-06-01"
order: 1
tags:
  - Python
  - 多模态
  - 数据去重
  - 实验系统
  - 研究
tagsEn:
  - Python
  - Multimodal
  - Data Deduplication
  - Experiment Systems
  - Research
---

## 从“相似”重新理解去重

MMdedup 最初是一个文本、图像和音频三模态的数据清洗流水线。项目继续推进后，最重要的变化不是又加入了几个模型，而是重新定义了问题：

> **相似不等于重复；候选召回、关系判断和删除权限必须分开。**

两段文本讨论同一主题、两张图片拍摄同一个物体、两段音频属于同一首歌，都可能非常相似，但不一定应该删除。相反，裁剪图、拼接图、局部引用和同一录音的截取片段，有时全局相似度并不高，却包含真实的复制关系。

因此，当前 MMdedup 更像一套可审计的研究管道：先召回有限候选，再用模态相关证据判断 `FULL / PARTIAL / DISTINCT` 等关系，最后由保守规则决定是否允许删除。

---

## 当前系统结构

![MMdedup 当前架构：整理、候选、关系验证与实验证据四个阶段](/images/architecture/mmdedup-arch.svg)

项目包含四个连续阶段：

1. **Sorter**：识别文件类型、隔离损坏文件，并为不同模态生成 manifest；
2. **Candidate Retrieval**：用便宜的哈希、LSH 或向量检索缩小候选范围；
3. **Relation Verification**：结合内容覆盖、局部结构和时间对齐判断关系类型；
4. **Evidence & Reporting**：保存配置、逐样本预测、指标、环境和来源映射，避免只留下一个无法复核的最终数字。

Stage 4 则把图像和描述视为一个训练单元，补充图文对层面的重复判断。它不是把两个单模态分数简单相加，而是专门研究单模态重复、联合重复和过度删除之间的差异。

---

## 三种模态分别怎样判断重复

### Text-v2：既看全文，也看方向性包含

文本首先通过文档级与段落级 MinHash-LSH 召回候选，再计算精确哈希、Jaccard 和 containment。关键是保留 containment 的方向：短文完整出现在长文里，并不意味着两个方向的覆盖程度相同。

```text
Document / Passage LSH
          ↓
   bounded candidates
          ↓
exact hash + Jaccard + directional containment
          ↓
FULL_DUPLICATE / CONTAINMENT / SEMANTIC_SIMILAR / DISTINCT
```

语义相似可以帮助发现候选，但不能直接获得删除权限。当前内部验证使用 peS2o 的固定 revision 和冻结关系集，10K / 100K 关系评价中 candidate recall 为 **1.0000**、Macro-F1 为 **0.9569**。这能支持当前协议下的方法对比，但不等于在所有网页语料上都达到同样结果。

### Image I6：全图分数之外，还要看局部覆盖

仅靠 CLIP 全图向量，很难区分复制、裁剪、截图、拼接和“语义相似但并非复制”。I6 使用 SSCD 进行候选召回，并在候选对上建立 patch 对应，计算 query 与 reference 两个方向的覆盖率，再检查局部几何和空间一致性。

双向覆盖用于区分完整复制和部分复用：一张小图被嵌入海报时，小图方向可能接近全覆盖，海报方向却只覆盖很小区域。该样本应该标为 `PARTIAL`，而不是直接删除整张海报。

在由 DISC21 与 COCO 2017 val 构成的固定关系安全集上，I6 的 Macro-F1 为 **0.9317**；但在 DISC21 100K development 检索中 Recall@256 为 **0.8985**。所以图像路线目前被记录为 **PARTIAL**：关系判断已有明显改善，大库召回还没有完全闭环。

### Audio A7：录音身份和时间覆盖分开

音频先统一采样率并分段，通过 chroma / 频谱特征召回候选，再用频谱地标判断是否来自同一录音，最后依据时间覆盖区分完整复制和局部复用。

这一步很重要：移调或变速后的同一录音，与同一首歌的另一场演奏，不能只靠一个整体相似度区分。`PARTIAL` 和证据不足的样本默认不会触发整段删除。

A7 在 FMA Small 的扩大关系集上 candidate recall 为 **1.0000**、Macro-F1 为 **0.8636**。它在同数据协议下明显优于论文原版流程，但 DISTINCT 泛化和现代音频基线的统一重算仍在继续，因此同样记录为 **PARTIAL**。

---

## Stage 4：把图像和描述当作一个训练单元

对于图文训练数据，只分别清理图片和文字会遇到两个问题：

- 图片不同但模板化描述相同，文本去重可能误删；
- 图片和描述各自没有达到单模态阈值，但作为一对训练单元已经高度重复。

Stage 4 同时编码图像与文本，在候选对上保留 image、text 和 joint 三类信号，并与 image-only、text-only、naive union 进行比较。

当前主评价来自 CC3M 200K 候选池中的 **3,000 条 score-space 分层标注**，其中 462 条被标为 duplicate 或 near-duplicate。固定阈值下的结果为：

| 方法 | Precision | Recall | F1 | 说明 |
| --- | ---: | ---: | ---: | --- |
| Image only | 0.218 | 0.701 | 0.333 | 图像阈值固定为 0.85 |
| Text only | 0.280 | 0.277 | 0.279 | 文本阈值固定为 0.95 |
| Naive union | 0.201 | 0.799 | 0.322 | 任一单模态命中即删除，召回高但误删多 |
| Conservative Stage 4 | **0.726** | 0.431 | **0.541** | 图像和文本证据同时满足条件 |
| Joint（消融点） | 0.569 | **0.671** | **0.616** | 作为 alternative operating point 保留 |

论文主线采用 conservative rule，因为它和下游数据划分使用同一规则，并优先控制误删。Joint 的 F1 更高，但保留为替代工作点和消融结果，不混写成同一个主结论。

### 为什么不再写“存储减少 90%、吞吐提升 3.6 倍”

旧版项目页把早期稿件中的两个数字放到了最显眼的位置，却没有同时说明数据集、基线、硬件、阈值和证据文件。这种表达无法回答“在什么条件下成立”。

当前页面不再使用这两个数字作为项目结论。性能结果只有在同一冻结协议下完成重算，并留下配置、机器环境、原始产物与指标文件后，才会重新加入。

---

## 实验系统比单个算法更重要

研究过程中最容易发生的问题不是代码报错，而是把不同级别的证据混在一起。例如：

- smoke test 只能证明代码能运行，不能证明算法有效；
- development 结果可以用于诊断，不能冒充 locked holdout；
- 去重 F1 提升不等于下游模型一定变好；
- 官方基线缺少权重或推理协议时，应标记为 `UNVERIFIED` 或 `WAIVED`，不能用随机权重补一个数字。

为此，MMdedup 给每次论文级实验保存：

- experiment id、配置与代码版本；
- 数据 revision、拆分清单与 SHA；
- 硬件和容器镜像；
- 逐样本预测及汇总指标；
- 实验账本和追加式状态记录；
- `PASS / PARTIAL / NARROW / NEGATIVE / UNVERIFIED` 的结论边界。

正式计算固定在 LAB-2 的 RTX 3090 环境中，Mac 主要保存代码、合同和核心证据镜像。文本、图像和音频使用隔离环境，避免把 CUDA、TensorFlow、PyTorch 与 Java 依赖堆进一个难以复现的容器。

---

## 当前进展与边界

| 方向 | 当前可以支持的结论 | 仍不能写成的结论 |
| --- | --- | --- |
| Text-v2 | 在冻结 peS2o 协议下优于项目旧流程及若干已复现基线 | 所有外部文本语料上的 SOTA |
| Image I6 | 局部关系判定与删除安全得到改善 | DISC21 大库检索已经全面解决 |
| Audio A7 | 同协议下明显改善论文原版流程 | 严格优于所有现代音频基线 |
| Stage 4 | 3,000 条分层标注上，保守规则显著减少 naive union 的误删 | 新数据划分上的下游收益已经闭环 |

新的 A/B/C/D/E 训练清单已经按 3,000 条标注后的规则生成，但旧 LLaVA 训练和 VQAv2 quick evaluation 使用的是旧划分，只能作为诊断记录。正式下游结论仍需在新划分上重训，因此这里没有用去重指标替代训练结果。

论文目前处于 **ICDM 2026 方向的持续修订阶段**。对我来说，这个项目现在最有价值的部分，不只是某个模态的分数，而是逐渐建立了一套不会轻易把“跑通”写成“证明”的实验工作流。

---

## 项目地址

- [GitHub：xiaoyu-ops/MMdedup](https://github.com/xiaoyu-ops/MMdedup)
