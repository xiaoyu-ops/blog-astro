# 内容更新指南

日常发 Blog 只记三步：创建、写作、发布。首页的“当前正在进行的事情”也通过本地命令维护，不需要修改首页代码。

## 1. 创建文章

在项目根目录运行。技术文章是默认类型，使用 `technical`：

```bash
pnpm new:post "用 Astro 构建个人博客" astro-blog \
  --title-en "Building a Personal Blog with Astro" \
  --description "记录博客的架构、内容管理与部署流程。" \
  --description-en "A practical look at the blog's architecture, content workflow, and deployment."
```

随手写使用 `notes`，需要显式选择：

```bash
pnpm new:post "秋招复盘" autumn-recruit-review \
  --title-en "Looking Back on Autumn Recruitment" \
  --description "秋招准备、面试复盘和后续计划。" \
  --description-en "Notes on preparation, interviews, and what comes next." \
  --category notes
```

首页 Writing 区域会根据 `category` 将文章放进 `Technical` 或 `Notes` 标签页，每个标签页固定显示三篇，超过后可在区域内滚动查看。

- 省略 `--category` 时默认为 `technical`，与首页默认打开“技术”标签保持一致。
- 默认创建草稿，方便先在本地预览。
- `--title-en` 和 `--description-en` 分别填写自然的英文标题与摘要；英文模式的首页会使用这两项。
- 命令末尾添加 `--publish` 可直接创建非草稿文章；此时必须同时填写 `--description`、`--title-en` 和 `--description-en`。

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
![图片内容说明](./images/YYYY-MM-DD-english-slug/screenshot.png)

*图 1：这里写图片说明；不需要图注时删掉这一行。*
```

截图直接使用：

- 截图保持系统保存的 `.png` 后缀，不要只靠改文件名把它写成 `.webp`。
- 把截图放进文章专属图片目录，文件名使用简短英文，例如 `score.png`。
- `![方括号里的文字]` 要描述图片内容，方便无障碍阅读。
- 图片会自动适配电脑和手机宽度，不需要手动写 HTML。
- 发布命令会自动去掉误包住图片语法的反引号、检查文件是否存在，并根据图片真实格式纠正错误后缀和 Markdown 路径。

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

1. 检查中英文标题与摘要不再是 `TODO`。
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
titleEn: "Project Name"
description: "一句话项目介绍"
descriptionEn: "A concise, natural English introduction."
date: "2026-07-21"
draft: false
order: 1
tags:
  - Astro
tagsEn:
  - Astro
---
```

- `draft: true`：本地可预览，生产环境不展示。
- `order`：数字越小，首页 Projects 中越靠前。
- `date`：`order` 相同时用于排序。
- `titleEn`、`descriptionEn`、`tagsEn`：英文模式使用的项目标题、介绍和标签，顺序与中文标签保持一致。

修改项目后同样先运行 `pnpm build`，再提交和推送。

## 更新“当前正在进行的事情”

事项数据保存在：

```text
src/data/now.json
```

新增事项时，命令会把执行当天自动记录为开始日期：

```bash
pnpm now:add robot-arm-control \
  --title "机械臂控制调试" \
  --title-en "Debugging robot-arm control" \
  --deadline 2026-09-30
```

如果事项实际开始得更早，可以显式传入 `--start YYYY-MM-DD`。开始日期一旦写入就不会因为修改标题、重新构建或重新部署而改变。

更新截止日期或文案：

```bash
pnpm now:update robot-arm-build --deadline 2026-09-30
pnpm now:update robot-arm-build --title "机械臂的搭建与调试" --title-en "Building and debugging the robot arm"
```

提前完成，并附上对应博客：

```bash
pnpm now:complete robot-arm-build \
  --date 2026-09-18 \
  --blog /blog/2026-09-18-robot-arm-build
```

- 未手动完成的事项会在截止日期到来时自动进入“已归档”。
- `--date` 省略时，完成日期默认为执行命令当天。
- 如果完成时博客还没写，可以先不加 `--blog`，之后用 `pnpm now:update <id> --blog <地址>` 补上。
- 误标完成时，运行 `pnpm now:reopen <id>` 恢复为进行中。
- 运行 `pnpm now:list` 可以查看全部事项、日期和状态。

本地预览并检查：

```bash
pnpm dev
pnpm test
pnpm build
```

确认后提交数据、脚本和文档：

```bash
git add src/data/now.json scripts/now.mjs src/content/README.md
git commit -m "update: current work"
git push
```

首页会在访客打开页面时根据本地日期重新计算时间进度：彩色部分代表已经过去的时间，留白部分代表剩余时间；页面跨过午夜保持打开时也会自动刷新。无需每天重新构建或推送。

## 什么时候才需要改前端

日常更新 Blog、Project 或当前事项时不要修改：

```text
src/pages/index.astro
src/pages/blog/[slug].astro
src/pages/projects/[slug].astro
src/styles/global.css
```

这些文件已经负责自动生成首页列表、详情页和图片排版。只有要改变整个网站的布局或样式时才修改。

不要在 `src/content/blog/` 或 `src/content/projects/` 里放普通说明用的 Markdown；这些目录中的 Markdown 都会被 Astro 当作网站内容。使用说明统一维护在当前文件中。
