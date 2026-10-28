# 单 Agent 观察链验证 · 2026-10-28

## 完成范围

按约定顺序实现：运行隔离 → 单角色状态/目标 → Minecraft 内事件检查器 → 真实脚本角色演示。

- 新 run_id 自动清空角色、实际轨迹、计划、目标、选择和事件列表。服务端忽略旧运行序号；复用运行标签时添加唯一后缀，保留旧记录。
- 当前只绘制选中角色。实际为青色宽实线，计划为白色半透明线和箭头；结束/中断/失败/换目标清除旧计划。
- 浮动角色状态和目标圆环显示运行结果；同坐标多次访问仅画最新目标标记，完整访问记录仍保留在事件中。
- `I` 检查器实际复用 owo-ui `0.11.2+1.20` 的布局、滚动、按钮和换行。支持类别筛选、稳定 ID、来源和上游/后续跳转。列表为只读快照，手动更新。
- `U` 选择、`B` 简化播出、`O` 显示开关。快捷键可在原版控制设置中修改。

## 真实场景结果

最终脚本运行：`observer-phase1-20261028-03`，普通 Minecraft 1.20.1，仅一名 Agent `MCT_A`，另有观察者 `MCT_Observer`。使用真实 Mineflayer / Pathfinder；所有任务和中断均由脚本规定，LLM 调用数为 0。

| 阶段 | 结果 | 实际位置 |
| --- | --- | --- |
| 前往目标 (-10,65,20) | arrived | (-9.50,65,18.47) |
| 返回起点，移动约 3 方块后由脚本中断 | interrupted | (-9.50,65,15.44) |
| 改令返回目标 (-10,65,20) | arrived | (-9.50,65,18.41) |

43 条事件，20 个实际位置采样；事件 ID 无重复，所有 parent_ids 都在本次记录中，三个动作开始事件均未错误继承前一目标。GoalNear 容差为 2 方块，两次抵达均在该范围内，不要求与目标坐标重合。

- 完整记录：`run/evidence/observer-phase1-20261028-03/events.jsonl`
- 阶段结果：`run/evidence/observer-phase1-20261028-03/scenario-summary.json`
- 数据核对：`run/evidence/observer-phase1-20261028-03/verification.json`
- 行进时实际/计划路径：`run/evidence/observer-phase1-02-travelling.png`
- 点击动作上游进入脚本指令：`run/evidence/observer-phase1-03-script-decision.png`
- 最终目标与角色浮标：`run/evidence/observer-phase1-final-goal.png`

客户端保持在线，由旧序号 44 的运行切换到新运行 1，旧记录自动消失；之后再切到 `observer-empty-20261028-01`，画面无旧角色、轨迹或目标，检查器为空、序号为 0：

- `run/evidence/observer-phase1-03-auto-reset.png`
- `run/evidence/observer-empty-01-reset.png`
- `run/evidence/observer-empty-01-inspector.png`

关闭只读服务后，客户端显示 disconnected (cached view)：`run/evidence/observer-empty-01-disconnected.png`。背景彩色实体方块是此前演示的遗留物，本轮观察端不向世界放置轨迹方块或显示实体。

## 构建和回归

- Gradle `build` 通过，包含 `stateSmoke`：运行切换、清空、旧目标关联、中断和增量去重。
- `mct:telemetry-smoke` 通过：事件契约、因果 ID、重复标签保留旧记录、缓存缺口。
- `mct:agent-telemetry-smoke` 通过：真实接入边界、动作到目标/抵达关联、清除寻路不生成假目标。
- `mct:telemetry-bridge-smoke` 通过：Socket.IO → JSONL → HTTP、新运行忽略旧高序号、同运行增量不重复。
- owo 官方 Maven 自动下载曾阻塞；实际使用从官方源取得的同版本包，经仓库外临时 Maven 缓存构建，项目依赖仍是官方固定坐标。
- 最终客户端包和部署包 SHA256 相同：`E6AB746850C694A5B9D8C0A829976A6227AE49370373C3F07C90C478C20BC288`。包中包含 owo 与许可证说明，运行日志确认 owo / Jankson 加载。

首次运行发现浮字每帧分配原生缓冲导致内存耗尽，已改为复用单一缓冲并复测。后续观察期间未复现，不据此声称长期运行稳定。最后一次启动的 MC Pilot wait-ready 曾超时；随后实际位置查询、截图与界面交互成功，日志确认已经进服；该就绪探测误差的原因尚未定位。

## 当前边界

本轮只验证观测链，短路线主动设为白天。脚本阶段等待 Enter 时世界仍运行；打开检查器也不暂停。未验收完整可恢复暂停、三 Agent 消息协作、LLM 决策、过夜与饥饿生存，也没有历史回放。以上内容留待后续阶段。

测试结束后关闭本轮脚本、记录服务、观察客户端和普通测试服务器，保留世界与证据。

## 集成修复后的补充复验

在同一普通 1.20.1 服务端上重新执行单 Agent 脚本验收：`integration-recheck-20261028-03`。这次使用 `observatory` runtime profile、自动推进检查点，避免交互终端输入影响结果；仍然是脚本 Agent，LLM 调用数为 0。

- 运行结果仍为 `arrived → interrupted → arrived`，实际事件 43 条，其中位置采样 20 条。
- `events.jsonl` 中包含 3 次 `decision.requested`、3 次 `action.started`、1 次 `action.interrupted`、2 次 `navigation.goal_reached`；`scenario-summary.json` 保存三阶段结果。
- 观察端状态采集现在有单请求超时边界，嵌套 `gameplay` 快照会保留 `worldTick` 与动作；跨维度、死亡或超过 32 方块的实际轨迹会断段，渲染端不会用直线连接断点。
- `client wait-ready` 在本次环境中仍曾超时，但服务端日志确认观察者随后入服，位置查询成功；因此只把入服和位置查询作为真实运行证据，不把 wait-ready 超时当作观察端通过或失败。

本次补充证据：`run/evidence/integration-recheck-20261028-03/events.jsonl`、`run/evidence/integration-recheck-20261028-03/scenario-summary.json`。测试完成后客户端、服务端和脚本 MindServer 均已停止。
