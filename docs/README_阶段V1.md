# 阶段 V1 说明（可用版）

## 阶段目标
交付一个可直接安装、可在 Edge/Chrome 使用的轻量弹幕 PiP 扩展，并完成首轮隐私与安全自查。

## 本阶段交付物
- 扩展核心代码（MV3）
  - `manifest.json`
  - `src/background/service-worker.js`
  - `src/content/content.js`
  - `src/popup/*`
  - `src/options/*`
- 发布文档
  - `README.md`
  - `docs/PRIVACY.md`
  - `docs/SECURITY_REVIEW_V1.md`
- 打包脚本与产物
  - `scripts/package.sh`
  - `dist/DanmakuPiP-v1.0.0.zip`

## 本阶段验收标准
- 能在 B站视频页启动 PiP 弹幕。
- 能在 YouTube watch 页加载时间文本并在 PiP 显示。
- 设置页修改参数后可即时生效。
- 可成功生成 zip 发布包。

## 已知限制
- YouTube 当前采用时间文本（caption）映射，不等同于原生弹幕流。
- 暂不支持直播场景。
- 仅支持 Chromium 主流浏览器。

## 下一阶段（V2）建议
- 提升 YouTube 页面切换稳定性。
- 强化异常提示与自动恢复。
- 做跨版本兼容回归和性能基线自动检查。
