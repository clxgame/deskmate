import { describe, expect, test } from 'bun:test';
import source from '../../../public/personas/baobao/figure-rig2d.json';
import { parseRig2dConfig, parseRig2dPath, rig2dTextureFiles, Rig2dError } from './config';
import { fadeProgress } from './blend';
import { pointInGifPolygon } from '../gifGeometry';

describe('rig2d pack contract', () => {
  test('accepts authored six states and twelve PNGs', () => {
    const config=parseRig2dConfig(source);
    expect(rig2dTextureFiles(config)).toHaveLength(12);
    expect(config.states.sleep.textures).toEqual(['assets/sleep-0.png']);
  });
  test.each(['../idle.png','assets/../../idle.png','https://host/a.png','assets/a.js','assets/a.PNG','assets/a\\b.png'])('rejects unsafe path %s', path => expect(() => parseRig2dPath(path)).toThrow(Rig2dError));
  test('rejects arbitrary renderer code and unknown fields', () => {
    expect(() => parseRig2dConfig({...source,renderer:'custom.js'})).toThrow(Rig2dError);
    expect(() => parseRig2dConfig({...source,script:'run.js'})).toThrow(Rig2dError);
  });
  test('rejects invalid rig and nonsimple polygons', () => {
    const pose=source.states.idle;
    for(const rig of [{...pose.rig,eyeAngle:Infinity},{...pose.rig,eyeRadius:[0,20]},{...pose.rig,neck:[-1,10]}]) {
      expect(() => parseRig2dConfig({...source,states:{...source.states,idle:{...pose,rig}}})).toThrow(Rig2dError);
    }
    expect(() => parseRig2dConfig({...source,states:{...source.states,idle:{...pose,hitPolygon:[[0,0],[40,40],[0,40],[40,0]]}}})).toThrow(Rig2dError);
  });
  test('sleep body is clickable while drifting marks stay transparent', () => {
    const polygon=parseRig2dConfig(source).states.sleep.hitPolygon;
    expect(pointInGifPolygon([300,400],polygon,0)).toBe(true);
    expect(pointInGifPolygon([365,180],polygon,0)).toBe(false);
  });
});
test('crossfade clamps at exactly 120ms, with no queued transition', () => {
  expect(fadeProgress(null,0)).toBe(1); expect(fadeProgress(100,99)).toBe(0);
  expect(fadeProgress(100,160)).toBe(.5); expect(fadeProgress(100,220)).toBe(1);
  expect(fadeProgress(160,220)).toBe(.5);
});
