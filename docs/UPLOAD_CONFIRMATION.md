# 上传内容确认

## 将上传到 Git 仓库的内容
- 扩展源码与清单：`manifest.json`、`src/`
- 阶段文档：`docs/README_阶段V1.md`、`docs/README_阶段V2.md`、`docs/README_阶段V3.md`
- 隐私与安全文档：`docs/PRIVACY.md`、`docs/SECURITY_REVIEW_V1.md`、`docs/SECURITY_REVIEW_V3.md`
- 项目说明：`README.md`
- 发布脚本：`scripts/package.sh`
- 自动化测试：`test/core.test.js`
- 构建配置：`package.json`
- 规划文档：`product-planner/`

## 不上传到 Git 的内容
- 发布压缩包：`dist/*.zip`（由 `.gitignore` 忽略）

## 可安装插件产物
- `dist/DanmakuPiP-v1.2.0.zip`

## 发布前检查结果
- `npm test`：通过（5/5）
- `npm run check:syntax`：通过
- `npm run package`：通过
