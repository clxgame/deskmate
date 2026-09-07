import { expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveConfig } from "vite";

test("uses the physical project root so junction builds emit local HTML paths", async () => {
  // Given: config loading may start from a junction or another working directory.
  const configFile = fileURLToPath(new URL("./vite.config.ts", import.meta.url));
  const projectRoot = realpathSync(dirname(configFile)).replaceAll("\\", "/");

  // When: Vite resolves the production configuration.
  const config = await resolveConfig({ configFile }, "build");

  // Then: its root shares the same physical identity as Rollup's HTML modules.
  expect(config.root).toBe(projectRoot);
});
