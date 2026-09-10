import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { readdirSync, realpathSync, rmSync } from "node:fs";
import { BUILTIN_PACKS } from "./src/pet/personaCatalog";

// Two entry pages: pet (transparent always-on-top mascot) and chat (chat panel).
export default defineConfig({
  root: realpathSync(__dirname),
  plugins: [react(), {
    name: "exclude-optional-persona-packs",
    apply: "build",
    closeBundle() {
      const personasDir = resolve(__dirname, "dist/personas");
      const builtinIds = new Set(BUILTIN_PACKS.flatMap(pack => pack.personas.map(persona => persona.id)));
      for (const entry of readdirSync(personasDir)) {
        if (!builtinIds.has(entry)) {
          rmSync(resolve(personasDir, entry), { recursive: true, force: true });
        }
      }
    },
  }],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    target: "es2022",
    rollupOptions: {
      input: {
        pet: resolve(__dirname, "pet.html"),
        chat: resolve(__dirname, "chat.html"),
        settings: resolve(__dirname, "settings.html"),
      },
    },
  },
});
