# MCT Observatory 版本与复用矩阵

状态：RFC #2 的实现前置检查。未列入“已确认”的项目不作为正式依赖。

| 项目 | 当前事实 | 决定 |
| --- | --- | --- |
| Minecraft | 本机普通测试环境为 Java 版 1.20.1 | 先以 1.20.1 做单 agent PoC；不要把 1.21 API 直接移植进来 |
| Fabric Loader | 普通服务器使用本地 Fabric Loader 0.20.0 | 客户端观察模组需单独确认相同版本兼容性 |
| Fabric API | 普通服务端现有 `fabric-api-0.92.12+1.20.1.jar`；观察客户端现有 `fabric-api-0.92.8+1.20.1.jar` | 观察客户端先锁定 0.92.8，避免把服务端缓存版本误当成客户端依赖 |
| Java | 当前 Fabric 1.20.1 环境使用 Java 17 | 保持 Java 17，不因可选库升级运行时 |
| Mindcraft | `mineflayer` 4.33.0、`mineflayer-pathfinder` 2.4.5 已在项目依赖中 | 作为现有 agent 与计划路径来源 |
| owo-ui / owo-lib | 官方 Maven 版本 `0.11.2+1.20`，MIT，Java 17 / Minecraft 1.20.1 客户端编译与加载已确认 | 已作为内嵌运行依赖；事件检查器复用其布局、按钮、滚动与文字换行。owo-config 暂不使用 |
| Trail Mod | 已检查 GitHub 源码 revision `3f7e887569f05d167316570dcd770b6696993cfc`；仓库 LICENSE 和 README 声明 MIT，发布页面仍存在 All Rights Reserved 标记 | 不依赖其 jar；将 `TrailRenderer.java` 的连续线段、累计距离箭头布局适配到 `TrailGeometryRenderer.java`，保留 MIT 归属和 revision 记录；发布页面与源码许可证差异继续作为 artifact 分发风险记录 |
| MiniHUD / Mob Tracing / PathTracer | 可作世界叠加语义参考 | 不作为运行时依赖；版本与许可证均需单独确认 |
| JourneyMap API | 存在自定义限制性许可证 | MVP 不使用 |
| ServerReplay | 可选的 MIT 录制方案 | MVP 不依赖，先用 JSONL telemetry 验证语义 |
| ReplayMod | GPL-3.0，属于独立回放工具 | 不嵌入观察模组 |
| DisplayKit | 资料指向 1.21.11 Fabric artifact | 与当前 1.20.1 PoC 不兼容，暂不采用 |
| Tellus / cube-net | RFC 明确不是初始依赖 | 普通世界先完成观测链；后续单独保存坐标转换来源 |

## 复用规则

参考项目的适配必须记录上游 URL、具体 revision、涉及文件、许可证和归属声明。UI 通过固定版本的 owo-lib 依赖复用，许可证保留在内嵌包和 THIRD_PARTY_NOTICES.md。轨迹部分适配 Trail Mod 的几何算法，不把它作为运行时依赖，也不复制发布 jar；MCT 的 telemetry 事件、agent 颜色、实际/计划语义和 HUD 仍由本项目维护。
