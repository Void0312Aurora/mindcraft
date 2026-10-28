# MCT Observatory telemetry vertical slice

本文件记录当前已经落地的 RFC #2 Phase 0 事件接入，以及 Phase 1 Fabric 观察客户端的单 agent 垂直切片。

## 当前边界

当 MindServer 以 `MCT_TELEMETRY=1` 启动时，它会创建一个运行目录并接收 agent 的被动事件。默认不启用，因此普通 Mindcraft 运行不会写入新的记录，也不会等待观测端确认。

```powershell
$env:MCT_TELEMETRY = '1'
$env:MCT_TELEMETRY_TEXT = '0' # 默认不写入 prompt/回复正文
$env:MCT_RUN_ID = 'path-overlay-spike-01'
npm start
```

记录写入 `run/evidence/<runId>/`：

- `run.json`：schema 版本、运行 ID、开始/结束时间和来源元数据。
- `events.jsonl`：追加写入的规范化事件。

MindServer 同时提供一个只读轮询入口，供未来的 Fabric 观察客户端使用：

```text
GET http://127.0.0.1:8080/mct/observability/snapshot?after=42
```

返回最近的有界事件窗口和当前 `sequence`。`after` 用于断线重连时只请求新事件；telemetry 未启用时接口返回 404。当前 Socket.IO 广播仍用于浏览器和本地工具。

## 事件信封

每条记录使用 `mct-observation/v1`，包含：

```json
{
  "schema_version": "mct-observation/v1",
  "run_id": "path-overlay-spike-01",
  "id": "path-overlay-spike-01-42-abc12345",
  "kind": "navigation.path_update",
  "source": "mineflayer-pathfinder",
  "agent_id": "MCT_A",
  "entity_id": "MCT_A",
  "dimension": "minecraft:overworld",
  "world_tick": 18342,
  "observed_at": "2026-10-28T02:00:00.000Z",
  "monotonic_time": 123456,
  "sequence": 42,
  "parent_ids": ["..."],
  "action_id": null,
  "goal_id": "MCT_A-goal-1",
  "path_id": "MCT_A-path-1",
  "origin": "controller",
  "payload": {}
}
```

`observed_at` 是 MindServer 记录事件的时间；`world_tick` 是 Minecraft 状态中的时间字段。两者不能直接当作同一时钟排序。`parent_ids` 用于保留决定、动作和路径之间的可追踪关系。

## 已接入的来源

| 来源 | 事件 |
| --- | --- |
| Pathfinder | `navigation.goal_set`、`navigation.path_update`、`navigation.path_reset`、`navigation.goal_reached`、`navigation.path_stopped` |
| 实际玩家状态 | `agent.position_sample`，记录真实位置、生命、食物和当前动作 |
| MindServer 状态采样 | `agent.state_snapshot`，约每秒一次，包含现有完整状态 |
| 决策边界 | `decision.requested`、`decision.completed` |
| ActionManager | `action.started`、`action.completed`、`action.failed` |
| 对话转发 | `message.sent`、`message.delivered` |
| 世界与自动进食 | `world.time_boundary`、`world.death`、`world.food_started`、`world.food_finished`、`world.food_failed` |

Pathfinder 的 `route` 是规划路径；`agent.position_sample` 是实际位置采样。两者不共用同一条轨迹，也不通过绘图推断。

默认不写入 prompt 和模型回复正文，但决策请求仍会保留当时的结构化位置、维度、生命、食物、世界时间和当前动作。设置 `MCT_TELEMETRY_TEXT=1` 后，事件会保留可观测文本，仍不表示获得模型内部思维过程。

## Fabric 观察端切片

`client/observatory` 是独立的 Fabric 1.20.1 client-only 模组，不依赖 Tellus。每秒以 `after=<sequence>&run_id=<run>` 读取只读快照。服务端发现 run_id 不同时忽略旧序号并返回当前窗口；客户端清空旧角色、轨迹、目标、事件与选择。进入另一世界时清空并废弃旧请求。返回字段 `reset`、`first_sequence`、`dropped_events` 区分运行切换与缓存缺口。

只绘制选中 Agent：专属颜色的连续宽实线为实际采样；白色半透明连续线和箭头为当前计划。抵达、中断、失败或换目标清除旧计划；目标圆环、文字保留相应结果。角色浮标显示动作、生命与食物。`U` 选择角色，`I` 打开 owo-ui 事件检查器，`B` 切换简化播出显示，`O` 开关观察叠加。详情提供来源、原始载荷、稳定事件 ID、上游与后续链接。

事件列表只读、手动更新，不暂停世界或 Agent。脚本演示的 `decision.completed` 标注 `source=mct-script-agent`、`origin=controller`、`prescribed=true`；不能当作模型推理证据。`action.started` 在尚未设置新目标时不继承旧目标 ID；之后的 goal_set 关联动作开始，path_update / goal_reached 关联目标设定，完成或中断关联动作开始。

客户端每角色最多 512 个实际/计划采样点、8 个目标；缓存最多 256 条事件，筛选列表最多 80 条。超出窗口的关联明确提示缓存缺失，完整数据保留在 JSONL。当前不提供完整暂停、通信弧线或历史回放。显示和许可证细节见 `client/observatory/README.md`。

## 真实 Pathfinder 验证

`tools/mct-mvp/real-pathfinder-agent.mjs` 是一个独立的脚本 agent harness。它连接普通 Minecraft 世界，使用真实 Mineflayer Pathfinder 设定目标，并通过 MindServer telemetry 写入实际位置与计划路径。示例：

```powershell
$env:MCT_TELEMETRY = '1'
$env:MCT_RUN_ID = 'real-pathfinder-client-20261028-07'
$env:MCT_MC_PORT = '25586'
$env:MCT_MINDSERVER_URL = 'http://127.0.0.1:8080'
$env:MCT_TARGET_X = '-32'
$env:MCT_TARGET_Y = '71'
$env:MCT_TARGET_Z = '-2'
npm run mct:real-pathfinder-agent
```

已保存的一次真实结果位于 `run/evidence/real-pathfinder-client-20261028-07/`：9 条事件，从 `(-10.21,65,2.30)` 出发，计划路径包含 20 个点，实际位置采样 6 个，最终在 `(-30.48,71,-1.50)` 触发 `navigation.goal_reached`。早期受控视觉回归截图 `run/evidence/visual-markers-20261028-01.png` 保留了旧 ribbon 实现；当前 Trail Mod 几何适配的连续路径证据见 `run/evidence/trail-render-adaptation-20261028-06-arrows.png`。这验证了真实寻路事件进入 JSONL 和 Minecraft 内叠加，但仍不是三 agent 生存旅行。

单 Agent 的干净复测使用 `MCT_A`，新建 MindServer 运行并重启观察客户端后没有混入其他 agent。`run/evidence/single-agent-real-20261028-02/MCT_A-script-summary.json` 记录 20 条事件、14 个实际位置采样、52 个最终计划点，并以 `navigation.goal_reached` 结束；实际终点 `(-9.5,65,18.47)` 与最终计划点 `(-9.5,65,18.5)` 相差约 0.03 方块。对应截图为 `run/evidence/single-agent-real-20261028-02.png`，HUD 只显示 `MCT_A` 一行。

## 当前验收

```powershell
npm run mct:telemetry-smoke
npm run mct:agent-telemetry-smoke
npm run mct:telemetry-bridge-smoke
```

前三个检查分别验证事件契约、agent 侧事件和 MindServer 桥接。真实 Pathfinder harness 又验证了普通世界中的实际目标、计划路径、位置采样和抵达事件；Fabric 客户端验证了 HTTP 轮询、HUD 计数以及真实路径线的世界绘制。Trail Mod 几何适配后的受控客户端回归截图为 `run/evidence/trail-render-adaptation-20261028-06-arrows.png`，其中青色实际轨迹和白色计划轨迹均为连续可见路径，白色路径上可见方向箭头。上述结果仍不覆盖三 agent、跨夜生存或暂停恢复。


## 2026-10-28 单 Agent 结果

运行隔离、单角色状态/目标、owo-ui 检查器和 arrive / interrupt / redirect 场景已实测。详见 [验证记录](VALIDATION-20261028.md)。复用运行标签会自动添加唯一后缀，保留旧 JSONL。

决定事件上的 goal_id 表示触发当时的目标上下文；新指令的目标由后续 navigation.goal_set 事件给出。两者不能混作同一个时间点。

## 2026-10-28 集成复核补充

普通测试环境和 Journey Survival 环境由 `config/mct-mvp/runtime.json` 分开描述：默认 `observatory` 使用普通世界 `25586` / MindServer `8080`，`journey` 使用独立的 `25585` / `8086`。脚本可通过 `MCT_RUNTIME_PROFILE` 以及端口环境变量覆盖；不会从旧 Tellus 路径隐式切换普通环境。`prepare-ordinary.ps1` 现在要求显式提供通用 Fabric 运行时目录。

MindServer 状态轮询对每个 Agent 使用有界等待，并复用同一轮采集 Promise，避免失联 Agent 阻塞其他 Agent 或形成请求堆积。超时、断线和空响应以 `agent.state_request_timeout`、`agent.state_request_disconnected`、`agent.state_request_empty_response` 记录；恢复后状态快照继续保留原始嵌套结构。

`agent.state_snapshot` 的 `payload` 使用 `gameplay` 和 `action` 原始层级；客户端从嵌套字段读取生命、饥饿、位置和动作。`gameplay.worldTick` 写入事件顶层 `world_tick`，`gameplay.timeOfDay` 仍是游戏日内时间，不能互换。实际位置采样包含 `segment_break`，客户端遇到 Y 方向、维度、死亡重生或大跳变时分段，绝不把断裂段渲染成连续意图。

当前同步 JSONL 追加仍保留：`telemetry-performance-smoke` 对 1 和 3 个逻辑 Agent 做的是合成写入上界测量，不等同于真实长时间服务器稳定性。若真实实验中事件频率或磁盘延迟超过该边界，再改为有界异步写入。
