# 阶段 V2 说明（稳定增强）

## 目标
在 V1 可用基础上，提升稳定性、兼容性与性能，达到日常可用。

## 本阶段完成项
- 渲染限帧（`maxFps`）与密度上限控制。
- 弹幕归一化去重，减少重复刷屏。
- URL 切换自动重载（YouTube 单页切换场景）。
- seek/大幅跳时自动重同步，避免弹幕错位。
- 设置页新增最大帧率配置项。

## 验收结果
- 日常点播场景可持续运行，切换视频恢复能力提升。
- 在保持可读性的同时降低不必要渲染开销。

## 输出物
- `src/shared/core.js`
- `src/content/content.js`
- `src/options/options.html`
- `src/options/options.js`
