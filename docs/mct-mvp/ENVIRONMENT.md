# 本机设施盘点

核对日期：2026-10-27（Asia/Shanghai）。以下以本轮实际盘点和检查结果为准，旧项目 README 的“运行中”不作为当前证据。

方案修订：首轮采用普通 Minecraft 世界，先讨论过程可视化与可恢复暂停。下方 Tellus 结果是已经发生的设施检查，不代表 Mindcraft 依赖 Tellus，也不代表普通世界旅行或暂停能力已经准备完成。后续已完成 RFC #2 观察切片的受控客户端验证，但尚未启动真实 agent 旅行。

| 设施 | 本轮确认 |
| --- | --- |
| 新 Mindcraft fork | `D:\workshop\Game\mindcraft`，基础提交 `f6a9556cf756e6bd88a75cc2fa0d5aed7599b101`，准备分支 `mct/mvp-environment` |
| 旧 Mindcraft | `D:\workshop\Game\dsh-minecraft\mindcraft`，上游仓库，存在原有本地改动；保留不动 |
| Node / npm | Node 24.22.1 / npm 11.19.1；旧环境的 canvas、gl、Mineflayer 和 Agent 模块可以导入 |
| Java | Java 17 和 21 已安装；本次 Fabric 1.20.1 显式使用 Java 17 |
| MC Pilot | 本地 CLI 0.20.0，可通过本项目包装脚本使用；不依赖全局 PATH |
| 现有服务器 | `mc-pilot-deployment/run/tellus-boundary-20261025`，盘点时在 `127.0.0.1:25566` 运行；属于其他工作，本轮保留 |
| 现有客户端 | `tellus-1.20.1`、`fabric-dsh-1.20.1`，盘点时均未运行 |
| 本次观察客户端 | `fabric-mindcraft-mvp-1.20.1`，Fabric 1.20.1，账号 `MCT_Observer`，控制端口 `25582` |
| 本次服务器 | 独立 `run/tellus-mvp-1.20.1`，端口 `127.0.0.1:25585`，Java 最大堆 3 GiB |
| 地理数据网络 | Windows 当前代理为 `127.0.0.1:7897`；专用服务器显式使用该代理，未更改全局设置。直连首轮在远程水系数据读取阶段长时间等待 |
| Tellus 二进制 | 复用 RFC 工作区的 `Tellus-fabric-1.20.1-0.8.3.jar`；来源和 SHA256 记录在运行目录的 `artifacts.json`。版本名相同不代表等同于主线构建 |
| 依赖复用 | 仅复制旧 Mindcraft 的 `node_modules` 和被忽略的本地 lockfile；不复制密钥和旧 settings/profile |
| 资源快照 | 盘点时内存共约 31.3 GiB、可用约 11.9 GiB，D 盘剩余约 155 GiB；是瞬时状态 |
| 模型配置 | 新仓库没有 keys.json；当前进程常见四个供应商密钥环境变量均未设置。旧工程有本地密钥文件，但本轮未读取、未复制或验证其认证 |

## 验证状态

本轮环境检查通过：

- 原生依赖和完整 Agent 模块可在新仓库导入。Mineflayer 4.33.0、minecraft-data 3.117.0、pathfinder 2.4.5、canvas 3.2.3、gl 8.1.6。
- 加入本机代理后，Tellus 区域地球世界完成首次准备，服务端日志出现 `Done (71.336s)`；配置为缩尺 30、普通 Overworld、地理起点纬度 30.65/经度 103.95。
- 专用真实观察客户端已入服，位置约 `(385721.5, 85, -119572.5)`；截图已查看，可以看到实际地表、树木与水面。观察者随后切为旁观模式，三个探针仍为生存模式。
- 三个使用 Mindcraft `initBot` 的探针同时进入新服务器，每人的生命 20、食物 20、饱和度 5，且在线玩家列表包含其他探针；随后全部退出。
- 服务端查询确认 `difficulty=normal`、`doDaylightCycle=true`、`doMobSpawning=true`；Tellus 实时时间与天气覆盖均关闭。
- 对话启动入口在缺少本地模型配置时拒绝继续；未导入或调用模型来开展旅行。

可检查的本地证据：`run/evidence/smoke.json`、`run/evidence/dependencies.json`、`run/evidence/infrastructure.json`、`.mct/screenshots/environment-ready.png` 和服务端日志。本轮启动的服务端与观察客户端均已关闭，专用端口已释放；存档、实例与依赖保留。原有 `25566` 服务仍在运行。

这些结果只证明环境接通。尚未运行付费模型，没有开展跨夜旅行、饥饿、生存或协作评估；未验收寻路、合成、多人调度、地形资源分布或 cube-net 接缝。A/B、模型、费用上限和床规则仍待确定。

## 2026-10-28 复核补充

本次集成复核使用 `config/mct-mvp/runtime.json` 的 `observatory` profile：普通 1.20.1 创意服务端 `ordinary-mvp-1.20.1`（25586）、Fabric 观察客户端 `fabric-mindcraft-mvp-1.20.1`、MindServer 8080。脚本 Agent 实际入服并完成抵达、中断、改令三阶段；运行结束后客户端、服务端和脚本 MindServer 已停止，世界与运行证据保留。新增的 `survival` profile 指向独立普通生存服务端 `ordinary-survival-1.20.1`（25587 / MindServer 8082），`journey` profile 仍单独指向 25585/8086 的历史 Tellus 环境。

本机缺少 `config/mct-mvp/model.local.json`，也没有为本轮读取或复制旧工程密钥；真实 LLM、embedding、三人旅行和费用验证因此保持未执行。

生存环境已完成一次非模型连接核对：服务端 `gamemode=survival`、`difficulty=normal`、`doDaylightCycle=true`、`doMobSpawning=true`；Fabric 客户端成功进入世界，服务端查询玩家模式为 0、生命 20、食物 20。核对后已停止客户端和服务端，保留 `run/ordinary-survival-1.20.1` 存档。
