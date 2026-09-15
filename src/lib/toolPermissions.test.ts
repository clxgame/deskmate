import { expect, test } from "bun:test";
import { permissionKey } from "./toolPermissions";

test("websearch uses the existing web permission bucket", () => {
  expect(permissionKey("websearch")).toBe("web");
});
