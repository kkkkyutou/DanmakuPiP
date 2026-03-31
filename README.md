# DanmakuPiP

轻量浏览器扩展：在画中画（PiP）窗口显示 B站和 YouTube 的弹幕/时间文本。

## 支持范围
- 浏览器：Edge / Chrome（Chromium）
- 站点：B站点播、YouTube 点播
- 版本：`1.2.0`

## 三阶段实现状态
- V1 核心可用：完成（基础弹幕同步 + 设置页）
- V2 稳定增强：完成（限帧、去重、URL 切换重载、兼容提升）
- V3 发布就绪：完成（自动化测试、文档完善、扩展预留）

## 安装（开发者模式）
1. 打开浏览器扩展管理页，启用开发者模式。
2. 选择“加载已解压的扩展程序”。
3. 选择项目目录：`DanmakuPiP/`。
4. 打开 B站视频页或 YouTube watch 页，点击扩展图标启动。

## 打包
```bash
cd /home/kyutou/projects/tools/DanmakuPiP
npm run package
```
产物：`dist/DanmakuPiP-v1.2.0.zip`

## 测试与检查
```bash
npm test
npm run check:syntax
```

## 隐私与安全
- 默认本地处理，不上传弹幕正文。
- 最小权限：`storage`、`activeTab` 与目标站点 host 权限。
- 详见：
  - `docs/PRIVACY.md`
  - `docs/SECURITY_REVIEW_V3.md`

## 阶段文档
- `docs/README_阶段V1.md`
- `docs/README_阶段V2.md`
- `docs/README_阶段V3.md`
