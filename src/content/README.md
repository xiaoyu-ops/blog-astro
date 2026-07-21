# 内容更新指南

日常发 Blog 只记三步：创建、写作、发布。

## 1. 创建文章

在项目根目录运行：

```bash
pnpm post:new "文章标题" english-slug --description "一句话摘要"
```

例如：

```bash
pnpm post:new "秋招复盘" autumn-recruit-review --description "秋招准备、面试复盘和后续计划。"
```

命令会同时创建：

```text
src/content/blog/YYYY-MM-DD-english-slug.md
src/content/blog/images/YYYY-MM-DD-english-slug/
```

终端会打印文章路径、图片目录、本地预览地址和发布命令，不需要自己记。

## 2. 写文章和放图片

正文直接写进生成的 Markdown。

把图片放进命令生成的图片目录，然后在文章里写：

```md
![图片内容说明](./images/YYYY-MM-DD-english-slug/example.webp)

*图 1：这里写图片说明；不需要图注时删掉这一行。*
```

图片建议：

- 照片和截图优先使用 WebP；需要透明背景时使用 PNG。
- 图片文件名使用简短英文，例如 `architecture.webp`。
- `![方括号里的文字]` 要描述图片内容，方便无障碍阅读。
- 图片会自动适配电脑和手机宽度，不需要手动写 HTML。

本地预览：

```bash
pnpm dev
```

打开创建命令打印的 `/blog/...` 地址即可。草稿会在本地显示，并带有 `Draft` 标记；生产构建不会包含草稿。

## 3. 发布文章

写完后运行创建命令最后打印的发布命令：

```bash
pnpm post:publish YYYY-MM-DD-english-slug
```

它会：

1. 检查摘要不再是 `TODO`。
2. 把 `draft: true` 改成 `draft: false`。
3. 运行生产构建，检查文章、图片、首页和 sitemap。
4. 构建失败时自动恢复为草稿；构建通过后打印 Git 提交命令。

最后执行终端打印的命令：

```bash
git add src/content/blog
git commit -m "publish: YYYY-MM-DD-english-slug"
git push
```

如果部署平台已经连接 GitHub 的 `main` 分支，push 后会自动上线。

## 更新已有 Blog

直接修改对应 Markdown 或图片，然后执行：

```bash
pnpm build
git add src/content/blog
git commit -m "update: 文章名称"
git push
```

## 更新 Project

项目内容放在：

```text
src/content/projects/
```

每个项目使用一个 `.md` 或 `.mdx` 文件。常用 frontmatter：

```yaml
---
title: "项目名称"
description: "一句话项目介绍"
date: "2026-07-21"
draft: false
order: 1
tags:
  - Astro
---
```

- `draft: true`：本地可预览，生产环境不展示。
- `order`：数字越小，首页 Projects 中越靠前。
- `date`：`order` 相同时用于排序。

修改项目后同样先运行 `pnpm build`，再提交和推送。

## 什么时候才需要改前端

日常更新 Blog 或 Project 时不要修改：

```text
src/pages/index.astro
src/pages/blog/[slug].astro
src/pages/projects/[slug].astro
src/styles/global.css
```

这些文件已经负责自动生成首页列表、详情页和图片排版。只有要改变整个网站的布局或样式时才修改。

不要在 `src/content/blog/` 或 `src/content/projects/` 里放普通说明用的 Markdown；这些目录中的 Markdown 都会被 Astro 当作网站内容。使用说明统一维护在当前文件中。
