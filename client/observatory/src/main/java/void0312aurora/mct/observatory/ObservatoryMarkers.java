package void0312aurora.mct.observatory;

import com.mojang.blaze3d.vertex.BufferBuilder;
import com.mojang.blaze3d.vertex.PoseStack;
import net.fabricmc.fabric.api.client.rendering.v1.WorldRenderContext;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.renderer.MultiBufferSource;
import net.minecraft.world.phys.Vec3;

import java.util.ArrayList;
import java.util.List;

/** Client-side labels; creates no blocks or display entities in the server. */
final class ObservatoryMarkers {
   // BufferBuilder owns native memory. Reuse it across labels and frames.
   private static final MultiBufferSource.BufferSource LABEL_BUFFERS = MultiBufferSource.immediate(new BufferBuilder(2048));
   static void render(WorldRenderContext context, ObservatoryState.Trace trace, String dimension) {
      if (context.matrixStack() == null) return;
      Vec3 position = trace.position;
      if (context.world() != null) {
         for (var player : context.world().players()) {
            if (trace.entityId.equals(player.getUUID().toString()) || trace.entityId.equals(player.getGameProfile().getName())) {
               position = player.position(); break;
            }
         }
      }
      if (position != null && ObservatoryState.sameDimension(trace.dimension, dimension)) {
         label(context, position.add(0, 3.1, 0), trace.agent + " | " + trace.actionState, trace.color);
         label(context, position.add(0, 2.75, 0), "HP " + MctObservatoryClient.value(trace.health)
            + "  Food " + MctObservatoryClient.value(trace.hunger) + " | " + trace.action, 0xFFFFFF);
      }
      for (ObservatoryState.Goal goal : visibleGoals(trace, dimension)) {
         label(context, goal.position.add(0, 1.6, 0), "目标 " + status(goal.status), goalColor(goal.status));
      }
   }

   /** Repeated visits keep separate events, but only the latest marker per spot. */
   static List<ObservatoryState.Goal> visibleGoals(ObservatoryState.Trace trace, String dimension) {
      List<ObservatoryState.Goal> result = new ArrayList<>();
      for (int i = trace.goals.size() - 1; i >= 0; i--) {
         var goal = trace.goals.get(i);
         if (ObservatoryState.sameDimension(goal.dimension, dimension)
            && result.stream().noneMatch(other -> other.position.distanceToSqr(goal.position) < 0.01)) result.add(goal);
      }
      return result;
   }

   static int goalColor(String status) {
      return switch (status) {
         case "arrived" -> 0x68E8A1;
         case "failed", "interrupted" -> 0xFF7979;
         case "superseded", "stopped" -> 0xAAAAAA;
         default -> 0xF6B93B;
      };
   }
   static String status(String value) {
      return switch (value) {
         case "arrived" -> "已抵达";
         case "failed" -> "失败";
         case "interrupted" -> "已中断";
         case "superseded" -> "已替换";
         default -> "进行中";
      };
   }

   private static void label(WorldRenderContext context, Vec3 position, String text, int color) {
      var client = Minecraft.getInstance();
      if (context.camera().getPosition().distanceToSqr(position) > 128 * 128) return;
      PoseStack poses = context.matrixStack();
      Vec3 relative = position.subtract(context.camera().getPosition());
      poses.pushPose();
      poses.translate(relative.x, relative.y, relative.z);
      poses.mulPose(context.camera().rotation());
      poses.scale(-0.025F, -0.025F, 0.025F);
      client.font.drawInBatch(text, -client.font.width(text) / 2.0F, 0, 0xFF000000 | color, false,
         poses.last().pose(), LABEL_BUFFERS, Font.DisplayMode.SEE_THROUGH, 0x88081018, 0xF000F0);
      LABEL_BUFFERS.endBatch();
      poses.popPose();
   }
}
