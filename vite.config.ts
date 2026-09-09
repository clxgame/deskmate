import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { realpathSync, rmSync } from "node:fs";

// Two entry pages: pet (transparent always-on-top mascot) and chat (chat panel).
export default defineConfig({
  root: realpathSync(__dirname),
  plugins: [react(), {
    name: "exclude-optional-gif-pack",
    apply: "build",
    closeBundle() {
      rmSync(resolve(__dirname, "dist/personas/xiaoxiongchong"), { recursive: true, force: true });
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
