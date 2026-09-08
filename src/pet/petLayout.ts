export function petLayout(scale: number) {
  const modelScale = Number.isFinite(scale) ? Math.min(2, Math.max(0.1, scale)) : 0.5;
  return { width: 320 * modelScale, height: 420 * modelScale, timerScale: Math.max(0.5, modelScale) };
}
