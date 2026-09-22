/** SVG helpers for dials. Angles in degrees, 0° = 12 o'clock, clockwise. */

export function polar(cx: number, cy: number, r: number, deg: number) {
  const a = ((deg - 90) * Math.PI) / 180
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }
}

export function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  let sweep = endDeg - startDeg
  if (sweep <= 0.01) return ''
  if (sweep >= 359.99) {
    // Two half arcs: a single arc cannot describe a full circle.
    const a = polar(cx, cy, r, startDeg)
    const b = polar(cx, cy, r, startDeg + 180)
    return `M ${a.x} ${a.y} A ${r} ${r} 0 1 1 ${b.x} ${b.y} A ${r} ${r} 0 1 1 ${a.x} ${a.y}`
  }
  sweep = Math.min(sweep, 359.99)
  const s = polar(cx, cy, r, startDeg)
  const e = polar(cx, cy, r, startDeg + sweep)
  return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 ${sweep > 180 ? 1 : 0} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`
}

/** Angle of a pointer relative to the centre, 0..360, 0 = top. */
export function pointerAngle(cx: number, cy: number, x: number, y: number): number {
  const deg = (Math.atan2(x - cx, cy - y) * 180) / Math.PI
  return (deg + 360) % 360
}
