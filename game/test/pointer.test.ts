import { describe, expect, it } from 'vitest';
import { Pointer, Screen, Widget } from '../src/platform/widgets';

class Box extends Widget {
  clicks = 0;
  draw(): void {}
  click(): void {
    this.clicks++;
  }
}

describe('Pointer', () => {
  it('a tap clicks and leave clears the hover (a lifted finger hovers nothing)', () => {
    const box = new Box(0, 0, 10, 10);
    const screen = new (class extends Screen {
      draw(): void {}
    })('test');
    screen.widgets = [box];
    const p = new Pointer(() => screen);
    p.down(5, 5);
    expect([box.hover, box.pressed]).toEqual([true, true]);
    p.up(5, 5);
    expect([box.clicks, box.pressed, box.hover]).toEqual([1, false, true]); // a mouse still hovers
    p.leave();
    expect(box.hover).toBe(false);
  });
});
