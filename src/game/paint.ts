import * as THREE from 'three'

/** Bright paintball colours; pure red stays reserved for blood and damage. */
export const PAINT_COLORS = [
  0x00a8ff, // cyan blue
  0xff2fa6, // magenta
  0xffc400, // yellow
  0x35d04f, // green
  0x8b5cf6, // violet
  0xff7a1a, // orange
] as const

/** Deterministic cycling keeps replays/tests stable while every consecutive round changes colour. */
export function paintColor(index: number) {
  return new THREE.Color(PAINT_COLORS[Math.abs(Math.floor(index)) % PAINT_COLORS.length])
}
