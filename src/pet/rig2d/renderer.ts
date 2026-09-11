import { Rig2dGl } from './gl';
import { Rig2dError, type Rig2dState, type Vec2 } from './config';
import type { LoadedRig2dPersona } from './assets';
import { drawSleepMarks, fadeProgress } from './blend';

export interface FrameScheduler { request(callback: FrameRequestCallback): number; cancel(id: number): void; now(): number }
const browserFrames: FrameScheduler = { request: callback => requestAnimationFrame(callback), cancel: id => cancelAnimationFrame(id), now: () => performance.now() };
export class Rig2dRenderer {
  private readonly source = document.createElement('canvas');
  private readonly previous = document.createElement('canvas');
  private readonly frame = document.createElement('canvas');
  private readonly outputContext: CanvasRenderingContext2D;
  private readonly previousContext: CanvasRenderingContext2D;
  private readonly frameContext: CanvasRenderingContext2D;
  private readonly gl: Pick<Rig2dGl, 'draw' | 'destroy'>;
  private state: Rig2dState = 'idle';
  private fadeStart: number | null = null;
  private clock = 0;
  private last: number | null = null;
  private raf: number | null = null;
  private visible = false;
  private disposed = false;
  private hasFrame = false;
  private transitionPolygons: readonly (readonly Vec2[])[] = [];
  constructor(private readonly output: HTMLCanvasElement, private readonly data: LoadedRig2dPersona,
    private readonly onPolygons: (polygons: readonly (readonly Vec2[])[]) => void,
    private readonly onError: (error: string) => void, private readonly scheduler = browserFrames, createGl: (canvas: HTMLCanvasElement, data: LoadedRig2dPersona) => Pick<Rig2dGl, 'draw' | 'destroy'> = (canvas, data) => new Rig2dGl(canvas, data)) {
    const outputContext = output.getContext('2d'), previousContext = this.previous.getContext('2d'), frameContext = this.frame.getContext('2d');
    if (!outputContext || !previousContext || !frameContext) throw new Rig2dError('canvas unavailable');
    this.outputContext = outputContext; this.previousContext = previousContext; this.frameContext = frameContext;
    this.gl = createGl(this.source, data);
    this.source.addEventListener('webglcontextlost', this.contextLost);
  }
  private readonly contextLost = (event: Event) => { event.preventDefault(); this.destroy(); this.onError('WebGL context lost; reload the character to retry'); };
  setState(state: Rig2dState): void {
    if (state === this.state || this.disposed) return;
    if (this.hasFrame) {
      this.previous.width = this.output.width; this.previous.height = this.output.height;
      this.previousContext.drawImage(this.output,0,0); this.fadeStart = this.scheduler.now();
      this.transitionPolygons = [...new Set([...this.transitionPolygons, this.data.config.states[this.state].hitPolygon])];
    }
    this.state = state; this.updatePolygons();
  }
  private updatePolygons(): void { this.onPolygons([...new Set([...this.transitionPolygons, this.data.config.states[this.state].hitPolygon])]); }
  setVisible(visible: boolean): void {
    if (this.disposed || visible === this.visible) return;
    this.visible = visible; this.last = null;
    if (!visible) { if (this.raf !== null) this.scheduler.cancel(this.raf); this.raf = null; }
    else { this.updatePolygons(); this.raf = this.scheduler.request(this.draw); }
  }
  private readonly draw = (now: number): void => {
    this.raf = null; if (this.disposed || !this.visible) return;
    try {
      this.clock += this.last === null ? 0 : Math.min(.05, (now-this.last)/1000); this.last = now;
      const pixels = Math.max(1,Math.round(this.output.clientWidth*Math.min(globalThis.devicePixelRatio || 1,2)));
      this.gl.draw(this.state,this.clock,pixels);
      if (this.output.width !== pixels) this.output.width = this.output.height = pixels;
      if (this.frame.width !== pixels) this.frame.width = this.frame.height = pixels;
      this.frameContext.clearRect(0,0,pixels,pixels); this.frameContext.drawImage(this.source,0,0);
      if (this.state === 'sleep') drawSleepMarks(this.frameContext,pixels,this.clock);
      const progress = fadeProgress(this.fadeStart,now), ctx = this.outputContext;
      ctx.clearRect(0,0,pixels,pixels); ctx.save();
      if (progress < 1) { ctx.globalAlpha=1-progress; ctx.drawImage(this.previous,0,0,pixels,pixels); ctx.globalCompositeOperation='lighter'; ctx.globalAlpha=progress; }
      else if (this.fadeStart !== null) { this.fadeStart=null; this.transitionPolygons=[]; this.updatePolygons(); }
      ctx.drawImage(this.frame,0,0,pixels,pixels); ctx.restore(); this.hasFrame=true;
      this.raf=this.scheduler.request(this.draw);
    } catch (error) { this.destroy(); this.onError(error instanceof Error ? error.message : String(error)); }
  };
  destroy(): void {
    if (this.disposed) return;
    this.setVisible(false); this.disposed=true; this.source.removeEventListener('webglcontextlost',this.contextLost); this.gl.destroy();
    for (const canvas of [this.source,this.previous,this.frame]) canvas.width=canvas.height=1;
    this.outputContext.clearRect(0,0,this.output.width,this.output.height); this.onPolygons([]);
  }
}



