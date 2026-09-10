import { expect, test } from "bun:test";
import { parseDefaultPosition } from "./pack-position";

test("accepts drawing-center ratios for a portable default position", () => {
  const position = { anchor: "drawing-center", x: 0.95625, y: 0.9564649198072734 } as const;
  expect(parseDefaultPosition(position)).toEqual(position);
});

test.each([
  null, {}, { anchor: "window", x: 0.5, y: 0.5 },
  { anchor: "drawing-center", x: -0.1, y: 0.5 },
  { anchor: "drawing-center", x: 1.1, y: 0.5 },
  { anchor: "drawing-center", x: 0.5, y: Number.NaN },
  { anchor: "drawing-center", x: "0.5", y: 0.5 },
  { anchor: "drawing-center", x: 0.5, y: 0.5, extra: true },
])("rejects invalid default position %j", value => {
  expect(() => parseDefaultPosition(value)).toThrow();
});
