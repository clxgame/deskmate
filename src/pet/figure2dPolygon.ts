import type { Figure2dPoint } from './figure2d';

type Point = Figure2dPoint;
const cross = (a: Point, b: Point, c: Point) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const on = (a: Point, b: Point, p: Point) => cross(a,b,p) === 0 && p[0] >= Math.min(a[0],b[0]) && p[0] <= Math.max(a[0],b[0]) && p[1] >= Math.min(a[1],b[1]) && p[1] <= Math.max(a[1],b[1]);
function intersects(a: Point,b: Point,c: Point,d: Point): boolean {
  const x = cross(a,b,c), y = cross(a,b,d), z = cross(c,d,a), w = cross(c,d,b);
  return ((x > 0 && y < 0 || x < 0 && y > 0) && (z > 0 && w < 0 || z < 0 && w > 0)) || on(a,b,c) || on(a,b,d) || on(c,d,a) || on(c,d,b);
}
export function simplePolygon(points: readonly Point[]): boolean {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i+1)%points.length];
    if (!a || !b) return false;
    area += a[0]*b[1]-b[0]*a[1];
    for (let j=i+1;j<points.length;j++) {
      const c=points[j], d=points[(j+1)%points.length];
      if (!c || !d || a[0]===c[0] && a[1]===c[1]) return false;
      if (j===i+1) { if (on(a,b,d) || on(c,d,a)) return false; }
      else if (i===0 && j===points.length-1) { if (on(a,b,c) || on(c,d,b)) return false; }
      else if (intersects(a,b,c,d)) return false;
    }
  }
  return area !== 0;
}
