import { STEP_MS } from '../core/level';

export const MAX_STEPS = 10;

/** Accumulates real time into fixed simulation steps; a long pause (background tab) is dropped, not replayed. */
export function advance(acc: number, dt: number): { steps: number; acc: number } {
  acc += dt;
  const steps = Math.floor(acc / STEP_MS);
  if (steps > MAX_STEPS) return { steps: MAX_STEPS, acc: 0 };
  return { steps, acc: acc - steps * STEP_MS };
}
