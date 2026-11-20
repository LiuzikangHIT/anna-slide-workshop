# Anna 演示工坊

## 项目概览

面向 Anna staging 的纯前端演示文稿 App。Anna Host API 起草投影片，浏览器负责预览、编辑和导出。

## 构建与测试命令

- `npm ci` 安装依赖
- `npm run build` 生成 Anna UI bundle
- `npm test` 执行离线测试
- `npm run validate` 构建并校验 Anna manifest

## 代码风格与规范

原生 HTML、CSS 和 JavaScript ES 模块。保持变更聚焦，关键行为使用简洁中文注释。Windows 文件删除逐个处理。

## 测试说明

默认测试不消耗平台额度。发布前在 staging 走通主题输入、生成、编辑及 PPTX 下载，记录实际 CU。

## 安全注意事项

通过 Anna SDK 调用平台模型。凭据、开发者 PAT、真实用户素材及本地构建产物不入库。模型输出按数据处理。

## 技术文档索引

- [Anna 演示工坊开发计划](docs/dev/plan/20261120T1551-PLAN-Anna演示工坊.md)：范围、实现、测试和发布验收。
- [Anna staging 扩展实测](docs/dev/plan/20261120T1636-PLAN-Anna扩展实测.md)：复杂素材、真实模型额度和 PPTX 验收。
- [Claude Fable 5.1 高推理复测](docs/dev/plan/20261120T1645-PLAN-Fable高推理复测.md)：模型选择、额度与六个用例的横向对比。
