# 安全审查记录（V3）

## 审查日期
- 2026-03-31

## 审查结论
当前 `v1.2.0` 满足“轻量、最小权限、本地处理”的发布要求，可作为发布版本。

## 主要检查结果
1. 权限
- `manifest.json` 仅包含 `storage`、`activeTab` 与目标站点 host 权限。
- 未申请 `webRequest`、`downloads`、`history` 等高敏权限。

2. 执行安全
- 无 `eval` / `new Function`。
- 无远程脚本注入与动态代码下载执行。

3. 数据隐私
- 不上传弹幕正文与用户身份数据。
- 本地仅保存功能配置（字号、速度、密度、屏蔽词、FPS）。

4. 依赖与供应链
- 无第三方 npm 运行时依赖。
- 自动化测试依赖 Node 内置 `node:test`，降低供应链风险。

5. 网络边界
- 仅访问 B站与 YouTube 相关路径。
- 未接入第三方统计或广告 SDK。

## 已知限制
- YouTube 使用时间文本映射能力，受页面结构变化影响。
- 暂未覆盖直播场景。

## 发布建议
- 可发布 `dist/DanmakuPiP-v1.2.0.zip`。
- 每次版本发布前执行：
  - `npm test`
  - `npm run check:syntax`
  - `npm run package`
