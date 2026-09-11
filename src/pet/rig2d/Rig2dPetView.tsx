import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { loadRig2dPersona, type LoadedRig2dPersona } from './assets';
import { Rig2dRenderer } from './renderer';
import type { Rig2dState, Vec2 } from './config';
import { setGifHitPolygon } from '../gifGeometry';
import '../gifPet.css';
export { rig2dEnvelope } from './config';
export interface Rig2dPetViewProps {
  readonly personaId: string; readonly revision?: string; readonly state: Rig2dState | 'success' | 'leaving'; readonly width: number;
  readonly leaving: boolean; readonly visible?: boolean; readonly onError: (error: string | null) => void;
  readonly onLoaded?: (data: LoadedRig2dPersona) => void; readonly load?: typeof loadRig2dPersona;
}
export function Rig2dPetView({personaId,revision='',state,width,leaving,visible=true,onError,onLoaded,load=loadRig2dPersona}: Rig2dPetViewProps) {
  const canvas = useRef<HTMLCanvasElement>(null), renderer = useRef<Rig2dRenderer | null>(null);
  const [polygons,setPolygons] = useState<readonly (readonly Vec2[])[]>([]);
  const [ready,setReady] = useState(false);
  const latest = useRef({state,visible,leaving});
  useLayoutEffect(() => { latest.current={state,visible,leaving}; }, [state,visible,leaving]);
  useEffect(() => {
    const abort = new AbortController(); setReady(false); setPolygons([]); onError(null);
    void load(personaId,abort.signal,revision).then(data => {
      if (abort.signal.aborted || !canvas.current) return;
      const fail = (message: string) => { if (!abort.signal.aborted) { setReady(false); setPolygons([]); onError(message); } };
      const instance = new Rig2dRenderer(canvas.current,data,setPolygons,fail); renderer.current=instance;
      instance.setState(latest.current.state === 'success' || latest.current.state === 'leaving' ? 'idle' : latest.current.state);
      instance.setVisible(latest.current.visible); setReady(true); onLoaded?.(data);
    }).catch((error: unknown) => { if (!abort.signal.aborted) onError(error instanceof Error ? error.message : String(error)); });
    return () => { abort.abort(); renderer.current?.destroy(); renderer.current=null; };
  },[personaId,revision,load,onError,onLoaded]);
  useEffect(() => { if (!leaving && state !== 'leaving') renderer.current?.setState(state === 'success' ? 'idle' : state); renderer.current?.setVisible(visible && !leaving); },[state,visible,leaving,ready]);
  const style: CSSProperties = {position:'absolute',pointerEvents:'none',width,height:width,left:0,bottom:0,opacity:ready && !leaving ? 1 : 0,
    transform: leaving ? 'translateX(-50%)' : 'translateX(0)',transition:leaving ? 'transform 910ms ease-in-out, opacity 910ms linear' : 'none'};
  return <span className='gif-pet-frame' style={{width,height:width,bottom:0}}>
    <canvas ref={canvas} aria-label='包包桌面伙伴' data-state={state} style={style} />
    {polygons.map((polygon,index) => <span key={index} className='gif-pet-image' data-hit-disabled={!ready || !visible || leaving} style={{...style,opacity:0}}
      ref={element => { if (element) setGifHitPolygon(element,polygon.map(([x,y]): Vec2 => [x*240/512,y*240/512])); }} />)}
  </span>;
}


