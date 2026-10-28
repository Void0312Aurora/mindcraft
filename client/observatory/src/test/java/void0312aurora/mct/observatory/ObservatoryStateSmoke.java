package void0312aurora.mct.observatory;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

/** Regression for restart with a lower cursor and terminated/stale plans. */
public final class ObservatoryStateSmoke {
   public static void main(String[] args) {
      ObservatoryState s = new ObservatoryState();
      s.apply(snapshot("old", 900, "{sequence:900,agent_id:'OLD',kind:'agent.position_sample',payload:{position:{x:1,y:2,z:3}}}"));
      s.apply(snapshot("new", 1, "{sequence:1,agent_id:'MCT_A',kind:'navigation.goal_set',goal_id:'g1',payload:{goal:{x:10,y:65,z:20}}}"));
      check(s.sequence == 1 && s.traces.size() == 1 && !s.traces.containsKey("OLD"), "new run must replace old cursor, agents and history");
      check(s.events.size() == 1 && s.selectedAgent.equals("MCT_A"), "selection and event history must reset with run");
      s.apply(snapshot("new", 2, "{sequence:2,agent_id:'MCT_A',kind:'navigation.path_update',goal_id:'g1',payload:{route:[{x:1,y:65,z:2},{x:10,y:65,z:20}]}}"));
      check(s.selected().planned.size() == 2, "current plan available");
      s.apply(snapshot("new", 3, "{sequence:3,agent_id:'MCT_A',kind:'action.interrupted',goal_id:'g1',payload:{}}"));
      check(s.selected().planned.isEmpty() && s.selected().goal.status.equals("interrupted"), "interruption clears current future route");
      s.apply(snapshot("new", 4, "{sequence:4,agent_id:'MCT_A',kind:'navigation.goal_set',goal_id:'g2',payload:{goal:{x:12,y:65,z:22}}}"));
      check(s.selected().goal.id.equals("g2") && s.selected().goals.get(0).status.equals("interrupted"), "replacement goal preserves old outcome");
      s.apply(snapshot("new", 5, "{sequence:5,agent_id:'MCT_A',kind:'navigation.goal_reached',goal_id:'g1',payload:{}}"));
      check(s.selected().goal.status.equals("travelling"), "late completion of old goal must not complete new goal");
      s.apply(snapshot("new", 6, "{sequence:6,agent_id:'MCT_A',kind:'navigation.goal_reached',goal_id:'g2',payload:{}}"));
      check(s.selected().goal.status.equals("arrived"), "matching goal completes");
      s.apply(snapshot("new", 6, "{sequence:6,agent_id:'MCT_A',kind:'navigation.goal_reached',goal_id:'g2',payload:{}}"));
      check(s.events.size() == 6, "repeated delta must not duplicate event history");
      System.out.println("Observatory state smoke: PASS (run reset, isolation, interruption, goal correlation, deduplication)");
   }
   private static JsonObject snapshot(String run, int sequence, String event) {
      return JsonParser.parseString("{run_id:'" + run + "',sequence:" + sequence + ",events:[" + event + "]}").getAsJsonObject();
   }
   private static void check(boolean condition, String message) { if (!condition) throw new AssertionError(message); }
}
