import { expect, test } from 'bun:test';
import { petLayout } from './petLayout';

test('keeps the timer readable while the model can shrink below half size', () => {
  // Given the smallest supported pet, when deriving its layout.
  const layout = petLayout(0.1);
  // Then only the timer scale is floored; the model retains its selected size.
  expect(layout).toEqual({ width: 32, height: 42, timerScale: 0.5 });
});

test('scales the timer proportionally across half to double size', () => {
  // Given supported middle and upper sizes, when deriving each layout.
  const layouts = [0.5, 1, 2, 3].map(petLayout);
  // Then the timer grows with the model and stops at double size.
  expect(layouts.map(layout => layout.timerScale)).toEqual([0.5, 1, 2, 2]);
  expect(layouts.map(layout => layout.width)).toEqual([160, 320, 640, 640]);
});
