import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Menu, MenuItem } from "@tauri-apps/api/menu";
import { cursorPosition, getCurrentWindow } from "@tauri-apps/api/window";
import { onMood } from "../lib/petState";
import {
  getSettings,
  onPetScalePreview,
  onSettingsChanged,
  type Settings,
} from "../lib/settings";
import type { ThemeId } from "../settings/theme";
import { PetRenderer } from "./PetRenderer";

async function getSettingsWithRetry(): Promise<Settings> {
  let lastError: unknown = new Error("settings unavailable");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await getSettings();
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw lastError;
}

function toggleChat(): Promise<boolean> {
  return invoke<boolean>("toggle_chat");
}

export default function PetApp() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<PetRenderer | null>(null);
  const contextMenuRef = useRef<Menu | null>(null);
  const contextMenuPromiseRef = useRef<Promise<Menu> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemeId>("dark");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    let disposed = false;
    let renderer: PetRenderer;
    const petWindow = getCurrentWindow();
    let mouseFollow = false;
    let cursorPollBusy = false;
    try {
      renderer = new PetRenderer(canvas);
      rendererRef.current = renderer;
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "unknown WebGL error";
      canvas.setAttribute("aria-label", "3D desktop pet unavailable");
      setLoadError(message);
      console.error("3D pet renderer failed", message);
      return;
    }
    const loadPersona = (personaId: string): void => {
      setLoadError(null);
      void renderer
        .load(personaId)
        .then(() => {
          if (!disposed)
            canvas.setAttribute("aria-label", "3D desktop pet ready");
        })
        .catch((error: unknown) => {
          if (disposed) return;
          const message =
            error instanceof Error ? error.message : "unknown error";
          canvas.setAttribute("aria-label", "3D desktop pet unavailable");
          setLoadError(message);
          console.error("3D pet load failed", message);
        });
    };
    void getSettingsWithRetry()
      .then((settings) => {
        setTheme(settings.theme);
        mouseFollow = settings.mouseFollow;
        renderer.setScale(settings.petScale);
        renderer.setRenderTuning(settings);
        renderer.setMouseFollowEnabled(mouseFollow);
        loadPersona(settings.personaId);
      })
      .catch((error: unknown) => {
        const message =
          error instanceof Error ? error.message : "settings unavailable";
        setLoadError(message);
      });
    const unlistenMood = onMood((mood) => renderer.setMood(mood));
    const unlistenScalePreview = onPetScalePreview((scale) =>
      renderer.setScale(scale),
    );
    const unlistenSettings = onSettingsChanged((settings) => {
      setTheme(settings.theme);
      mouseFollow = settings.mouseFollow;
      renderer.setScale(settings.petScale);
      renderer.setRenderTuning(settings);
      renderer.setMouseFollowEnabled(mouseFollow);
      loadPersona(settings.personaId);
    });
    const pollCursor = (): void => {
      if (!mouseFollow || cursorPollBusy) return;
      cursorPollBusy = true;
      void Promise.all([
        cursorPosition(),
        petWindow.outerPosition(),
        petWindow.outerSize(),
      ])
        .then(([cursor, position, size]) => {
          if (disposed || !mouseFollow) return;
          const centerX = position.x + size.width / 2;
          const centerY = position.y + size.height / 2;
          renderer.setMouseTarget({
            x: (cursor.x - centerX) / Math.max(size.width / 2, 1),
            y: (cursor.y - centerY) / Math.max(size.height / 2, 1),
          });
        })
        .catch((error: unknown) => {
          if (!disposed) {
            console.error(
              "mouse follow probe failed",
              error instanceof Error ? error : new Error(String(error)),
            );
          }
        })
        .finally(() => {
          cursorPollBusy = false;
        });
    };
    const cursorPoll = window.setInterval(pollCursor, 40);
    return () => {
      disposed = true;
      window.clearInterval(cursorPoll);
      void unlistenMood.then((stopListening) => stopListening());
      void unlistenScalePreview.then((stopListening) => stopListening());
      void unlistenSettings.then((stopListening) => stopListening());
      rendererRef.current = null;
      void contextMenuRef.current?.close();
      contextMenuRef.current = null;
      renderer.dispose();
    };
  }, []);

  const getContextMenu = (): Promise<Menu> => {
    if (contextMenuRef.current !== null) {
      return Promise.resolve(contextMenuRef.current);
    }
    if (contextMenuPromiseRef.current !== null) {
      return contextMenuPromiseRef.current;
    }
    const menuPromise = Promise.all([
      MenuItem.new({
        id: "open-widget-settings",
        text: "小组件",
        action: () => {
          void invoke<void>("open_widget_settings").catch((error: unknown) => {
            console.error(
              "widget settings open failed",
              error instanceof Error ? error : new Error(String(error)),
            );
          });
        },
      }),
      MenuItem.new({
        id: "poke-pet",
        text: "戳",
        action: () => rendererRef.current?.playNudge(),
      }),
    ])
      .then(([widgetItem, pokeItem]) =>
        Menu.new({ items: [widgetItem, pokeItem] }),
      )
      .then((menu) => {
        contextMenuRef.current = menu;
        return menu;
      });
    contextMenuPromiseRef.current = menuPromise;
    void menuPromise.then(
      () => {
        contextMenuPromiseRef.current = null;
      },
      () => {
        contextMenuPromiseRef.current = null;
      },
    );
    return menuPromise;
  };

  const downAt = useRef<{ x: number; y: number; t: number } | null>(null);

  const onMouseDown = (event: React.MouseEvent) => {
    if (event.button !== 0) return;
    downAt.current = { x: event.screenX, y: event.screenY, t: Date.now() };
  };

  const onMouseMove = (event: React.MouseEvent) => {
    const start = downAt.current;
    if (start === null) return;
    if (Math.hypot(event.screenX - start.x, event.screenY - start.y) > 4) {
      downAt.current = null;
      void getCurrentWindow().startDragging();
    }
  };

  const onMouseUp = () => {
    if (downAt.current !== null && Date.now() - downAt.current.t < 400) {
      void toggleChat().catch((error: unknown) => {
        console.error(
          "chat wake failed",
          error instanceof Error ? error : new Error(String(error)),
        );
      });
    }
    downAt.current = null;
  };

  const onContextMenu = (event: React.MouseEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    void getContextMenu()
      .then((menu) => menu.popup(undefined, getCurrentWindow()))
      .catch((error: unknown) => {
        console.error(
          "pet context menu failed",
          error instanceof Error ? error : new Error(String(error)),
        );
      });
  };

  return (
    <div
      className="pet-root"
      data-theme={theme}
      style={{ width: "100vw", height: "100vh", position: "relative" }}
    >
      <canvas
        ref={canvasRef}
        aria-label="3D desktop pet"
        style={{
          width: "100vw",
          height: "100vh",
          display: "block",
        }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onContextMenu={onContextMenu}
      />
      {loadError !== null && (
        <div
          role="alert"
          style={{
            position: "absolute",
            top: 12,
            left: 12,
            right: 12,
            padding: "8px 10px",
            color: "#fff",
            background: "rgba(120, 24, 24, 0.9)",
            borderRadius: 8,
            fontFamily: "system-ui, sans-serif",
            fontSize: 12,
            pointerEvents: "none",
          }}
        >
          3D 桌宠加载失败：{loadError}
        </div>
      )}
    </div>
  );
}
