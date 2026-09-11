import { afterEach, expect, test } from 'bun:test';
import { readRig2dResponse, validateRig2dPng } from './png';
import { preloadRig2dImage } from './assets';
const imageDescriptor=Object.getOwnPropertyDescriptor(globalThis,'Image');
afterEach(() => { if (imageDescriptor) Object.defineProperty(globalThis,'Image',imageDescriptor); });
test('PNG header rejects oversized dimensions and unsupported pixel formats', async () => {
  const bytes=new Uint8Array(await Bun.file('public/personas/baobao/assets/idle-0.png').arrayBuffer());
  expect(() => validateRig2dPng(bytes)).not.toThrow();
  const size=bytes.slice(); size[18]=3; expect(() => validateRig2dPng(size)).toThrow();
  const format=bytes.slice(); format[25]=3; expect(() => validateRig2dPng(format)).toThrow();
  expect(() => validateRig2dPng(new Uint8Array(32))).toThrow();
});
test('stream limit cancels oversized body even without content length', async () => {
  let cancelled=false;
  const stream=new ReadableStream<Uint8Array>({pull(controller) {controller.enqueue(new Uint8Array(32));},cancel() {cancelled=true;}});
  await expect(readRig2dResponse(new Response(stream),20)).rejects.toThrow('oversized'); expect(cancelled).toBe(true);
});
test('cancelled image decode detaches callbacks and clears source', async () => {
  const instances: FakeImage[]=[];
  class FakeImage {
    onload: (()=>void) | null=null; onerror: (()=>void) | null=null; src=''; naturalWidth=512; naturalHeight=512;
    constructor() {instances.push(this);}
  }
  Object.defineProperty(globalThis,'Image',{configurable:true,value:FakeImage});
  const abort=new AbortController(), pending=preloadRig2dImage('blob:test',abort.signal);
  const image=instances[0]; expect(image?.src).toBe('blob:test');
  abort.abort(new Error('cancelled')); await expect(pending).rejects.toThrow('cancelled');
  expect(image?.src).toBe(''); expect(image?.onload).toBeNull(); expect(image?.onerror).toBeNull();
});
test('decode rejects wrong intrinsic size and removes callbacks', async () => {
  const instances: FakeImage[]=[];
  class FakeImage {
    onload: (()=>void) | null=null; onerror: (()=>void) | null=null; src=''; naturalWidth=1024; naturalHeight=512;
    constructor() {instances.push(this);}
  }
  Object.defineProperty(globalThis,'Image',{configurable:true,value:FakeImage});
  const pending=preloadRig2dImage('blob:test',new AbortController().signal); const image=instances[0]; image?.onload?.();
  await expect(pending).rejects.toThrow('dimensions'); expect(image?.onload).toBeNull(); expect(image?.onerror).toBeNull();
});

test('all twelve original RGB and RGBA textures pass the runtime header contract', async () => {
  const config = (await import('./config')).parseRig2dConfig((await import('../../../public/personas/baobao/figure-rig2d.json')).default);
  const files = (await import('./config')).rig2dTextureFiles(config);
  expect(files).toHaveLength(12);
  for (const file of files) {
    const bytes = new Uint8Array(await Bun.file(`public/personas/baobao/${file}`).arrayBuffer());
    expect(() => validateRig2dPng(bytes)).not.toThrow();
  }
});
