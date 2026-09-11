import { afterEach, expect, test } from 'bun:test';
import source from '../../../public/personas/baobao/figure-rig2d.json';
import { parseRig2dConfig, type Vec2 } from './config';
import { Rig2dRenderer, type FrameScheduler } from './renderer';

const descriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'getContext');
afterEach(() => { if (descriptor) Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', descriptor); });
function fixture() {
  const draws: string[] = [];
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { configurable: true, value: () => ({clearRect() {}, save() {}, restore() {}, drawImage() { draws.push('composite'); }}) });
  let now = 0, nextId = 0, deleted = 0;
  const pending = new Map<number, FrameRequestCallback>();
  const scheduler: FrameScheduler = { now: () => now, request: fn => { const id=++nextId; pending.set(id,fn); return id; }, cancel: id => { pending.delete(id); } };
  const polygons: (readonly (readonly Vec2[])[])[] = [];
  const config=parseRig2dConfig(source);
  const canvas=document.createElement('canvas'); Object.defineProperty(canvas,'clientWidth',{value:512});
  const renderer=new Rig2dRenderer(canvas,{config,images:new Map()},p=>polygons.push(p),message=>{throw new Error(message);},scheduler,()=>({draw(state) { draws.push(state); },destroy() { deleted++; }}));
  const step=(delta:number) => { now+=delta; const callbacks=[...pending.values()]; pending.clear(); for(const fn of callbacks) fn(now); };
  return {renderer,step,pending,draws,polygons,deleted:()=>deleted};
}
test('hidden renderer cancels RAF; showing restarts one frame; destruction releases exactly once', () => {
  const f=fixture(); f.renderer.setVisible(true); expect(f.pending.size).toBe(1); f.step(16); expect(f.draws).toContain('idle');
  f.renderer.setVisible(false); expect(f.pending.size).toBe(0); const count=f.draws.length; f.step(10000); expect(f.draws.length).toBe(count);
  f.renderer.setVisible(true); f.renderer.setVisible(true); expect(f.pending.size).toBe(1);
  f.renderer.destroy(); f.renderer.destroy(); expect(f.pending.size).toBe(0); expect(f.deleted()).toBe(1);
  f.renderer.setVisible(true); expect(f.pending.size).toBe(0);
});
test('rapid switches snapshot current blend and retain exact polygon union until final fade', () => {
  const f=fixture(); f.renderer.setVisible(true); f.step(0);
  f.renderer.setState('thinking'); f.step(60); f.renderer.setState('talking');
  expect(f.polygons.at(-1)?.length).toBe(3); f.step(60); expect(f.polygons.at(-1)?.length).toBe(3);
  f.step(60); expect(f.polygons.at(-1)?.length).toBe(1); expect(f.draws.filter(value => value !== 'composite').at(-1)).toBe('talking'); f.renderer.destroy();
});


test('WebGL context loss stops scheduling and releases renderer resources', () => {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'getContext');
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {configurable:true,value:()=>({clearRect() {},save() {},restore() {},drawImage() {}})});
  let sourceCanvas: HTMLCanvasElement | undefined, deleted=0;
  const errors: string[]=[], pending=new Map<number,FrameRequestCallback>();
  const scheduler: FrameScheduler={now:()=>0,request:fn=>{pending.set(1,fn);return 1;},cancel:id=>{pending.delete(id);}};
  const renderer=new Rig2dRenderer(document.createElement('canvas'),{config:parseRig2dConfig(source),images:new Map()},()=>{},e=>errors.push(e),scheduler,canvas=>{sourceCanvas=canvas;return {draw() {},destroy() {deleted++;}};});
  renderer.setVisible(true); sourceCanvas?.dispatchEvent(new Event('webglcontextlost',{cancelable:true}));
  expect(pending.size).toBe(0); expect(deleted).toBe(1); expect(errors[0]).toContain('context lost'); renderer.setVisible(true); expect(pending.size).toBe(0); renderer.destroy(); expect(deleted).toBe(1);
  if (descriptor) Object.defineProperty(HTMLCanvasElement.prototype,'getContext',descriptor);
});

