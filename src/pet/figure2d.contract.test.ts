import { expect, test } from "bun:test";
import fixtures from "../../tests/fixtures/figure2d-contract.json";
import { parseFigure2dConfig } from "./figure2d";

for (const fixture of fixtures) {
  test(`shared contract ${fixture.name}`, () => {
    const parse = () => parseFigure2dConfig(fixture.config);
    if (fixture.valid) expect(Number(parse().schemaVersion)).toBe(fixture.config.schemaVersion);
    else expect(parse).toThrow();
  });
}

for (const [name, value] of [["NaN", Number.NaN], ["positive infinity", Number.POSITIVE_INFINITY], ["negative infinity", Number.NEGATIVE_INFINITY]] as const) {
  test(`rejects ${name} source coordinates when input is a JS object`, () => {
    const valid = fixtures.find(fixture => fixture.name === "valid-v2");
    if (!valid) throw new Error("missing fixture");
    const config = parseFigure2dConfig(valid.config);
    const input = { ...config, animations: { ...config.animations, idle: { ...config.animations.idle, hitPolygon: [[value,0],[240,0],[0,240]] } } };
    expect(() => parseFigure2dConfig(input)).toThrow("hitPolygon.x");
  });
}
