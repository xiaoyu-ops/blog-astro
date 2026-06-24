---
title: "深信服科技 — AI 算法实习生"
description: "为自进化终端安全 Agent 构建双路径聚类管道，识别罕见攻击模式（Rare TTP）。识别准确率超 70%，生成 2000+ 高价值训练样本。"
date: "2026-02-01"
tags:
  - Python
  - 聚类
  - 安全
  - AI
  - 实习
---

## 职位

**AI 算法实习生** · 深信服科技 · 2026年2月 – 2026年4月 · 深圳

## 项目背景

深信服终端安全产品需要持续进化以应对新型攻击。传统基于规则的安全防护无法应对**罕见攻击模式（Rare TTP, Tactics Techniques Procedures）**，而这些正是高级持续性威胁（APT）的典型特征。

**核心挑战**：
- 罕见攻击样本极少（正样本稀缺），传统监督学习失效
- 需要自动发现未知攻击模式，而非依赖人工规则
- 识别结果需要可解释，供安全运营团队审核

**解决方案**：构建**双路径聚类管道**，结合语义向量相似性和进程树结构模式，自动识别 Rare TTP，并生成高价值训练样本反哺安全 Agent。

---

## 系统架构

![深信服双路径聚类架构](/images/architecture/sangfor-arch.svg)

### 整体流程

```
终端行为数据（进程树 · API 调用 · 文件操作）
           │
           ├──► 路径 A: 语义向量
           │     · Embedding 编码
           │     · 基于嵌入的相似性聚类
           │
           └──► 路径 B: 进程树 DFS 序列化
                 · 结构模式匹配
                 · 保留父子关系和执行顺序
           │
           ▼
    ┌─────────────────┐
    │   双路径融合层    │
    │  向量相似度 + 结构匹配 │
    │  联合评分 → 异常检测  │
    │  Rare TTP 识别     │
    └─────────────────┘
           │
           ▼
    输出: 罕见攻击模式标注 + 高价值训练样本
```

---

## 路径 A: 语义向量聚类

### 行为 Embedding 编码

将终端行为（API 调用序列、文件操作、注册表访问等）编码为固定维度的向量：

```python
# 行为序列编码示例
def encode_behavior(api_calls, file_ops, registry_ops):
    # 1. 构建行为词汇表
    behavior_tokens = api_calls + file_ops + registry_ops
    
    # 2. 使用预训练模型编码（或自训练）
    embedding = behavior_encoder.encode(behavior_tokens)
    
    # 3. 聚合为固定长度向量
    return aggregate_embedding(embedding)
```

### 相似性聚类

使用 **HDBSCAN** 或 **DBSCAN** 进行密度聚类：
- 正常行为形成密集簇（高密度区域）
- 罕见攻击落在稀疏区域（低密度区域）
- 通过密度阈值自动识别异常点

```python
from sklearn.cluster import DBSCAN

# 密度聚类
clusterer = DBSCAN(eps=0.5, min_samples=10)
labels = clusterer.fit_predict(behavior_embeddings)

# 标签为 -1 的样本 = 异常点（Rare TTP 候选）
rare_ttp_candidates = embeddings[labels == -1]
```

---

## 路径 B: 进程树结构匹配

### DFS 序列化

将进程树转换为深度优先搜索（DFS）序列，保留结构信息：

```
原始进程树:
  cmd.exe
  ├── powershell.exe
  │   ├── net.exe (query user)
  │   └── reg.exe (query run key)
  └── explorer.exe

DFS 序列化:
  "cmd.exe[powershell.exe[net.exe|reg.exe]|explorer.exe]"
```

### 结构模式匹配

使用 **树编辑距离（Tree Edit Distance）** 或 **子树同构检测** 衡量进程树相似性：

| 匹配类型 | 方法 | 用途 |
|---------|------|------|
| 精确匹配 | 哈希比对 | 已知恶意家族识别 |
| 近似匹配 | 树编辑距离 | 变种攻击发现 |
| 子树匹配 | 子树同构 | 攻击阶段识别 |

---

## 双路径融合

### 联合评分机制

将两条路径的评分融合，提高 Rare TTP 识别准确率：

$$
Score_{fusion} = \alpha \cdot Score_{semantic} + (1-\alpha) \cdot Score_{structural}$$

其中：
- $Score_{semantic}$ = 语义向量路径的异常分数（密度聚类的逆密度）
- $Score_{structural}$ = 进程树路径的异常分数（结构匹配差异度）
- $\alpha$ = 融合权重（通过验证集调优，通常 0.6 ~ 0.7）

### 决策逻辑

```python
def is_rare_ttp(semantic_score, structural_score, threshold=0.8):
    fusion_score = 0.65 * semantic_score + 0.35 * structural_score
    
    # 双路径同时异常 → 高置信度 Rare TTP
    if semantic_score > threshold and structural_score > threshold:
        return "HIGH_CONFIDENCE"
    
    # 单路径异常 → 中置信度，需人工审核
    elif fusion_score > threshold:
        return "MEDIUM_CONFIDENCE"
    
    # 正常行为
    else:
        return "BENIGN"
```

---

## 自进化 Agent 闭环

### 训练样本生成

识别出的 Rare TTP 自动进入训练样本池：

```
Rare TTP 识别
    │
    ├──► 运营团队审核（>80% 合格率）
    │     │
    │     ├──► 通过 → 加入训练集
    │     │
    │     └──► 拒绝 → 分析原因，优化模型
    │
    └──► 定期重训练 Agent
          │
          └──► 检测能力提升 → 发现更多 Rare TTP
```

### 样本质量控制

- **运营合格率** > 80%：确保训练样本的准确性
- **多样性约束**：避免同类攻击过度采样
- **时间衰减**：旧样本权重逐渐降低，适应攻击演进

---

## 成果数据

| 指标 | 数值 | 说明 |
|------|------|------|
| 罕见样本识别准确率 | **>70%** | 正样本极少场景下的识别能力 |
| 运营合格率 | **>80%** | 通过运营团队审核的比例 |
| 高价值训练样本生成 | **2,000+** | 用于 Agent 持续进化 |
| 覆盖终端数 | 企业级 | 深信服终端安全产品部署 |
| 攻击类型覆盖 | APT / 0-day / 变种木马 | 多种罕见攻击模式 |

---

## 技术栈

| 技术 | 用途 |
|------|------|
| Python | 数据处理、模型训练 |
| scikit-learn | 密度聚类（DBSCAN / HDBSCAN）|
| sentence-transformers | 行为序列 Embedding |
| NetworkX | 进程树结构分析 |
| pandas / numpy | 数据清洗与特征工程 |

---

## 实习收获

1. **工业级 AI 落地经验**：从算法设计到生产部署的完整流程
2. **安全领域知识**：深入了解终端安全、APT 攻击模式、TTP 框架
3. **数据驱动思维**：通过指标（准确率、合格率）持续优化系统
4. **跨团队协作**：与产品、运营、研发团队的高效沟通

---

## 链接

- 实习内容涉及公司机密，GitHub 仓库为私有
- 如需了解更多，欢迎通过邮件联系