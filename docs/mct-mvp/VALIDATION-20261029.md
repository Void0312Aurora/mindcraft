# 真实 LLM 单 Agent 观察链验证 · 2026-10-29

## 范围

在 [10-28 的脚本 Agent 验收](VALIDATION-20261028.md)之后，用真实的 Mindcraft Agent 验证同一条观察链：决策由模型给出，不再由脚本预设。

- 世界：`observatory` profile，普通 Minecraft 1.20.1 创意观察服（25586 / MindServer 8080）。服务端 `force-gamemode=true`，Agent 每次重新进服都回到创造模式；修复前后两轮（`-02`、`-03`）Agent 都处于创造模式。
- Agent：`MCT_A`，`deepseek-flash`（DeepSeek 官方 API），`thinking: enabled`、`reasoning_effort: high`。
- Embedding：OpenRouter `voyageai/voyage-4-large`，启动时为 52 条技能说明各算一次向量。
- 设置沿用 `config/mct-mvp/agents.settings.json`：`allow_insecure_coding=false`、`num_examples=0`。
- 任务由观察者通过 MindServer 以自然语言发出，不指定命令名。

## 发现并修复的问题

| 问题 | 根因 | 修复 |
| --- | --- | --- |
| 模型对每条请求只回 `\t`，Agent 不动作 | `num_examples=0` 时提示词仍保留空的 "Examples of how to respond:" 标题；思考模式把它读成"还没有请求"，按系统提示回 `\t`。同一提示词保留标题 10 次中 4 次空回，去掉后 10/10 发出移动命令 | `src/utils/examples.js`：没有示例时不输出标题 |
| 寻路失败被记录为 `action.completed`、`success: true` | `runAsAction` 丢弃技能返回值；`ActionManager` 只要不抛异常就记成功 | `actions.js` 的动作体返回技能结果；`action_manager.js` 以 `returned !== false` 判定成功；`agent_telemetry.js` 把 `success: false` 记为 `action.failed` |
| HUD "Command" 总显示 `unrecorded` | 到达后的纯聊天回复（`command: null`）覆盖了先前命令 | `ObservatoryState.java`：`command: null` 时保留上一条命令 |
| 事件中约一半是重复的 `world.time_boundary` | 观察服关闭昼夜循环，时间停在 6000；Mindcraft 每个时间包都触发一次 `noon` | `agent_telemetry.js`：同一天同一边界只记录一次，并带上 `day` |

`openrouter.js` 另增加了 `embed()`，用于 voyage-4-large。

## 修复后结果（`llm-single-20261029-03`）

| 任务 | Agent 行为 | 观察端显示 |
| --- | --- | --- |
| 走到 (40, 65, 60) | `!goToCoordinates` → 到达后报告 "Made it." | 行进中：`running`、`travelling`，计划路径 49 个点，带方向箭头；到达后：`completed`、`arrived`，Command 仍为 `!goToCoordinates`，计划路径清空 |
| 去 (40, 120, 60)，空中不可达 | 两次 `!goToCoordinates` 均失败 → 尝试 `!newAction` 被禁止 → 说明原因，并提出可挖台阶上去 | `failed`、目标 `failed`；两次寻路记为 `action.failed`、`success=false` |

- 272 条事件，ID 无重复，所有 `parent_ids` 均能在本次记录中找到。
- `world.time_boundary` 从修复前的 412 条降为 1 条。
- 修复前 `llm-single-20261029-02` 的同类不可达任务记为 `action.completed`、`success=true`，HUD 顶栏显示 `completed`、目标行显示 `failed`。

证据（被 Git 忽略）：

- 事件：`run/evidence/llm-single-20261029-03/events.jsonl`，修复前 `run/evidence/llm-single-20261029-02/events.jsonl`
- 截图：`run/evidence/llm-run03-travelling.png`、`llm-run03-arrived.png`、`llm-run03-failed.png`；修复前 `llm-run02-*.png`

## 构建和回归

- 6 个 Node smoke 全部通过。`mct:agent-telemetry-smoke` 新增两项断言：返回 false 的动作记为 `action.failed`；冻结时钟下同一边界只记录一次，第二天重新记录。
- Gradle `build stateSmoke` 通过；`stateSmoke` 新增断言：纯聊天回复不覆盖上一条命令。
- 观察客户端已重新部署。旧包备份在测试临时目录，未放入仓库。

## 当前边界

- 真实 Agent 共 9 次决策无空回，样本仍小；未做长时间运行。
- `!newAction`、`!lookAtPlayer`、`!lookAtPosition` 和模式动作的返回值不是 false，仍按原规则记为成功；它们的失败要靠执行输出判断。
- 未验证：中途被打断（脚本验收已覆盖）、多 Agent、过夜与饥饿、整体暂停、客户端帧率与内存。
- 模型说"我在创造模式可以飞"是对的：提示词中的状态为 `Gamemode: creative`。

## 决策分析（`llm-single-20261029-03`）

Mindcraft 不保存模型的思考内容，下表依据每步的输入和输出。每次决策耗时 1.1–3.4 秒。

| # | 输入 | 输出 | 判断 |
| --- | --- | --- | --- |
| 1 | 用户：走到 (40, 65, 60) | `!goToCoordinates(40, 65, 60, 1)` | 正确 |
| 2 | 动作输出：到达 | "Made it." | 正确；动作输出里的 "Path not found, but attempting…" 来自 1 秒预检超时，模型未被误导 |
| 3 | 用户：去 (40, 120, 60) | `!goToCoordinates(40, 120, 60, 1)` | 可接受，先尝试一次 |
| 4 | 寻路超时 | "Trying again" + 同一条命令 | 偏弱：原样重试 |
| 5 | 无法到达，相差 55 格 | 计划飞上去，调用 `!newAction` | 方向合理；该命令已禁用但仍在命令文档中 |
| 6 | newAction not allowed | 说明原因，询问是否垒方块上去 | 合理，停下询问 |

分析中发现、尚未修复：

- `allow_insecure_coding=false` 只拦截执行，`!newAction` 仍出现在提示词的命令文档里；可加入 `blocked_actions`。
- 由动作结果触发的后续决策（第 2、4、5、6 步），`decision.requested` 仍记录最初的用户消息，`parent_ids` 为空，没有关联到触发它的动作结束事件。

## 开启 `!newAction` 并补齐基础设施

结论是开启，而不是继续禁用后再把它从文档里删掉。随之补上的部分：

| 项 | 改动 |
| --- | --- |
| 开启与超时 | `agents.settings.json`：`allow_insecure_coding: true`、`code_timeout_mins: 5`。原默认 -1 为不限时，死循环会让 Agent 一直卡住 |
| 生成代码可观察 | `coder.js` 每次尝试发出 `code.attempt` 事件，`outcome` 为 `no_code`、`stage_error`、`lint_error`、`executing`、`finished`、`runtime_error`、`interrupted`；代码与报错文本受 `MCT_TELEMETRY_TEXT` 控制。事件挂在当前 `newAction` 动作下 |
| 代码加载失败 | 生成代码语法错误时 `_stageCode` 原本直接抛出，现在作为一次失败尝试交回模型重写 |
| 后续决策因果 | `agent.js`：动作结束后触发的下一次决策，`decision.requested` 记录真正的触发内容（动作输出），`source` 为 `system`，`follow_up: true`，`parent_ids` 指向触发它的动作结束事件。上节"尚未修复"的第二条由此解决 |
| 事件 ID | 每个 Agent 进程使用独立前缀（名字 + 启动时间）。Mindcraft 在 Agent 崩溃后会在同一次运行内重启进程，原先 `MCT_A-decision-1` 会重复 |
| 观察端 | 事件检查器"决策/动作"分类包含 `code.attempt`，显示为"生成代码尝试" |

访问范围未改：服务端只监听 `127.0.0.1`。`only_chat_with` 在 Mindcraft 中同时会把 Agent 的公开发言改为逐人私聊，影响三人旅行中的公开对话，所以没有设置。

### 实测（`llm-single-20261029-04`）

任务：给 Agent 64 个泥土，要求在身旁搭一根 3 格高的泥土柱。没有现成命令能完成，需要写代码。

- 模型调用 `!newAction`，附带分步计划。技能检索选出 `placeBlock`、`getNearestFreeSpace` 等 7 条说明。
- 第 1 次尝试生成的代码通过检查，放置 (41, 65..67, 60) 三块泥土；RCON 核对三块均存在，位置符合"身旁"。
- 模型随后回复 "Done — 3-block dirt pillar built next to me."
- 事件链：`decision.completed`（`!newAction`）→ `action.started` → `code.attempt` executing → `code.attempt` finished（附执行输出）→ `action.completed` → 后续 `decision.requested`，其 `parent_ids` 指向动作结束事件。

这次运行同时暴露了上面"事件 ID"一项：Agent 进程重启后，`decision-1` 和同一次尝试的两条 `code.attempt` 出现重复 ID，修复后已加测试。

运行中断原因：电脑在 09:44 进入新型待机，10:31 恢复。服务端落后 74 秒、观察客户端超时，Agent 掉线后按设计退出，并由 Mindcraft 自动重启。这不是代码问题，但长时间实验需要关闭睡眠。

另一个测试干扰：我核对方块时用的 RCON `say` 会被服务端广播到聊天，Agent 把这些消息当作玩家发言，又回复了几次。之后核对改用 `execute if block`，不再广播。

### 仍未覆盖

- 生成代码出错后的重写流程（`lint_error`、`runtime_error`）只有单元测试，实测这次第 1 次就成功了。
- 5 分钟超时只确认了配置会传到计时器，没有实测超时触发。
- 生成代码报告"完成"并不代表真的完成：本次代码对后备位置的放置结果没有检查。结果是否正确仍需核对世界状态。

## 生存世界测试（`llm-survival-20261029-05`、`-06`）

环境：`survival` profile，普通生存 1.20.1（25587 / MindServer 8082），难度普通，开启昼夜循环和刷怪。单个 Agent `MCT_A`，`deepseek-flash`、思考强度 high，开启 `!newAction`。观察者为旁观模式并附着在 Agent 视角；观察客户端通过 `JAVA_TOOL_OPTIONS=-Dmct.observatory.url=…:8082/…` 指向生存 MindServer。测试前已备份干净的 `world-mvp`（`run/backups/world-mvp-before-survival-test-20261029`），测试期间用 `SetThreadExecutionState` 防止电脑待机。

任务只给开放目标，例如"天快黑了，你什么都没有，活过今晚，自己决定怎么做"，不指定命令。

### 和创造世界相比的行为变化

| 方面 | 创造世界（`-02`～`-04`） | 生存世界（`-05`、`-06`） |
| --- | --- | --- |
| 任务形态 | 单步：走到某点、搭柱子 | 多步链：砍树 → 木板 → 工作台 → 木棍 → 木镐 → 木剑 → 庇护所 |
| 主动性 | 等待指令 | 每个动作完成后主动规划下一步，每步都在聊天里说明 |
| 时间感知 | 无 | 会说"天快黑了"并调整优先级，先做剑再挖庇护所 |
| 威胁应对 | 无 | 自动战斗模式与模型决策交替；会说"有骷髅，先挖坑躲" |
| 失败恢复 | 原样重试 | 合成报错"需要 oak_planks"后改走别的路线；死亡后说明原因并重新收集木头 |
| 自我评估 | 基本准确 | 多次报告完成但实际没有完成（见下） |

### 第一晚（`-05`）：成功

完整链路约 80 秒：收集 4 根云杉原木（实际 8 根）→ 合成木板、工作台、木棍、木镐、木剑 → 天黑时看到骷髅，用 `!newAction` 写代码向下挖 3 格并在头顶封一块木板 → `!placeHere("torch")` 因没有火把失败 → `!stay(-1)` 原地等待。

RCON 核对：坑底 (-9, 97, 39)，四面墙和 (-9, 100, 39) 处的木板都存在，是真正封闭的空间。附近有 2 只敌对生物，但 Agent 整夜生命值保持 20。早上它自己写代码破顶出坑、远离怪物。

### 第二晚（`-06`）：说"已封好"但实际没封

当天 Agent 先打跑一只蜘蛛，然后合成工具。天黑后连续写了三次庇护所代码，第三次代码按"当前位置"计算周围 8 格和头顶。执行输出显示放了 5 块木板，坐标是 (-20..-21, 93..95, 11..13)。Agent 回复"Shelter's sealed"，然后 `!stay(120)`。

RCON 核对 Agent 实际所在格 (-23, 92, 10)：脚和头部高度的 8 个相邻格全是空气，头顶也是空气。原因是代码执行前 Agent 已经移动了，木板放在了它之前的位置旁边。模型只看到"放置成功"的输出，没有核对自身位置是否被围住。之后 Agent 在原地被僵尸杀死，复活后又被杀一次，测试到此停止。

这说明"代码执行成功"和"目标达成"之间缺少验证。这是 Agent 能力边界的问题，不是基础设施问题。

### 测试中发现并修复：战斗时被服务端踢出

`-05` 早上的战斗中，Agent 被服务端以 `Invalid move player packet received` 踢出 9 次，每次自动重启后又被踢。

- 复现：用独立探针 Bot 执行同样的战斗循环（Mindcraft `defendSelf` 的逻辑），在旁边召唤僵尸，可稳定复现。
- 定位：给 `bot.entity.velocity` 加写入拦截，第一次写入 NaN 的调用栈指向 `mineflayer/lib/plugins/entities.js:285` 的 `entity_velocity` 处理。
- 根因：Mindcraft 锁定 `mineflayer 4.33.0`，但安装的 `minecraft-data` 是 3.117.0。新版协议定义把速度字段改为嵌套的 `packet.velocity.{x,y,z}`，4.33 仍读取 `packet.velocityX`，得到 `undefined`，乘以系数后变成 NaN。被击退时服务端会给 Agent 发速度包，NaN 进入物理模拟，下一个位置包就带上 NaN 坐标。上游 mineflayer 4.39 已改用新字段名。
- 修复：在 `patches/mineflayer+4.33.0.patch` 中让 `spawn_entity` 和 `entity_velocity` 两处读取兼容新旧两种字段形态。已确认该补丁可以干净应用到全新的 mineflayer 4.33.0。
- 验证：同一探针修复前每次都被踢；修复后打了 11 轮，直到被僵尸打死也没有再出现无效移动包。`-06` 全程 0 次踢出、0 次进程重启，包括与蜘蛛和僵尸的战斗。

### 同时修复的观测问题

- `world.time_boundary` 在生存世界里一条都没有记录。Mindcraft 只在时间恰好等于 0/6000/12000/18000 时触发事件，但时间包约每 20 tick 才到一次，几乎不可能正好命中。现在遥测根据相邻两次时间判断是否跨越了某个边界，冻结时钟时仍然只记录一次。`-06` 正确记录了 `sunset@0` 和 `midnight@0`。
- 观察端目标行显示 "failed" 但目标其实已经到达：`!placeHere` 这类不设寻路目标的动作失败时，会把上一个已到达的目标改成失败。现在没有 `goal_id` 的动作结束不再改动已有目标。

两项都补了测试：Node 遥测测试新增 5 条时间边界断言，`stateSmoke` 新增"无目标动作失败不改已有目标"。

### 数据

| 运行 | 事件数 | 重复 ID | 断链 | 生成代码尝试 | 动作结束 | 死亡 | 被踢 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `-05` | 564+（含重启段） | 0 | 0 | 2 次，均第 1 次成功 | — | 1 | 9（修复前） |
| `-06` | 1044 | 0 | 0 | 3 次，均第 1 次成功 | 完成 13、失败 5、中断 2 | 2 | 0 |

### 尚未处理

- **生成代码没有验证结果**：Mindcraft 只要代码不抛异常就算成功。可以在 `newAction` 结束后让模型核对一次世界状态，或者为常见目标（封闭空间、物品数量）提供检查函数。
- **误导性的报错进入记忆**：`-06` 中 Agent 手里只有原木、没有木板时尝试合成工作台。Mindcraft 的报错只列出第一个配方（"需要 oak_planks: 4"），模型把它记成"必须用橡木木板"。随后它先合成云杉木板，工作台就做成了，但记忆里的错误结论没有更正。
- **没有火把时的照明**：两晚都尝试放火把失败，Agent 没有去找煤。
- 生存世界里 Agent 两次死亡掉落的物品留在原地，`world-mvp` 已不是干净状态；需要时可从备份恢复。

## Agent 行为问题修复（`llm-survival-20261029-07`）

做法和 `!newAction` 一样：不替模型写策略，只补它缺少的感知和准确信息。

| 问题 | 根因（由数据确认） | 修复 |
| --- | --- | --- |
| 庇护所放错位置却报告"已封好" | 不是模型代码写错。`skills.placeBlock` 判断"离得太近"用的是到方块角点的距离 < 1.1，紧挨着 Bot 的格子也会触发，于是 Bot 自己走开再放，把墙放到了原位置旁边。`-06` 的遥测显示，代码执行期间出现两次 `GoalInvert`，位置从 (-21.6, 92.9) 移到 (-22.2, 92) | 改成真正判断目标格是否与 Bot 碰撞箱重叠；若仍需移动，在输出里写明"从哪里移到哪里" |
| 无法核对是否真的封闭 | 提示词里只有脚下、腿部、头部三个方块 | `world.getEnclosure(bot)` 返回 8 个侧面里哪些敞开、头顶有没有遮挡。`!stats`、`!nearbyBlocks` 和提示词里的周围方块都会附一行 `Enclosure: …` |
| 记忆写入"工作台必须用橡木" | 合成失败时只列第一个配方 | 列出可互换的配方，例如 "oak_planks: 4 OR spruce_planks: 4 OR …" |
| 两晚都没有火把 | 放置失败只说"没有 torch" | 缺少可合成物品时附上配方；涉及煤/木炭时说明煤来自 coal_ore、木炭来自熔炼原木 |

验证：

- 实机检查脚本 `tools/mct-mvp/agent-behavior-check.mjs` 在生存服上逐项通过：空平台报告 8 面敞开且无顶；四面墙但无顶时报告 `no roof`；只留东侧头部一个缺口时报告 `["east head"]`；全部封好时报告 `fully enclosed`；合成和火把的提示文字符合预期。
- 原样重放模型在 `-06` 写的庇护所代码：修复前 Bot 移动两次，最后站在 (199, 151, 201)，四面全空；修复后 Bot 不动，8 面墙全部放好，只缺顶（代码里放顶的那一步本来就找不到依附面），`getEnclosure` 如实报告 `no roof`。
- Node smoke 全部通过。

### 实测（`-07`）

任务通过 `!goal(...)` 下达（MVP 启动器本来就用 `!goal`）。用普通消息下达时，Agent 合成完木板后回复为空，就停下了；同一请求重放 6 次都正常，属于单次偶发。

过程：砍树 → 工作台 → 木镐 → 下矿挖石头，被骷髅射死 → 自己总结"待在地面" → 重新砍树 → 石镐 → **主动去挖 coal_ore 做火把** → 天黑时 `!digDown(2)`，插上火把 → 再次 `!digDown(2)` → 用 `!stats`、`!nearbyBlocks` 核对，看到 `Enclosure: no roof` → 写代码用圆石封顶 → 再次 `!nearbyBlocks` 核对，看到 `fully enclosed` → 说"Fully enclosed and lit" → `!stay(-1)`。

RCON 核对 Agent 所在格 (-2, 90, 26)：8 个侧面都是实心方块，头顶实心，脚下有火把。附近 24 格内没有僵尸、骷髅或蜘蛛。整晚生命值 20，饥饿值 20，天亮时仍在原处。这是第一次出现"自己核对，发现没封好，补上，再核对"的闭环。

数据：1856 条事件，重复 ID 0，断链 0；时间边界 noon、sunset、midnight 都记录到了；被踢 0 次，进程重启 0 次；死亡 1 次（白天下矿）。

### 本轮新发现、未处理

- **合成后工作台没收回，物品就丢了**：`-07` 中一次合成木镐后，Mindcraft 去收回刚放下的工作台时寻路超时。随后状态快照里木镐一直是 0，Agent 说"不知怎么把镐弄丢了"，又做了一把。其余 8 次 3x3 合成都正常。具体丢失原因还没定位。上游有类似报告（mineflayer #3906，1.21.5 上 3x3 合成不交付物品），但版本不同，不能直接套用。
- **普通消息下达任务时偶尔停住**：Mindcraft 只在模型返回命令时继续循环，返回空就结束。用 `!goal` 启动自提示循环可以避免，这也是 MVP 启动器本来的方式。
- 观察端修复后的 jar 在 `-07` 开始前没有重新部署，所以 HUD 截图仍显示旧版的 "failed"，现已部署。

## 追查：丢失的木镐和空回复

### 木镐：服务端从未真正合成，不是丢弃

更正上一节"合成后工作台没收回，物品就丢了"的说法。

- **合成从未生效**：比较合成前后的状态快照，成功的几次木板 12→9、木棍 3→1；出问题的那次是 12→12、3→3，原料一个没少，木镐从 0 到 0。如果是合成后又丢掉或被吃掉，原料应当已经消耗。
- **"Successfully crafted …, you now have 1" 是假的**：Mindcraft 在 `bot.craft()` 返回后立刻读取本地背包。mineflayer 合成时先在本地把结果写进格子（`grabResult` 里的 `window.updateSlot(0, item)`），关窗时再复制到背包。服务端没有接受这次合成，随后下发的真实背包状态覆盖了本地的乐观结果，所以 1 秒后的快照里木镐已经是 0。
- **工作台其实收回来了**：同一次输出里的 "Failed to collect crafting_table … Collected 0" 也不准确。06:35:10 起背包里工作台为 1，是寻路超时前已经捡到了。
- **能否复现**：在平地上让 Bot 自己放工作台再合成，重复 3 次；按出问题时完全相同的背包内容合成，重复 6 次；共 9 次，服务端核对全部成功。原始日志没有抓包，无法确定服务端为什么没有接受那一次点击序列。

### 空回复：不是提示词决定的

- `-07` 的 35 次决策中只有 1 次真正的空回复。把那次请求原样重放：开启 `***` 停止符重放 40 次，去掉停止符重放 30 次，去掉"没事做就回 tab"规则重放 20 次，改变消息结构重放 30 次，一共没有出现空回复。所以它是模型的偶发结果，不能归因于提示词。Mindcraft 丢弃了 `reasoning_content`，当时模型想了什么已无从得知。
- 其他几次空回复或 tab 来源不同：
  - `-02` 早期：空示例标题导致，已修复。
  - `-04`、`-05`：是我的测试操作造成的。RCON `say` 和让生物 `say near` 的命令被 Agent 当成聊天消息；新消息到达时，Mindcraft 会按设计丢弃正在生成的回复，返回空串。
- **停住的原因在 Mindcraft**：用普通消息下达任务时，只有回复里带命令才会继续循环，空回复直接结束，之后也没有任何东西会再唤醒它。`!goal` 的自提示循环会要求"下一条必须包含命令"并重试，所以不会停。

### 针对性修复

| 问题 | 修复 | 验证 |
| --- | --- | --- |
| 合成报告了服务端从未确认的物品 | `craftRecipe` 不再在 `bot.craft()` 返回后立即读本地背包，而是等窗口 0（玩家背包）静默 200 ms 后再读，最少等 600 ms，最多 2 s。数量没有增加时返回 false，并告诉模型"合成未生效，现在有 N 个，检查背包后重试"，不再说已经有了 | `tools/mct-mvp/agent-craft-confirm-check.mjs` 实机运行 3 次全部通过：正常 3x3 合成仍报告成功；服务端在关窗后 200 ms 收回成品时，返回 false，报告"you still have 0" |
| 无法知道模型为什么空回复 | DeepSeek 适配器按回复文本保存 `reasoning_content`，`_saveLog` 写入日志的 `Reasoning:` 段后删除。对话、写代码和记忆总结共用同一个模型对象且会并发，所以不能存成单个字段。最多保留 16 条，防止被丢弃的回复积压 | 真实请求的提示词日志中出现 `Reasoning:` 段，记录后映射清空 |
| 普通消息下空回复让 Agent 停住 | `promptConvo` 第一次拿到空串时重试一次。单个 `\t`（约定的"无事可做"）不算空回复，照常返回 | `tools/mct-mvp/empty-reply-retry-smoke.mjs`：空→命令，返回命令；连续两次空，返回空；`\t` 不重试 |

注意：这次的"服务端拒绝合成"是在测试中用 RCON 收回成品模拟的，不是 run 07 当时的真实原因，因为那个原因没能复现。修复针对的是结果：本地背包与服务端不一致时，不再报告不存在的物品。

回归：Node smoke 全部通过；`agent-behavior-check.mjs` 6 项通过。
