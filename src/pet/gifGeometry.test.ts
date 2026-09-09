import { expect, test } from "bun:test";
import { gifDisplayRect, gifSourcePoint, pointInGifPolygon } from "./gifGeometry";

test("calibrated geometry and inverse mapping preserve source coordinates at every scale and DPI", () => {
  for (const scale of [0.1, 0.5, 1, 2]) for (const dpi of [1, 1.25, 1.5, 2]) {
    const width = 320 * scale;
    const rect = gifDisplayRect(width, { scale: 0.5, offsetX: 24, offsetY: 48 });
    expect(rect.left).toBeCloseTo(width * 0.35);
    expect(rect.top).toBeCloseTo(width * 0.3);
    expect(gifSourcePoint([(rect.left + rect.width / 2) * dpi / dpi, (rect.top + rect.height / 2) * dpi / dpi], rect)[0]).toBeCloseTo(120);
    expect(rect.left - rect.width * 0.5).toBeCloseTo(width * 0.1);
  }
});
test("polygon excludes props and allows inclusive edge tolerance", () => {
  const polygon = [[60, 60], [180, 60], [180, 180], [60, 180]] as const;
  expect(pointInGifPolygon([120, 120], polygon, 3)).toBe(true);
  expect(pointInGifPolygon([57, 120], polygon, 3)).toBe(true);
  expect(pointInGifPolygon([56.9, 120], polygon, 3)).toBe(false);
  expect(pointInGifPolygon([220, 220], polygon, 3)).toBe(false);
});

import { gifEnvelope } from "./gifGeometry";
import { parseFigure2dConfig } from "./figure2d";
import config from "../../public/personas/xiaoxiongchong/figure2d.json";
test("the fixed envelope contains every action and its leaving endpoint at every scale", () => {
  const parsed = parseFigure2dConfig(config);
  const envelope = gifEnvelope(parsed);
  for (const scale of [0.1,0.5,1,2]) for (const dpi of [1,1.25,1.5,2]) {
    const width = 320 * scale;
    for (const [state, action] of Object.entries(parsed.animations)) {
      const rect = gifDisplayRect(width, action);
      const shift = state === "leaving" ? parsed.leaving.translateXRatio * rect.width : 0;
      const epsilon = 1e-8;
      expect((rect.left + shift) * dpi + epsilon).toBeGreaterThanOrEqual((0.5-envelope.horizontal)*width*dpi);
      expect((rect.left + rect.width)*dpi).toBeLessThanOrEqual((0.5+envelope.horizontal)*width*dpi + epsilon);
      expect(rect.top*dpi+epsilon).toBeGreaterThanOrEqual((1-envelope.top)*width*dpi);
      expect((rect.top+rect.height)*dpi).toBeLessThanOrEqual((1+envelope.bottom)*width*dpi+epsilon);
    }
  }
});
