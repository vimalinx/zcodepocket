export function tiltOffset(current: { x: number; y: number }, origin: { x: number; y: number }) {
  const clamp = (value: number) => Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
  return { x: clamp((current.x - origin.x) / 0.35), y: clamp((current.y - origin.y) / 0.35) };
}
