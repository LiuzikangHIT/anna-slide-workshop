# 演示工坊 · Anna Slide Workshop

演示工坊是 Anna 工作台里的幻灯片应用。输入主题，可补充受众和素材，生成 5、7 或 9 页的中文或英文文稿。可以逐页修改标题和要点、切换配色，再下载 16:9 PPTX。导出的文本和形状可在 PowerPoint 中继续编辑。

首次打开可直接预览和下载内置示例。「使用示例素材」会填入新员工培训的素材，点击生成后才会调用 Anna。草稿保存在当前窗口，关闭前请先导出。

## 本地开发

构建需要 Node.js 22 或更新版本。本地预览还需要 `uvx`（由 uv 提供）。

```bash
npm ci
npm test
npm run validate
npm run dev
```

`npm run validate` 构建 `bundle/` 并用 Anna CLI 校验 `manifest.json`。`npm run dev` 启动本地 Anna 宿主，可以预览示例并下载 PPTX。要连接 staging 模型，先按提示完成 Anna 设备授权。

```bash
npx anna-app login --host https://staging.anna.partners --no-browser
npx anna-app dev --slug slide-workshop --llm-account https://staging.anna.partners
```

## 实现与用量

- `src/deck.js` 每次生成只调用一次 `anna.llm.complete`，并检查返回的页数和字段。生成失败时保留当前草稿。
- `src/main.js` 通过 Anna SDK 连接工作台。素材随生成请求发给 Anna，页面显示平台返回的用量（CU）。预览和编辑在浏览器内运行。
- `src/pptx.js` 在浏览器中用 PptxGenJS 导出原生文本和形状。浏览示例、换配色和导出均不消耗模型额度。

## 测试

`npm test` 覆盖请求次数与长度限制、响应校验、截断处理和 PPTX 导出。六个 staging 用例覆盖了中英文和 5、7、9 页文稿，均通过页数、画幅、可编辑内容与修改后导出的检查。实测中有长句被截断，也有个别业务条件遗漏，使用生成稿前应核对关键信息。
