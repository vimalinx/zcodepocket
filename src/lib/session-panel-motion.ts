// Native gesture velocity is dp/s (unlike PanResponder's dp/ms).
export function panelReleaseTarget(position: number, origin: number, page: number, dx: number, velocity: number, width: number) {
  'worklet';
  if (Math.abs(dx) > 24 && Math.abs(velocity) > 450) return velocity < 0 ? 1 : 0;
  // A new finger can reverse an unfinished animation from any visible position.
  if (origin > 0 && origin < 1) return position >= 0.5 ? 1 : 0;
  const distance = dx * (page === 0 ? -1 : 1);
  return distance > width * 0.22 ? 1 - page : page;
}

export function panelSettleMotion(distance: number, velocity = 0) {
  'worklet';
  const remaining = Math.max(0, Number.isFinite(distance) ? distance : 0);
  if (remaining < 1) return { duration: 0, controlY: 0 };
  const speed = Math.max(0, Math.min(4, Number.isFinite(velocity) ? velocity : 0));
  // Short fast releases must not sit at an almost-finished endpoint for 220ms.
  const duration = Math.round(Math.max(70, Math.min(420, 100 + remaining * 0.7 / (0.6 + speed))));
  return { duration, controlY: Math.min(0.6, speed * duration / remaining * 0.25) };
}
