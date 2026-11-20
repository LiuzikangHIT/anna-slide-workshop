# 演示工坊 · Anna Slide Workshop

演示工坊帮助准备工作汇报、提案和培训的人快速起草幻灯片。在 Anna 工作台打开应用，填写主题、受众及可选素材，选择场景、页数和文稿语言。生成后可以逐页修改标题和要点、切换配色，再下载 16:9 PPTX。PowerPoint 可继续编辑导出的文本和形状。

第一次打开时可以直接浏览或下载内置示例。点「使用示例素材」可自动填写一份 5 页培训简报，之后由你决定是否发起生成。当前稿件保留在打开的窗口内，请在关闭前导出。

## 本地开发

需要 Node.js 22 或更新版本。

```bash
npm ci
npm test
npm run validate
npm run dev
```

`npm run validate` 构建 `bundle/` 并使用 Anna CLI 校验 manifest。无模型模式的 harness 可浏览示例和导出。经 Anna 设备授权后，可使用真实模型模式接入 staging。

```bash
npx anna-app login --host https://staging.anna.partners --no-browser
npx anna-app dev --llm real --llm-account https://staging.anna.partners
```

## 架构与费用

- `src/deck.js` 构造一次有输出上限的 `anna.llm.complete` 请求，并校验模型响应的页数和字段。模型返回异常时保留当前草稿，由用户决定是否再试。
- `src/main.js` 使用 Anna iframe SDK 与工作台握手。输入素材随生成请求发给 Anna；预览、编辑和导出在浏览器内执行。
- `src/pptx.js` 用 PptxGenJS 生成原生文本与形状。示例、修改主题和文件导出均无需 AI 额度。成功生成时展示 Anna 返回的本次 CU。
- 发布包为静态资源，不包含服务端、第三方账户权限或本机工具权限。

## 平台交付

App name 为 **演示工坊**，slug 为 **`slide-workshop`**。开发者账号完成认证和 handle 设置后，构建包版本化上传，并提交 staging 审核。

```bash
npm run validate
npx anna-app apps push --account https://staging.anna.partners
npx anna-app apps cut 1.0.0 --account https://staging.anna.partners
npx anna-app apps submit-review --account https://staging.anna.partners
```

管理员批准后运行 `npx anna-app apps release 1.0.0 --account https://staging.anna.partners`，或在 Developer Console 发布。随后以可安装的 App Store 条目验证访客路径。

[Anna 发布流程](https://staging.anna.partners/developers/apps/app-publish) · [Anna App AI 接口](https://staging.anna.partners/developers/apps/llm-and-agent)
