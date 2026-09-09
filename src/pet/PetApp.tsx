import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Menu, MenuItem } from "@tauri-apps/api/menu";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getSettings, onPetScalePreview, onSettingsChanged, type Settings } from "../lib/settings";
import type { PetRenderer } from "./PetRenderer";
import { PetPomodoro } from "./PetPomodoro";
import { petLayout } from "./petLayout";
import { personaById } from "./personaCatalog";
import { GifPetView } from "./GifPetView";
import { GlbPetView } from "./GlbPetView";
import { usePackRevision } from "./usePackRevision";
import { useGifState } from "./useGifState";
import { useGifVisibility } from "./useGifVisibility";
import { usePetInteraction } from "./usePetInteraction";
import { useGifPassthrough } from "./useGifPassthrough";
import { gifEnvelope } from "./gifGeometry";
import { defaultGifTiming } from "./gifState";
import type { LoadedGifPersona, loadGifPersona } from "./gifAssets";
import "./gifPet.css";

async function getSettingsWithRetry(): Promise<Settings> {
  let lastError: unknown = new Error("settings unavailable");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try { return await getSettings(); }
    catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw lastError;
}
const report = (error: unknown) => console.error("pet interaction failed", error instanceof Error ? error.message : String(error));
const openSettings = () => { void invoke("open_settings").catch(report); };

export default function PetApp({ gifLoad }: { readonly gifLoad?: typeof loadGifPersona } = {}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<PetRenderer | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [petScale, setPetScale] = useState(0.5);
  const [readyGif, setReadyGif] = useState<{ readonly identity: { readonly personaId: string }; readonly data: LoadedGifPersona } | null>(null);
  const personaId = settings?.personaId ?? "";
  const revision = usePackRevision(personaById(personaId).packId);
  const runtimeId = JSON.stringify([personaId, revision]);
  const personaIdentity = useMemo(() => ({ personaId, revision }), [personaId, revision]);
  const gif = settings !== null && personaById(personaId).renderType === "gif";
  const gifData = readyGif?.identity === personaIdentity && loadError === null ? readyGif.data : null;
  const timing = useMemo(() => gifData === null ? defaultGifTiming : gifData.config.schemaVersion === 2 ? { ...gifData.config.feedback, thinkingSelection: gifData.config.thinkingSelection } : { ...gifData.config.feedback, thinkingEscalationMs: gifData.config.thinkingEscalationMs }, [gifData]);
  const { leaving, visible } = useGifVisibility(personaId, gif, gifData?.config.leaving.durationMs ?? 910);
  const state = useGifState(visible, timing, runtimeId);
  const layout = petLayout(petScale);
  const envelope = useMemo(() => gifData?.config.schemaVersion === 2 ? gifEnvelope(gifData.config) : null, [gifData]);
  const setLocked = useGifPassthrough(gif, rootRef);
  const interaction = usePetInteraction({ gif, active: visible && !leaving && gifData !== null, identity: runtimeId, root: rootRef }, setLocked);
  const loaded = useCallback((data: LoadedGifPersona) => setReadyGif({ identity: personaIdentity, data }), [personaIdentity]);
  useEffect(() => {
    let disposed = false;
    const apply = (next: Settings) => {
      if (disposed) return;
      setSettings(next);
      setPetScale(next.petScale);
    };
    let changed = false;
    const unlisten = onSettingsChanged((next) => { changed = true; apply(next); });
    void getSettingsWithRetry().then((next) => { if (!changed) apply(next); })
      .catch((error: unknown) => { if (!disposed) setLoadError(error instanceof Error ? error.message : String(error)); });
    const scale = onPetScalePreview((value) => { if (!disposed) setPetScale(value); });
    return () => { disposed = true; void unlisten.then((stop) => stop()); void scale.then((stop) => stop()); };
  }, []);
  const settingsReady = settings !== null;
  useEffect(() => {
    if (settingsReady) void invoke("configure_pet_geometry", { gif, envelope }).catch(report);
  }, [gif, envelope, settingsReady]);

  const onContextMenu = (event: MouseEvent) => {
    event.preventDefault();
    if (!interaction.hit(event)) return;
    const release = interaction.hold();
    void (async () => {
      const items: MenuItem[] = [];
      let menu: Menu | null = null;
      try {
        items.push(await MenuItem.new({ id: "open-widget-settings", text: "小组件", action: () => { void invoke("open_widget_settings").catch(report); } }));
        items.push(await MenuItem.new({ id: "open-pet-settings", text: "设置", action: openSettings }));
        if (!gif) items.push(await MenuItem.new({ id: "poke-pet", text: "戳", action: () => rendererRef.current?.playNudge() }));
        menu = await Menu.new({ items });
        await menu.popup(undefined, getCurrentWindow());
      } finally {
        const resources = menu === null ? items : [menu, ...items];
        const results = await Promise.allSettled(resources.map((resource) => resource.close()));
        for (const result of results) if (result.status === "rejected") report(result.reason);
      }
    })().catch(report).finally(release);
  };
  return <div ref={rootRef} className="pet-root" data-theme={settings?.theme ?? "dark"}>
    {settings !== null && <button type="button" className="pet-interaction" aria-label="Open chat" style={gif ? { width: layout.width * 2 * (envelope?.horizontal ?? 0.5), height: layout.width * ((envelope?.top ?? 1) + (envelope?.bottom ?? 0)) } : undefined}
      onMouseDown={interaction.onMouseDown} onMouseMove={interaction.onMouseMove} onMouseUp={interaction.onMouseUp} onContextMenu={onContextMenu}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void invoke("toggle_chat").catch(report); } }}>
      {gif ? <GifPetView key={runtimeId} personaId={personaId} revision={revision} state={leaving ? "leaving" : state} width={layout.width}
        leaving={leaving} visible={visible} onError={setLoadError} onLoaded={loaded} load={gifLoad} />
        : <GlbPetView settings={settings} width={layout.width} height={layout.height} rendererRef={rendererRef} onError={setLoadError} />}
    </button>}
    <PetPomodoro language={settings?.language ?? "zh-CN"} scale={petScale} />
    {loadError !== null && <div role="alert" className="pet-load-error">桌宠加载失败 <button type="button" onClick={openSettings}>打开设置切换角色</button></div>}
  </div>;
}
