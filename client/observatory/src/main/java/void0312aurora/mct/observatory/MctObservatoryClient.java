package void0312aurora.mct.observatory;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.mojang.blaze3d.systems.RenderSystem;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
import net.fabricmc.fabric.api.client.rendering.v1.HudRenderCallback;
import net.fabricmc.fabric.api.client.rendering.v1.WorldRenderContext;
import net.fabricmc.fabric.api.client.rendering.v1.WorldRenderEvents;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.renderer.GameRenderer;
import net.minecraft.network.chat.Component;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.phys.EntityHitResult;
import org.lwjgl.glfw.GLFW;

import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;

/** Read-only client: all state mutation is confined to the client thread. */
public final class MctObservatoryClient implements ClientModInitializer {
   private static final String ENDPOINT = System.getProperty("mct.observatory.url", "http://127.0.0.1:8080/mct/observability/snapshot");
   static final ObservatoryState STATE = new ObservatoryState();
   private static final AtomicBoolean REQUEST_IN_FLIGHT = new AtomicBoolean();
   private static final KeyMapping TOGGLE = key("toggle", GLFW.GLFW_KEY_O);
   private static final KeyMapping INSPECT = key("inspect", GLFW.GLFW_KEY_I);
   private static final KeyMapping SELECT = key("select", GLFW.GLFW_KEY_U);
   private static final KeyMapping MODE = key("mode", GLFW.GLFW_KEY_B);
   static String lastStatus = "waiting";
   static boolean visible = true;
   static boolean broadcast;
   private static int pollCountdown, epoch;
   private static Object lastWorld;

   private static KeyMapping key(String name, int code) {
      return new KeyMapping("key.mct_observatory." + name, code, "key.category.mct_observatory");
   }

   @Override public void onInitializeClient() {
      for (KeyMapping k : List.of(TOGGLE, INSPECT, SELECT, MODE)) KeyBindingHelper.registerKeyBinding(k);
      ClientTickEvents.END_CLIENT_TICK.register(MctObservatoryClient::tick);
      WorldRenderEvents.AFTER_ENTITIES.register(MctObservatoryClient::renderWorld);
      HudRenderCallback.EVENT.register(MctObservatoryClient::renderHud);
   }

   private static void tick(Minecraft client) {
      if (lastWorld != client.level) {
         lastWorld = client.level;
         epoch++;
         STATE.clear();
         pollCountdown = 0;
      }
      while (TOGGLE.consumeClick()) visible = !visible;
      while (MODE.consumeClick()) broadcast = !broadcast;
      while (SELECT.consumeClick()) {
         if (client.hitResult instanceof EntityHitResult hit && hit.getEntity() instanceof Player player) {
            STATE.traces.values().stream().filter(t -> t.entityId.equals(player.getUUID().toString())
               || t.entityId.equals(player.getGameProfile().getName())).findFirst().ifPresent(t -> {
                  STATE.selectedAgent = t.agent; STATE.revision++;
               });
         } else STATE.selectNext();
      }
      while (INSPECT.consumeClick()) if (client.screen == null) client.setScreen(new ObservatoryScreen());
      if (client.level == null || client.player == null || --pollCountdown > 0) return;
      pollCountdown = 20;
      if (!REQUEST_IN_FLIGHT.compareAndSet(false, true)) return;
      int requestedEpoch = epoch;
      URI uri = URI.create(ENDPOINT + "?after=" + STATE.sequence + "&run_id=" + URLEncoder.encode(STATE.runId, StandardCharsets.UTF_8));
      Thread poller = new Thread(() -> {
         HttpURLConnection connection = null;
         try {
            connection = (HttpURLConnection) uri.toURL().openConnection();
            connection.setConnectTimeout(1500);
            connection.setReadTimeout(1500);
            int status = connection.getResponseCode();
            if (status != 200) throw new IllegalStateException("HTTP " + status);
            JsonObject root = JsonParser.parseString(new String(connection.getInputStream().readAllBytes(), StandardCharsets.UTF_8)).getAsJsonObject();
            client.execute(() -> {
               if (epoch == requestedEpoch) { STATE.apply(root); lastStatus = "connected"; }
            });
         } catch (Exception error) {
            client.execute(() -> { if (epoch == requestedEpoch) lastStatus = "disconnected (cached view)"; });
         } finally {
            if (connection != null) connection.disconnect();
            REQUEST_IN_FLIGHT.set(false);
         }
      }, "mct-observatory-poll");
      poller.setDaemon(true);
      poller.start();
   }

   private static void renderWorld(WorldRenderContext context) {
      if (!visible || broadcast || context.world() == null || context.camera() == null) return;
      ObservatoryState.Trace trace = STATE.selected();
      if (trace == null) return;
      String dimension = context.world().dimension().location().toString();
      RenderSystem.enableBlend();
      RenderSystem.defaultBlendFunc();
      RenderSystem.disableDepthTest();
      RenderSystem.depthMask(false);
      RenderSystem.disableCull();
      try {
         RenderSystem.setShader(GameRenderer::getPositionColorShader);
         TrailGeometryRenderer.render(context, List.of(trace), dimension);
      } finally {
         RenderSystem.enableCull();
         RenderSystem.enableDepthTest();
         RenderSystem.depthMask(true);
         RenderSystem.disableBlend();
      }
      ObservatoryMarkers.render(context, trace, dimension);
   }

   private static void renderHud(GuiGraphics graphics, float tickDelta) {
      Minecraft client = Minecraft.getInstance();
      if (!visible || client.player == null || client.screen instanceof ObservatoryScreen) return;
      ObservatoryState.Trace t = STATE.selected();
      String run = STATE.runId.isBlank() ? "waiting for run" : STATE.runId;
      String title = "MCT | " + run + " | " + lastStatus;
      int panelWidth = Math.min(client.getWindow().getGuiScaledWidth() - 16, 390);
      graphics.fill(5, 5, panelWidth + 8, broadcast ? 33 : 112, 0xB00B1520);
      graphics.drawString(client.font, client.font.plainSubstrByWidth(title, panelWidth - 5), 9, 9, 0xFFFFFF);
      if (t == null) {
         graphics.drawString(client.font, "No agents in this run", 9, 22, 0xAAAAAA); return;
      }
      draw(graphics, t.agent + "  HP " + value(t.health) + "  Food " + value(t.hunger) + "  " + t.actionState, 22, t.color);
      if (broadcast) return;
      draw(graphics, "Action: " + t.action + " | " + t.navigation, 35, 0xFFFFFF);
      draw(graphics, "Command: " + t.command, 48, 0xDDDDDD);
      draw(graphics, "Goal: " + (t.goal == null ? "unknown" : coordinates(t.goal.position) + " " + t.goal.status), 61, 0xF6B93B);
      draw(graphics, "Actual: solid " + t.observed.size() + " | Plan: translucent + arrows " + t.planned.size(), 74, 0xDDDDDD);
      draw(graphics, "U select | I events | B broadcast | O hide", 87, 0xAAAAAA);
      draw(graphics, "Agents " + STATE.traces.size() + " | seq " + STATE.sequence + " | missing " + STATE.droppedEvents, 100, 0xAAAAAA);
   }

   private static void draw(GuiGraphics g, String text, int y, int color) {
      var client = Minecraft.getInstance();
      g.drawString(client.font, client.font.plainSubstrByWidth(text, Math.min(client.getWindow().getGuiScaledWidth() - 30, 380)), 9, y, color);
   }

   static String value(double n) { return Double.isFinite(n) ? String.format(java.util.Locale.ROOT, "%.0f", n) : "?"; }
   static String coordinates(net.minecraft.world.phys.Vec3 p) {
      return String.format(java.util.Locale.ROOT, "%.1f, %.1f, %.1f", p.x, p.y, p.z);
   }
}
