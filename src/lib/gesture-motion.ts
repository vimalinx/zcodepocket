export type GestureRelease = { dx: number; vx: number; width: number };

// PanResponder velocity is dp/ms. Match the initial easing slope to the release
// velocity, then decelerate to rest; keep even fast releases visibly readable.
export function settleMotion(distance: number, velocity = 0) {
  const remaining = Math.max(0, Number.isFinite(distance) ? distance : 0);
  const speed = Math.max(0, Math.min(3, Number.isFinite(velocity) ? velocity : 0));
  const duration = Math.round(Math.max(220, Math.min(520, 230 + remaining * 0.6 / (0.45 + speed))));
  const initialSlope = remaining > 1 ? Math.min(2.4, speed * duration / remaining) : 0;
  return { duration, controlY: initialSlope * 0.25 };
}
