# DanmakuPiP

DanmakuPiP 是一个轻量级浏览器扩展，用于在画中画（PiP）小窗中显示 B站与 YouTube 的弹幕/时间文本。

## 项目定位
- 轻量：默认限帧与密度上限，避免高性能开销。
- 直装可用：可直接通过 Edge/Chrome 的开发者模式加载。
- 主流浏览器：当前面向 Chromium 系（Chrome / Edge）。

## 当前版本
- 版本号：`1.0.0`
- 阶段：`V1 可用版`

## V1 已实现能力
- 支持站点
  - B站点播视频页（`www.bilibili.com/video/*`）
  - YouTube watch 页面（`www.youtube.com/watch*`）
- 核心功能
  - 插件按钮一键启动/关闭 PiP 弹幕
  - PiP 内弹幕叠加渲染（滚动/顶部/底部）
  - 跟随播放、暂停、拖动、倍速同步
  - 设置页支持字号、透明度、速度、密度、关键词屏蔽
- 性能策略
  - 默认轻量模式（密度上限 + 简化渲染）

## 安装与使用（Edge / Chrome）
1. 打开浏览器扩展管理页。
2. 打开“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择本项目目录：`DanmakuPiP/`。
5. 打开 B站视频页或 YouTube watch 页，点击扩展图标。
6. 选择“启动 PiP 弹幕”。

## 打包发布
```bash
cd /home/kyutou/projects/tools/DanmakuPiP
bash scripts/package.sh
```

打包产物在：
- `dist/DanmakuPiP-v1.0.0.zip`

## 隐私与安全
- 默认不上传任何弹幕正文与用户账号信息。
- 仅请求运行所需最小权限：`storage`、`activeTab`、目标站点 host 权限。
- 不注入远程脚本，不执行 `eval`，不采集输入框或密码信息。

详细审查见：
- `docs/PRIVACY.md`
- `docs/SECURITY_REVIEW_V1.md`

## 文档索引
- 阶段说明：`docs/README_阶段V1.md`
- 产品规划：`product-planner/`
