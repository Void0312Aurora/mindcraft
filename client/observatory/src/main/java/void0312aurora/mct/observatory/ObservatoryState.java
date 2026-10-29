package void0312aurora.mct.observatory;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import net.minecraft.world.phys.Vec3;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Client-thread projection of bounded, passive telemetry. No game controls. */
final class ObservatoryState {
   static final int MAX_POINTS = 512;
   static final int MAX_EVENTS = 256;
   final Map<String, Trace> traces = new LinkedHashMap<>();
   final List<JsonObject> events = new ArrayList<>();
   String runId = "";
   String selectedAgent = "";
   int sequence;
   int revision;
   int droppedEvents;

   void clear() {
      traces.clear();
      events.clear();
      runId = "";
      selectedAgent = "";
      sequence = 0;
      droppedEvents = 0;
      revision++;
   }

   void apply(JsonObject root) {
      String incomingRun = string(root, "run_id", "");
      if (incomingRun.isBlank()) return;
      if (!incomingRun.equals(runId)) {
         clear();
         runId = incomingRun;
      }
      droppedEvents += integer(root, "dropped_events", 0);
      if (root.has("events") && root.get("events").isJsonArray()) {
         for (JsonElement item : root.getAsJsonArray("events")) {
            if (!item.isJsonObject()) continue;
            JsonObject event = item.getAsJsonObject();
            if (!incomingRun.equals(string(event, "run_id", incomingRun))) continue;
            if (integer(event, "sequence", 0) <= sequence) continue;
            sequence = integer(event, "sequence", sequence);
            events.add(event.deepCopy());
            while (events.size() > MAX_EVENTS) events.remove(0);
            String agent = string(event, "agent_id", "");
            if (agent.isBlank()) continue;
            Trace trace = traces.computeIfAbsent(agent, Trace::new);
            if (selectedAgent.isBlank()) selectedAgent = agent;
            applyEvent(trace, event);
         }
      }
      sequence = Math.max(sequence, integer(root, "sequence", sequence));
      revision++;
   }

   private void applyEvent(Trace trace, JsonObject event) {
      String kind = string(event, "kind", "unknown");
      String dimension = string(event, "dimension", "");
      JsonObject payload = object(event, "payload");
      trace.entityId = string(event, "entity_id", trace.entityId);
      trace.latestKind = kind;
      trace.source = string(event, "source", "unknown");
      if (kind.equals("agent.position_sample") || kind.equals("agent.state_snapshot")) {
         JsonObject gameplay = object(payload, "gameplay");
         JsonObject action = object(payload, "action");
         JsonObject positionObject = payload.has("position") ? payload : gameplay;
         Vec3 point = point(object(positionObject, "position"));
         if (point != null) {
            String pointDimension = string(gameplay, "dimension", dimension);
            boolean discontinuity = booleanValue(payload, "segment_break", false)
               || (trace.position != null && (!sameDimension(trace.dimension, pointDimension)
               || trace.position.distanceTo(point) >= 32));
            if (discontinuity) trace.observedSegment++;
            trace.position = point;
            trace.dimension = pointDimension;
            if (kind.equals("agent.position_sample")) {
               trace.observed.add(new Sample(pointDimension, point, trace.observedSegment));
               while (trace.observed.size() > MAX_POINTS) trace.observed.remove(0);
            }
         }
         trace.health = number(payload, "health", number(gameplay, "health", trace.health));
         trace.hunger = number(payload, "hunger", number(gameplay, "hunger", trace.hunger));
         trace.timeOfDay = number(gameplay, "timeOfDay", trace.timeOfDay);
         trace.worldTick = integer(event, "world_tick", trace.worldTick);
         if (payload.has("action") && payload.get("action").isJsonPrimitive()) trace.action = string(payload, "action", "idle");
         else if (action.has("current")) trace.action = string(action, "current", "idle");
      } else if (kind.equals("navigation.goal_set")) {
         if (trace.goal != null && trace.goal.status.equals("travelling")) trace.goal.status = "superseded";
         trace.planned.clear();
         JsonObject goal = object(payload, "goal");
         Vec3 target = point(goal);
         trace.goal = target == null ? null : new Goal(string(event, "goal_id", ""), target,
            dimension, string(event, "id", ""));
         if (trace.goal != null) {
            trace.goals.add(trace.goal);
            while (trace.goals.size() > 8) trace.goals.remove(0);
         }
         trace.navigation = "travelling";
      } else if (kind.equals("navigation.path_update")) {
         if (!currentGoal(trace, event)) return;
         trace.planned.clear();
         if (payload.has("route") && payload.get("route").isJsonArray()) {
            for (JsonElement p : payload.getAsJsonArray("route")) {
               if (!p.isJsonObject()) continue;
               Vec3 point = point(p.getAsJsonObject());
               if (point != null && trace.planned.size() < MAX_POINTS) trace.planned.add(new Sample(dimension, point, 0));
            }
         }
         String status = string(payload, "status", "unknown");
         if (status.equals("noPath") || status.equals("timeout")) setGoalStatus(trace, event, "failed");
         else if (trace.goal != null) trace.navigation = "travelling";
      } else if (kind.equals("navigation.goal_reached")) {
         if (!currentGoal(trace, event)) return;
         setGoalStatus(trace, event, "arrived");
         trace.planned.clear();
      } else if (kind.equals("navigation.path_reset") || kind.equals("navigation.path_stopped")) {
         if (!currentGoal(trace, event)) return;
         trace.planned.clear();
         trace.navigation = kind.endsWith("reset") ? "replanning" : "stopped";
      } else if (kind.equals("decision.completed")) {
         // A chat-only reply (command: null) keeps the last issued command.
         if (payload.has("command") && payload.get("command").isJsonPrimitive()) trace.command = payload.get("command").getAsString();
         else if (!payload.has("command")) trace.command = "unrecorded";
         trace.decision = string(payload, "text", "text not recorded");
         trace.decisionSource = string(event, "source", "unknown");
      } else if (kind.equals("action.started")) {
         trace.action = string(payload, "label", "action");
         trace.actionState = "running";
      } else if (kind.startsWith("action.")) {
         trace.actionState = kind.substring("action.".length());
         if (kind.equals("action.completed") && payload.has("success") && !payload.get("success").getAsBoolean()) trace.actionState = "failed";
         trace.result = string(payload, "message", string(payload, "error", trace.actionState));
         if (trace.actionState.equals("interrupted") || trace.actionState.equals("failed")) {
            setGoalStatus(trace, event, trace.actionState);
            trace.planned.clear();
         }
      }
   }

   private static void setGoalStatus(Trace trace, JsonObject event, String status) {
      // An action with no goal_id never set a target; it must not relabel an older, settled goal.
      if (trace.goal != null && !string(event, "goal_id", "").isBlank() && currentGoal(trace, event)) {
         trace.goal.status = status;
         trace.navigation = status;
      }
   }

   private static boolean currentGoal(Trace trace, JsonObject event) {
      String id = string(event, "goal_id", "");
      return id.isBlank() || trace.goal == null || id.equals(trace.goal.id);
   }

   Trace selected() { return traces.get(selectedAgent); }

   void selectNext() {
      List<String> ids = new ArrayList<>(traces.keySet());
      if (ids.isEmpty()) return;
      selectedAgent = ids.get((ids.indexOf(selectedAgent) + 1) % ids.size());
      revision++;
   }

   static String string(JsonObject o, String key, String fallback) {
      return o.has(key) && o.get(key).isJsonPrimitive() ? o.get(key).getAsString() : fallback;
   }

   static JsonObject object(JsonObject o, String key) {
      return o.has(key) && o.get(key).isJsonObject() ? o.getAsJsonObject(key) : new JsonObject();
   }

   static int integer(JsonObject o, String key, int fallback) {
      double value = number(o, key, fallback);
      return (int) value;
   }

   static double number(JsonObject o, String key, double fallback) {
      try {
         double value = o.has(key) && !o.get(key).isJsonNull() ? o.get(key).getAsDouble() : fallback;
         return Double.isFinite(value) ? value : fallback;
      } catch (RuntimeException ignored) { return fallback; }
   }

   static boolean booleanValue(JsonObject o, String key, boolean fallback) {
      try { return o.has(key) ? o.get(key).getAsBoolean() : fallback; }
      catch (RuntimeException ignored) { return fallback; }
   }

   static Vec3 point(JsonObject o) {
      double x = number(o, "x", Double.NaN), y = number(o, "y", Double.NaN), z = number(o, "z", Double.NaN);
      return Double.isFinite(x) && Double.isFinite(y) && Double.isFinite(z) ? new Vec3(x, y, z) : null;
   }

   static String normalizeDimension(String d) { return d.startsWith("minecraft:") ? d.substring(10) : d; }
   static boolean sameDimension(String a, String b) { return a.isBlank() || normalizeDimension(a).equals(normalizeDimension(b)); }
   static List<Vec3> pointsFor(List<Sample> samples, String dimension) {
      List<Vec3> result = new ArrayList<>();
      for (Sample s : samples) if (sameDimension(s.dimension, dimension)) result.add(s.point);
      return result;
   }

   static List<List<Vec3>> observedSegmentsFor(List<Sample> samples, String dimension) {
      List<List<Vec3>> result = new ArrayList<>();
      int current = Integer.MIN_VALUE;
      for (Sample sample : samples) {
         if (!sameDimension(sample.dimension, dimension)) continue;
         if (sample.segment != current) { result.add(new ArrayList<>()); current = sample.segment; }
         result.get(result.size() - 1).add(sample.point);
      }
      return result;
   }

   record Sample(String dimension, Vec3 point, int segment) {
      Sample(String dimension, Vec3 point) { this(dimension, point, 0); }
   }
   static final class Goal {
      final String id, dimension, eventId;
      final Vec3 position;
      String status = "travelling";
      Goal(String id, Vec3 position, String dimension, String eventId) {
         this.id = id; this.position = position; this.dimension = dimension; this.eventId = eventId;
      }
   }
   static final class Trace {
      final String agent;
      final int color;
      final List<Sample> observed = new ArrayList<>(), planned = new ArrayList<>();
      final List<Goal> goals = new ArrayList<>();
      String entityId, dimension = "", latestKind = "", source = "", action = "idle", navigation = "idle";
      String actionState = "idle", command = "none", decision = "", decisionSource = "", result = "";
      Vec3 position;
      double health = Double.NaN, hunger = Double.NaN;
      double timeOfDay = Double.NaN;
      int worldTick;
      int observedSegment;
      Goal goal;
      Trace(String agent) {
         this.agent = agent;
         entityId = agent;
         color = switch (agent) {
            case "MCT_A", "MCT_SCRIPT_A" -> 0x25D9D0;
            case "MCT_B" -> 0xF6B93B;
            case "MCT_C" -> 0xB58CFF;
            default -> 0x55CCFF;
         };
      }
   }
}
