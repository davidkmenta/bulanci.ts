import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

/** A short tick, like a joystick microswitch closing: the native haptics in the app, navigator.vibrate on the web
 *  (Android). iOS Safari has no vibration API; its <input switch> tick only follows a tap, not a sliding thumb. */
export function tick(): void {
  if (Capacitor.isNativePlatform()) void Haptics.impact({ style: ImpactStyle.Light });
  else navigator.vibrate?.(8);
}
