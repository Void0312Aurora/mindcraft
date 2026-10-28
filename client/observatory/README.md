# MCT Observatory Client

RFC #2 Phase 1 的 Fabric 1.20.1 观察客户端，不依赖 Tellus。

## 显示与操作

- 实际轨迹：所选 Agent 专属颜色的连续宽实线与采样节点。
- 计划路径：白色半透明连续线与方向箭头，表示当前 Pathfinder 路径；抵达、中断、失败或换目标后清除旧计划。
- 角色浮标：名字、动作状态、生命和饥饿值。目标以空间圆环和文字标出行进、抵达、中断、失败或被替换状态。
- 左上角：当前 run_id、连接状态、唯一选中角色、目标、图例和缓存缺口数量。
- `U`：选择准星所指角色，否则轮换已知角色。当前只绘制选中角色的轨迹。
- `I`：打开游戏内事件检查器。复用 **owo-ui 0.11.2+1.20** 的布局、按钮、滚动区和文字换行；支持角色与类别筛选、详情、来源、上游与后续事件跳转。
- `B`：切换简化播出视图，隐藏轨迹和空间标记，只保留紧凑状态。
- `O`：隐藏或显示观察叠加。

事件列表是只读快照，点击“更新列表”刷新；**打开面板不会暂停世界或 Agent**。面板显示数据来源，脚本指令不标为模型推理。

## 数据隔离与限制

只读轮询 `http://127.0.0.1:8080/mct/observability/snapshot?after=<sequence>&run_id=<run>`。run_id 改变或进入另一世界时自动清空旧角色、轨迹、目标、事件与选择，旧请求结果不会写入新世界。连接失败时显示“disconnected (cached view)”，缓存留供观察。

每角色最多 512 个实际与计划采样点、8 个目标；事件缓存 256 条，面板列出筛选后最近 80 条。超过窗口的关联明确显示不在缓存，完整记录在运行目录的 JSONL。断线超过服务端缓存窗口后无法补全的事件会计数，当前没有历史回放。

路径使用无深度遮挡的观察叠加，`overworld` 与 `minecraft:overworld` 归一化。实际带半宽 0.28 方块、计划带半宽 0.10 方块；连续段组织与累计距离箭头适配自 [Fabric Trail Mod](https://github.com/Suleiman700/Fabric-Trail-Mod)，来源和许可证见 THIRD_PARTY_NOTICES.md。owo 库随客户端包内嵌。

当前范围不含通信弧线、完整暂停/恢复、三 Agent 合作、LLM 接入或过夜生存验收。

## 单 Agent 演示

普通 MC 服务端启动后，运行：

```powershell
npm run mct:single-agent-observer-check
```

只连接一个真实 Mineflayer/Pathfinder 角色 `MCT_A`，无 LLM 调用。依次在准备、抵达、脚本中断、改令后再次抵达处等待 Enter，便于检查界面。等待仅控制脚本阶段，世界继续运行，不能当作测试暂停。`--empty` 启动空运行，用于客户端保持在线时验证自动清空。

构建：Gradle `build stateSmoke`（Java 21 运行 Gradle，输出 Java 17 客户端）。
