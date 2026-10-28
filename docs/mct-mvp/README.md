# MCT 三人旅行 MVP

目标：三个独立角色从 A 前往 B，途中至少过夜一次，处理安全和补给，争取全员存活抵达。先搭环境和保留原版行为，再由实际遇到的问题决定要补什么。

当前测试方案改为普通 Minecraft 世界；Tellus 与 Mindcraft 独立，前者仅是未来可选的世界生成方案。RFC #2 Phase 0 事件记录、Phase 1 单 Agent 实际/计划轨迹、运行隔离、状态与目标标记、owo-ui 事件检查器已经落地，并用真实 Pathfinder 脚本角色验证了抵达、中断与改令。下一步再扩展三 Agent、消息关联与整体暂停。

暂停范围已确认：同次运行内三人整体暂停、观察和继续，保留进程与连接；关闭程序后恢复不纳入首版。

- [初步测试计划](TEST_PLAN.md)
- [过程记录与可视化 MVP](OBSERVABILITY.md)
- [Telemetry 事件垂直切片](TELEMETRY.md)
- [版本与许可证矩阵](VERSION-LICENSE-MATRIX.md)

## RFC #2 Phase 0：真实 agent 事件记录

当前已把真实 Mindcraft agent 的 Pathfinder、位置、决策、动作、对话、昼夜和自动进食事件接入 MindServer。它默认关闭；启用后不会改变 agent 行为，也不要求观察客户端在线：

```powershell
$env:MCT_TELEMETRY = '1'
$env:MCT_TELEMETRY_TEXT = '0'
$env:MCT_RUN_ID = 'path-overlay-spike-01'
npm start
```

事件写入 `run/evidence/<runId>/events.jsonl`。`client/observatory` 提供独立的 Fabric 1.20.1 观察客户端：从 MindServer 只读端点读取事件，在 Minecraft 内显示实际轨迹与计划路径。`tools/mct-mvp/real-pathfinder-agent.mjs` 可在普通世界中产生真实 Pathfinder 事件。观察端已有 `I` 事件检查器、`U` 选角色、`B` 简化视图与 `O` 显示开关；时间回放和完整暂停尚未实现。当前单 Agent 操作见 `client/observatory/README.md`，验证结果见 [2026-10-28 记录](VALIDATION-20261028.md)。

## 早期外部脚本演示（历史工具）

早期使用三个确定性脚本 agent 验收轨迹、事件时间线、决策链和同次运行暂停/继续，不调用模型，也不需要 Minecraft 或 Tellus：

```powershell
npm run mct:observability-demo
# 浏览器打开 http://127.0.0.1:8090
```

演示运行记录写入 `run/evidence/<runId>/events.jsonl`。它只验收观测层，不代表 Mineflayer 寻路或真实生存行为已经通过。

## Minecraft 内展示演示

旧的 Minecraft 内展示演示仍可用于检查世界空间渲染，但它是临时渲染探针，不是 RFC #2 的正式 Fabric 观察客户端。准备专用普通 MC 服务器并启用本地 RCON 后运行：

```powershell
$env:MCT_MC_PORT = '25586'
npm run mct:ingame-observability-demo
```

脚本 agent 会在世界内绘制三种颜色的方块/粒子轨迹，在关键位置生成决策浮字，并通过聊天和 actionbar 显示事件。终端输入 `p`、`r`、`q` 分别暂停、继续和退出。这个演示会改变专用演示世界中的方块和显示实体，不应接入已有存档。
- [本机设施与准备结果](ENVIRONMENT.md)
- 场景草案：`config/mct-mvp/scenario.json`。
- 原始需求：[Mindcraft issue #1](https://github.com/Void0312Aurora/mindcraft/issues/1)。

## 已有 Tellus 环境操作（历史检查）

以下命令仍指向先前建立的 Tellus 环境，保留供查阅。当前默认 profile 是 `ordinary-observability`，真实 Agent 启动器默认使用独立的 `survival` profile；测试级整体暂停尚未实现。

在仓库根目录使用 PowerShell：

```powershell
# 查看本次专用环境，避免使用其他项目的默认环境
.\tools\mct-mvp\mct.ps1 info
.\tools\mct-mvp\mct.ps1 server start tellus-mvp-1.20.1

# 可选：启动本次专用观察客户端
.\tools\mct-mvp\mct.ps1 client launch fabric-mindcraft-mvp-1.20.1 --server 127.0.0.1:25585
.\tools\mct-mvp\mct.ps1 client wait-ready fabric-mindcraft-mvp-1.20.1

# 只检查三个机器人连接，不调用 LLM，不开展旅行
node tools/mct-mvp/smoke.mjs

# 停止本项目的服务器和观察客户端
.\tools\mct-mvp\mct.ps1 down
```

## 开始真实模型试跑之前

先确定并实现观测/暂停方案，完成普通世界准备及无模型检查，再进行以下工作。

1. 勘察并填写 A/B 的游戏坐标；预先确认路上有安全起点、可获取资源和可行的路线。
2. 决定睡眠规则，填写 `sleepPolicy`：`allow-sleep` 或 `full-night`。当前尚未决定。
3. 确认起始物资。目前每人的石斧、石镐、4 原木、2 面包、4 火把只是提议；启动器不会自动发放物品、传送或清理存档。
4. 将 `config/mct-mvp/model.local.example.json` 复制为 `model.local.json`，选择对话和 embedding 模型，并按供应商需要填写 `api`、`model`、`url`。Mindcraft 会初始化技能 embeddings，需把它们计入费用。密钥从环境变量或仓库根目录被忽略的 `keys.json` 提供。
5. 确认本次运行时长、调用费用上限和手动停止方式。当前未实现强制费用限额。
6. 配置好模型和场景后，执行：

```powershell
node tools/mct-mvp/start-agents.mjs
```

此命令会启动三个完整 Mindcraft 进程，并可能在初始化 embeddings 时产生费用；不会自动发送旅行目标。三个角色进入后，先完成 A 点就位和初始物资核对，再逐条发送 `run/mission-commands.txt` 中的任务命令，开始计时和记录。原有自动模式可能在准备期间活动，正式启程前需核对三人的实际状态。

当前上游仍有单一交谈对象限制；本轮环境准备没有实现 issue #1 的多人调度改造。`language=en` 用于关闭额外的 Google 翻译调用；任务提示要求角色用中文交流。

生存环境准备命令（不启动模型）：

```powershell
$env:MCT_RUNTIME_SOURCE = (Resolve-Path 'run/ordinary-mvp-1.20.1').Path
$env:MCT_RUNTIME_PROFILE = 'survival'
.\tools\mct-mvp\prepare-ordinary.ps1
.\tools\mct-mvp\mct.ps1 server start ordinary-survival-1.20.1 --eula
```

## 当前运行配置与验收边界

运行配置集中在 `config/mct-mvp/runtime.json`。`observatory` 指向创意观察世界（25586 / MindServer 8080），`survival` 指向独立的普通生存世界（25587 / MindServer 8082），`journey` 只保留历史 Tellus 环境（25585 / MindServer 8086）。脚本和观察端通过 `MCT_RUNTIME_PROFILE` 选择，不再在多个脚本中分别写死端口。`start-agents.mjs` 和 `smoke.mjs` 默认使用 `survival`；`node tools/mct-mvp/runtime-config-smoke.mjs` 会检查三个 profile 及环境变量覆盖。

当前已通过的是创意观察世界中的单脚本 Agent 观察链：真实 Mineflayer / Pathfinder 完成抵达、中断和改令，且轨迹、决策和动作事件可在 Observatory 中读取。新的生存服务端已经完成启动、客户端入服和生存状态核对，但还没有在其中运行真实 Agent。脚本链不等同于真实 LLM 旅行；仓库没有 `config/mct-mvp/model.local.json`，因此没有启动模型或产生付费调用。过夜、饥饿、三 Agent 协作和整体暂停仍未验收。

## 已有环境范围

生存服务端位于 `run/ordinary-survival-1.20.1`（25587 / MindServer 8082），观察服务端位于 `run/ordinary-mvp-1.20.1`（25586 / MindServer 8080），观察客户端为 `fabric-mindcraft-mvp-1.20.1`。历史 Tellus 服务端仍位于 `run/tellus-mvp-1.20.1`（25585 / MindServer 8086），不属于 Mindcraft 的必要依赖。

Tellus 使用普通区域地球生成器，缩尺 30，成都附近仅作为环境准备的临时地理起点；它还不是正式 A 点。普通 Overworld 高度范围用于降低首轮适配负担。本 MVP 不要求跨越 cube-net 接缝。昼夜、天气不与现实时间同步。

这套配置是此前环境检查的产物，不是 Mindcraft 的必要依赖，也不是修订后的普通世界测试基线。`mct.json` 当前默认指向观察世界 `ordinary-mvp-1.20.1`（端口 25586），另有 `ordinary-survival` profile 指向生存服务端；观察客户端控制端口 25582、只读记录服务端口 8080。`prepare-ordinary.ps1` 按 `MCT_RUNTIME_PROFILE` 生成普通世界，默认生成生存 profile，不复制 Tellus JAR。

运行文件、存档、原始日志和本地模型配置被 Git 忽略。保留上游源码的行为；固定 Mineflayer 为上游补丁对应的 4.33.0，并添加可选事件接入和观察端。没有复制旧工程的密钥或角色配置。

重新准备一个全新环境时，`prepare.ps1` 可复用本机已有 Fabric 缓存和 Tellus JAR；它会拒绝覆盖已有服务器目录。已有世界需先保留，再另行决定如何重建。
