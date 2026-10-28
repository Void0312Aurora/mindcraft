package void0312aurora.mct.observatory;

import com.mojang.blaze3d.systems.RenderSystem;
import com.mojang.blaze3d.vertex.BufferBuilder;
import com.mojang.blaze3d.vertex.BufferUploader;
import com.mojang.blaze3d.vertex.DefaultVertexFormat;
import com.mojang.blaze3d.vertex.Tesselator;
import com.mojang.blaze3d.vertex.VertexFormat;
import net.fabricmc.fabric.api.client.rendering.v1.WorldRenderContext;
import net.minecraft.world.phys.Vec3;
import org.joml.Matrix4f;

import java.util.ArrayList;
import java.util.List;

/**
 * World-space path geometry for the Observatory.
 *
 * The line/arrow construction is adapted from the MIT-licensed Trail Mod
 * TrailRenderer.java (Suleiman700/Fabric-Trail-Mod, revision
 * 3f7e887569f05d167316570dcd770b6696993cfc). The data source and path
 * semantics remain MCT-specific: observed samples are passive telemetry and
 * planned points come from mineflayer-pathfinder.
 */
final class TrailGeometryRenderer {
   private static final double LIFT = 0.82D;
   private static final double OBSERVED_LINE_WIDTH = 0.28D;
   private static final double PLANNED_LINE_WIDTH = 0.10D;
   private static final double ARROW_SPACING = 5.0D;
   private static final double ARROW_LENGTH = 1.0D;
   private static final double ARROW_WIDTH = 0.42D;
   private static final int OBSERVED_MARKER_EVERY = 1;

   private TrailGeometryRenderer() {
   }

   static void render(WorldRenderContext context,
                      Iterable<ObservatoryState.Trace> traces,
                      String dimension) {
      if (context.matrixStack() == null || context.camera() == null) return;
      Vec3 camera = context.camera().getPosition();
      Matrix4f pose = context.matrixStack().last().pose();
      for (ObservatoryState.Trace trace : traces) {
         drawObserved(trace, dimension, camera, pose);
         drawPlanned(trace, dimension, camera, pose);
         drawGoals(trace, dimension, camera, pose);
      }
   }

   private static void drawGoals(ObservatoryState.Trace trace, String dimension, Vec3 camera, Matrix4f pose) {
      BufferBuilder buffer = Tesselator.getInstance().getBuilder();
      buffer.begin(VertexFormat.Mode.QUADS, DefaultVertexFormat.POSITION_COLOR);
      for (ObservatoryState.Goal goal : ObservatoryMarkers.visibleGoals(trace, dimension)) {
         Vec3 center = goal.position.add(0, 0.25, 0);
         int color = ObservatoryMarkers.goalColor(goal.status);
         for (int i = 0; i < 24; i++) {
            double a = i * Math.PI / 12, b = (i + 1) * Math.PI / 12;
            drawRibbon(buffer, pose, camera, center.add(Math.cos(a), 0, Math.sin(a)),
               center.add(Math.cos(b), 0, Math.sin(b)), color, 0.9F, 0.07D);
         }
         drawRibbon(buffer, pose, camera, center.add(0, 0, 0), center.add(0, 1.2, 0), color, 0.9F, 0.07D);
      }
      BufferUploader.drawWithShader(buffer.end());
   }

   private static void drawObserved(ObservatoryState.Trace trace, String dimension,
                                    Vec3 camera, Matrix4f pose) {
      List<List<Vec3>> segments = ObservatoryState.observedSegmentsFor(trace.observed, dimension);
      if (segments.stream().noneMatch(points -> points.size() >= 2)) {
         drawObservedMarkers(ObservatoryState.pointsFor(trace.observed, dimension), trace.color, camera, pose);
         return;
      }
      BufferBuilder buffer = Tesselator.getInstance().getBuilder();
      buffer.begin(VertexFormat.Mode.QUADS, DefaultVertexFormat.POSITION_COLOR);
      for (List<Vec3> points : segments) {
         for (int i = 0; i + 1 < points.size(); i++) {
            drawRibbon(buffer, pose, camera, lifted(points.get(i)), lifted(points.get(i + 1)),
               trace.color, 0.98F, OBSERVED_LINE_WIDTH);
         }
      }
      BufferUploader.drawWithShader(buffer.end());
      drawObservedMarkers(ObservatoryState.pointsFor(trace.observed, dimension), trace.color, camera, pose);
   }

   private static void drawPlanned(ObservatoryState.Trace trace, String dimension,
                                   Vec3 camera, Matrix4f pose) {
      List<Vec3> points = ObservatoryState.pointsFor(trace.planned, dimension);
      if (points.size() < 2) return;

      BufferBuilder buffer = Tesselator.getInstance().getBuilder();
      buffer.begin(VertexFormat.Mode.QUADS, DefaultVertexFormat.POSITION_COLOR);
      double distanceBefore = 0.0D;
      for (int i = 0; i + 1 < points.size(); i++) {
         Vec3 start = lifted(points.get(i));
         Vec3 end = lifted(points.get(i + 1));
         Vec3 delta = end.subtract(start);
         double segmentLength = delta.length();
         if (segmentLength <= 1.0E-6D) continue;
         drawRibbon(buffer, pose, camera, start, end, 0xFFFFFF, 0.68F, PLANNED_LINE_WIDTH);

         double distanceAfter = distanceBefore + segmentLength;
         int firstArrow = (int) Math.floor(distanceBefore / ARROW_SPACING) + 1;
         int lastArrow = (int) Math.floor(distanceAfter / ARROW_SPACING);
         Vec3 direction = delta.scale(1.0D / segmentLength);
         for (int k = firstArrow; k <= lastArrow; k++) {
            double target = k * ARROW_SPACING;
            double u = (target - distanceBefore) / segmentLength;
            if (u < 0.0D || u > 1.0D) continue;
            Vec3 tip = start.lerp(end, u);
            drawArrow(buffer, pose, camera, tip, direction, 0xFFFFFF, 0.95F);
         }
         distanceBefore = distanceAfter;
      }
      BufferUploader.drawWithShader(buffer.end());
   }

   private static void drawObservedMarkers(List<Vec3> points, int color,
                                           Vec3 camera, Matrix4f pose) {
      RenderSystem.lineWidth(1.0F);
      BufferBuilder buffer = Tesselator.getInstance().getBuilder();
      buffer.begin(VertexFormat.Mode.QUADS, DefaultVertexFormat.POSITION_COLOR);
      for (int i = 0; i < points.size(); i++) {
         if (i % OBSERVED_MARKER_EVERY != 0 && i != points.size() - 1) continue;
         drawMarker(buffer, pose, camera, lifted(points.get(i)), color, 0.22D, 0.98F);
      }
      BufferUploader.drawWithShader(buffer.end());
   }

   private static void drawArrow(BufferBuilder buffer, Matrix4f pose, Vec3 camera,
                                 Vec3 tip, Vec3 direction, int color, float alpha) {
      Vec3 up = Math.abs(direction.y) > 0.9D ? new Vec3(1.0D, 0.0D, 0.0D) : new Vec3(0.0D, 1.0D, 0.0D);
      Vec3 side = direction.cross(up);
      if (side.lengthSqr() <= 1.0E-8D) return;
      side = side.normalize().scale(ARROW_WIDTH);
      Vec3 base = tip.subtract(direction.scale(ARROW_LENGTH));
      Vec3 left = base.add(side);
      Vec3 right = base.subtract(side);
      drawRibbon(buffer, pose, camera, tip, left, color, alpha, 0.10D);
      drawRibbon(buffer, pose, camera, tip, right, color, alpha, 0.10D);
   }

   private static void drawMarker(BufferBuilder buffer, Matrix4f pose, Vec3 camera,
                                  Vec3 center, int color, double radius, float alpha) {
      Vec3 view = camera.subtract(center);
      if (view.lengthSqr() <= 1.0E-8D) return;
      view = view.normalize();
      Vec3 side = new Vec3(0.0D, 1.0D, 0.0D).cross(view);
      if (side.lengthSqr() <= 1.0E-8D) side = new Vec3(1.0D, 0.0D, 0.0D);
      side = side.normalize().scale(radius);
      Vec3 vertical = view.cross(side).normalize().scale(radius);
      vertex(buffer, pose, camera, center.add(side).add(vertical), color, alpha);
      vertex(buffer, pose, camera, center.subtract(side).add(vertical), color, alpha);
      vertex(buffer, pose, camera, center.subtract(side).subtract(vertical), color, alpha);
      vertex(buffer, pose, camera, center.add(side).subtract(vertical), color, alpha);
   }

   private static void drawRibbon(BufferBuilder buffer, Matrix4f pose, Vec3 camera,
                                  Vec3 start, Vec3 end, int color, float alpha, double width) {
      Vec3 direction = end.subtract(start);
      if (direction.lengthSqr() <= 1.0E-8D) return;
      Vec3 midpoint = start.add(end).scale(0.5D);
      Vec3 view = midpoint.subtract(camera);
      Vec3 side = direction.cross(view);
      if (side.lengthSqr() <= 1.0E-8D) side = new Vec3(1.0D, 0.0D, 0.0D);
      side = side.normalize().scale(width);
      ribbonVertex(buffer, pose, camera, start.add(side), color, alpha);
      ribbonVertex(buffer, pose, camera, start.subtract(side), color, alpha);
      ribbonVertex(buffer, pose, camera, end.subtract(side), color, alpha);
      ribbonVertex(buffer, pose, camera, end.add(side), color, alpha);
   }

   private static void ribbonVertex(BufferBuilder buffer, Matrix4f pose, Vec3 camera,
                                    Vec3 point, int color, float alpha) {
      float red = ((color >> 16) & 0xFF) / 255.0F;
      float green = ((color >> 8) & 0xFF) / 255.0F;
      float blue = (color & 0xFF) / 255.0F;
      buffer.vertex(pose, (float) (point.x - camera.x), (float) (point.y - camera.y),
         (float) (point.z - camera.z)).color(red, green, blue, alpha).endVertex();
   }

   private static void vertex(BufferBuilder buffer, Matrix4f pose, Vec3 camera,
                              Vec3 point, int color, float alpha) {
      float red = ((color >> 16) & 0xFF) / 255.0F;
      float green = ((color >> 8) & 0xFF) / 255.0F;
      float blue = (color & 0xFF) / 255.0F;
      buffer.vertex(pose, (float) (point.x - camera.x), (float) (point.y - camera.y),
         (float) (point.z - camera.z)).color(red, green, blue, alpha).endVertex();
   }

   private static Vec3 lifted(Vec3 point) {
      return point.add(0.0D, LIFT, 0.0D);
   }
}
