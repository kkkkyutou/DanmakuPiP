# 技术架构草图：PiP 弹幕浏览器插件

## 1. 架构总览
- 架构形态：Chrome Extension Manifest V3 + 站点内容脚本 + Doc-PiP 渲染窗口。
- 设计原则：
  - 站点适配与渲染引擎解耦。
  - 事件驱动，统一弹幕数据模型。
  - 优先本地处理，默认不上传用户数据。
  - 轻量优先：默认限帧、限密度、限制渲染复杂度。

## 2. 功能模块树
- 用户侧模块
  - 插件弹窗（Popup）：开关 PiP、基础参数设置。
  - 选项页（Options）：基础参数、黑名单词库。
  - PiP 窗口（Renderer）：视频画面 + 弹幕层。
- 系统侧模块
  - Site Adapter 层：
    - `BilibiliAdapter`
    - `YouTubeAdapter`（MVP 基础接入）
  - Danmaku Engine：
    - `Scheduler`（时间调度）
    - `Layout`（轨道分配）
    - `Renderer`（Canvas，MVP 不引入复杂特效）
  - State Sync：
    - 播放状态同步（play/pause/seek/rate）
    - 页面生命周期恢复（reload/navigation）
  - Telemetry（本地）：
    - 错误码、渲染耗时、丢帧统计

## 3. 关键数据流
1. Content Script 在目标页面检测视频元素与站点上下文。
2. Adapter 获取站点弹幕源并映射为统一 `DanmakuEvent`。
3. `DanmakuEvent` 通过消息总线传给 PiP Renderer。
4. Renderer 根据视频 `currentTime` 调度弹幕入轨并绘制。
5. 用户在 Popup/Options 改配置，写入 `chrome.storage`，实时通知 Renderer 更新。

## 4. 数据模型（核心字段）
```ts
type DanmakuEvent = {
  id: string;
  source: "bilibili" | "youtube";
  timestampMs: number;
  mode: "scroll" | "top" | "bottom";
  text: string;
  color: string;
  size: number;
  priority: number;
  meta?: {
    userId?: string;
    roomId?: string;
    rawType?: string;
  };
};
```

## 5. 服务边界与职责
- 浏览器扩展前端
  - 负责 UI、采集、同步、渲染、设置管理。
- 后端服务（默认无）
  - MVP 与首发阶段均不依赖自建后端。
  - 发布后仅在确有必要时再评估是否增加轻量配置分发服务。
- 存储
  - 本地存储：`chrome.storage.local`。
  - 不引入数据库（MVP）。

## 6. 外部依赖
- 浏览器 API
  - `chrome.scripting`, `chrome.tabs`, `chrome.storage`, `runtime messaging`。
  - `Document Picture-in-Picture API`（核心）。
- 站点页面环境
  - Bilibili 页面播放器对象与弹幕源接口（按 adapter 封装）。
  - YouTube 点播页面对象与评论流映射接口（按 adapter 封装）。

## 7. 兼容与降级策略
- 优先路径：Doc-PiP 可用 -> 在 PiP 文档内渲染弹幕层。
- 降级路径：Doc-PiP 不可用 -> 提示“当前浏览器仅支持普通 PiP，无内嵌弹幕”，MVP 阶段不提供外挂小窗模式。
- 容错策略：
  - 站点 DOM 变化后，adapter 健康检查失败自动停用并提示。

## 8. 推荐目录结构
```text
src/
  background/
    index.ts
  content/
    index.ts
    adapters/
      base.ts
      bilibili.ts
      youtube.ts
  pip/
    document.html
    renderer.ts
    engine/
      scheduler.ts
      layout.ts
      renderer-canvas.ts
  shared/
    model.ts
    messaging.ts
    settings.ts
```
