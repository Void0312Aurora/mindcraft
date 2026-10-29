package void0312aurora.mct.observatory;

import com.google.gson.GsonBuilder;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import io.wispforest.owo.ui.base.BaseOwoScreen;
import io.wispforest.owo.ui.component.Components;
import io.wispforest.owo.ui.container.Containers;
import io.wispforest.owo.ui.container.FlowLayout;
import io.wispforest.owo.ui.core.*;
import net.minecraft.network.chat.Component;

import java.util.List;

/** Uses owo-ui layout, buttons, scroll containers and wrapping labels. */
final class ObservatoryScreen extends BaseOwoScreen<FlowLayout> {
   private FlowLayout eventList, details;
   private String run = "", selectedId = "";
   private int filter;
   private static final String[] FILTERS = { "关键事件", "决策 / 动作", "导航", "全部" };

   @Override protected OwoUIAdapter<FlowLayout> createAdapter() {
      return OwoUIAdapter.create(this, Containers::verticalFlow);
   }

   @Override protected void build(FlowLayout root) {
      root.surface(Surface.flat(0xEF08131F));
      root.padding(Insets.of(10));
      root.gap(6);
      root.child(Components.label(Component.literal("MCT Observatory · 事件检查器")).color(Color.ofRgb(0x63E4DC)));
      root.child(Components.label(Component.literal("只读事件快照；打开面板不会暂停世界或 Agent。")).color(Color.ofRgb(0xAAAAAA)));
      FlowLayout controls = Containers.horizontalFlow(Sizing.fill(100), Sizing.content());
      controls.gap(4);
      controls.child(Components.button(Component.literal("切换角色"), button -> {
         MctObservatoryClient.STATE.selectNext(); selectedId = ""; refresh();
      }));
      controls.child(Components.button(Component.literal("更新列表"), button -> refresh()));
      controls.child(Components.button(Component.literal(FILTERS[filter]), button -> {
         filter = (filter + 1) % FILTERS.length;
         button.setMessage(Component.literal(FILTERS[filter])); refresh();
      }));
      controls.child(Components.button(Component.literal("返回现场"), button -> onClose()));
      root.child(controls);
      FlowLayout columns = Containers.horizontalFlow(Sizing.fill(100), Sizing.fill(78));
      columns.gap(6);
      eventList = Containers.verticalFlow(Sizing.fill(100), Sizing.content());
      eventList.gap(3);
      details = Containers.verticalFlow(Sizing.fill(100), Sizing.content());
      details.gap(5);
      columns.child(Containers.verticalScroll(Sizing.fill(43), Sizing.fill(100), eventList));
      columns.child(Containers.verticalScroll(Sizing.fill(54), Sizing.fill(100), details));
      root.child(columns);
      refresh();
   }

   private void refresh() {
      var state = MctObservatoryClient.STATE;
      run = state.runId;
      eventList.clearChildren();
      eventList.child(Components.label(Component.literal("运行 " + run + "\n角色 " + state.selectedAgent + "\n记录序号 " + state.sequence)).maxWidth(Math.max(100, width * 2 / 5 - 35)));
      List<JsonObject> events = state.events.stream().filter(this::matches).toList();
      for (int i = events.size() - 1, count = 0; i >= 0 && count < 80; i--, count++) {
         JsonObject e = events.get(i);
         String id = ObservatoryState.string(e, "id", "");
         String caption = "#" + ObservatoryState.integer(e, "sequence", 0) + " " + friendly(ObservatoryState.string(e, "kind", ""));
         var button = Components.button(Component.literal(caption), ignored -> { selectedId = id; show(e); });
         button.sizing(Sizing.fill(100), Sizing.fixed(22));
         eventList.child(button);
      }
      JsonObject chosen = state.events.stream().filter(e -> ObservatoryState.string(e, "id", "").equals(selectedId)).findFirst().orElse(null);
      if (chosen == null && !events.isEmpty()) chosen = events.get(events.size() - 1);
      if (chosen != null) { selectedId = ObservatoryState.string(chosen, "id", ""); show(chosen); }
      else { details.clearChildren(); detail("当前没有可显示的事件。", 0xAAAAAA); }
   }

   private boolean matches(JsonObject e) {
      if (!MctObservatoryClient.STATE.selectedAgent.equals(ObservatoryState.string(e, "agent_id", ""))) return false;
      String kind = ObservatoryState.string(e, "kind", "");
      return switch (filter) {
         case 1 -> kind.startsWith("decision.") || kind.startsWith("action.") || kind.startsWith("code.");
         case 2 -> kind.startsWith("navigation.");
         case 3 -> true;
         default -> !kind.equals("agent.position_sample") && !kind.equals("agent.state_snapshot") && !kind.equals("navigation.path_update");
      };
   }

   private void show(JsonObject e) {
      details.clearChildren();
      String id = ObservatoryState.string(e, "id", "");
      detail(friendly(ObservatoryState.string(e, "kind", "")), 0x63E4DC);
      detail("来源: " + ObservatoryState.string(e, "source", "unknown") + " / " + ObservatoryState.string(e, "origin", "unknown"), 0xF6B93B);
      detail("事件: " + id + "\n时间: " + ObservatoryState.string(e, "observed_at", "unknown")
         + "\n动作: " + ObservatoryState.string(e, "action_id", "—")
         + "\n目标: " + ObservatoryState.string(e, "goal_id", "—"), 0xDDDDDD);
      JsonObject payload = ObservatoryState.object(e, "payload").deepCopy();
      if (payload.has("route") && payload.get("route").isJsonArray()) {
         int count = payload.getAsJsonArray("route").size(); payload.remove("route"); payload.addProperty("route_point_count", count);
      }
      String text = new GsonBuilder().setPrettyPrinting().disableHtmlEscaping().create().toJson(payload);
      detail(text.length() > 4000 ? text.substring(0, 4000) + "\n[界面已截断；完整记录见 JSONL]" : text, 0xFFFFFF);
      detail("因果关联（点击查看）", 0x63E4DC);
      if (e.has("parent_ids") && e.get("parent_ids").isJsonArray()) {
         for (JsonElement p : e.getAsJsonArray("parent_ids")) link(p.getAsString(), "上游 ");
      }
      for (JsonObject child : MctObservatoryClient.STATE.events) {
         if (!child.has("parent_ids") || !child.get("parent_ids").isJsonArray()) continue;
         for (JsonElement p : child.getAsJsonArray("parent_ids")) if (p.getAsString().equals(id)) {
            link(ObservatoryState.string(child, "id", ""), "后续 "); break;
         }
      }
   }

   private void link(String id, String prefix) {
      JsonObject event = MctObservatoryClient.STATE.events.stream().filter(e -> ObservatoryState.string(e, "id", "").equals(id)).findFirst().orElse(null);
      if (event == null) { detail(prefix + id + "（不在当前缓存）", 0x999999); return; }
      var button = Components.button(Component.literal(prefix + friendly(ObservatoryState.string(event, "kind", ""))), ignored -> { selectedId = id; show(event); });
      button.sizing(Sizing.fill(100), Sizing.fixed(22));
      details.child(button);
   }

   private void detail(String text, int color) {
      details.child(Components.label(Component.literal(text)).color(Color.ofRgb(color)).maxWidth(Math.max(110, width / 2 - 28)));
   }

   @Override public boolean isPauseScreen() { return false; }
   @Override public void tick() {
      super.tick();
      if (eventList != null && !run.equals(MctObservatoryClient.STATE.runId)) { selectedId = ""; refresh(); }
   }

   private static String friendly(String kind) {
      return switch (kind) {
         case "decision.requested" -> "收到任务 / 触发";
         case "decision.completed" -> "决策 / 脚本指令";
         case "action.started" -> "动作开始";
         case "action.completed" -> "动作完成";
         case "action.interrupted" -> "动作中断";
         case "action.failed" -> "动作失败";
         case "navigation.goal_set" -> "设定目标";
         case "navigation.goal_reached" -> "抵达目标";
         case "navigation.path_reset" -> "路径重算";
         case "navigation.path_stopped" -> "寻路停止";
         case "code.attempt" -> "生成代码尝试";
         default -> kind;
      };
   }
}
