# 演示工坊 · Anna Slide Workshop

演示工坊是 Anna 工作台里的演示文稿编辑器。输入主题和参考素材，即可起草 5–30 页的中文或英文演示，逐页修改后导出可在 PowerPoint 中继续编辑的 16:9 PPTX。

## 主要功能

- **分步起草**。先确定章节和页标题，再按章节生成正文、讲者备注和来源。生成中断后可继续处理未完成的页面。
- **逐页排版**。切换模板，修改文字和图示，或让 Anna 为当前页生成候选稿。有数据和单位的素材可用于制作图表。
- **检查与导出**。导出前检查缺页、文字溢出和必讲内容，也可请 Anna 核对内容与素材是否一致。PPTX 保留原生文本框、形状、数据图表和讲者备注。
- **草稿恢复**。连接 Anna 后，草稿可保存到当前账号的应用存储。离线使用时可下载 JSON 草稿，通过「导入草稿文件」继续编辑。

## 使用说明

### 快速开始

本地开发需要 Node.js 22 或更高版本。使用 Anna 本地宿主还需安装 uv，确保终端可以运行 `uvx`。

```sh
git clone https://github.com/LiuzikangHIT/anna-slide-workshop.git
cd anna-slide-workshop
npm ci
npm run build
npm run dev
```

打开终端给出的预览地址，选择「体验示例」即可查看、编辑并导出内置文稿。默认本地模式无需模型额度。

如需用自己的素材生成文稿，先停止默认宿主，再通过有额度的 Anna staging 账号完成设备授权并启动宿主。

```sh
npx anna-app login --host https://staging.anna.partners --no-browser
npx anna-app dev --slug slide-workshop --llm-account https://staging.anna.partners --storage aps
```

### 使用示例

以制作一份 **5 页的新员工知识库培训** 为例。

1. 填写主题「怎样在团队知识库找到答案」，受众填「新入职的同事」，选择简体中文和 5 页。在素材中写入团队的实际流程，例如「先按业务关键词搜索，再核对文档负责人和更新时间；仍有疑问时，附上已读链接向负责人提问」。
2. 选择「用 Anna 起草大纲」，检查搜索、核对和提问三个环节是否齐全。调整页标题后，选择「确认大纲，生成文字稿」。
3. 检查每页正文和讲者备注，再选择「确认文字稿，生成排版」。在预览中调整模板，把末页改成一道让新人实际操作的练习。
4. 运行检查，修正提示的结构问题后下载 PPTX。用 PowerPoint 打开文件，可继续编辑末页练习并查看讲者备注。

## 技术说明

界面由原生 HTML、CSS 和 JavaScript ES 模块实现。应用通过 Anna SDK 调用模型起草和评审内容，实际模型和 CU 用量以平台回执为准。手工编辑、预览和 PptxGenJS 导出都在浏览器内完成。

在线草稿使用 Anna APS 存储。更新时携带上一版本的 ETag 检测保存冲突。较大的草稿分片写入，全部写完后再更新索引。

`npm test` 运行离线测试，覆盖草稿恢复、保存冲突和 PPTX 文件结构。`npm run validate` 重新构建静态资源，并通过 Anna CLI 严格校验应用清单。

## 目录结构

```text
src/
  index.html、styles.css   页面入口与样式
  main.js                 界面交互与制作流程
  deck.js                 文稿数据与大纲
  anna.js                 Anna 模型调用
  visual.js、review.js     视觉元素与文稿检查
  storage.js              草稿存取
  pptx.js                 PowerPoint 导出
scripts/build.mjs         构建静态资源
test/deck.test.js         离线测试
app.json、manifest.json   应用信息与 Anna 平台清单
bundle/                   本地构建产物
```