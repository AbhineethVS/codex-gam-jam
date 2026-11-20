/**
 * Rules used by the production solo Zombies loop. This deliberately contains
 * no boss, special-enemy, power-up, perk, or progression rules.
 */
export function zombieHealth(round: number) {
  const r = Math.max(1, Math.floor(round))
  if (r < 10) return 150 + 100 * (r - 1)
  let health = 950
  for (let i = 10; i <= r; i++) health *= 1.1
  return Math.floor(health)
}

const EARLY_COUNTS = [6, 8, 13, 18, 24, 27, 28, 28, 29] as const

export function zombiesInRound(round: number) {
  const r = Math.max(1, Math.floor(round))
  return r < 10 ? EARLY_COUNTS[r - 1] : 24 + Math.floor(0.5 * 0.18 * r * r)
}

export const MAX_ALIVE = 24
export const ROUND_BREAK = 10
export const STARTING_POINTS = 500
export const PLAYER_HEALTH = { base: 100, zombieHit: 50, regenDelay: 3, regenPerSecond: 60 } as const
export const ZOMBIE_DAMAGE_SCALE = 3.5

export function spawnDelay(round: number) {
  return Math.max(0.08, 2 * 0.95 ** (Math.max(1, Math.floor(round)) - 1))
}

export function movementMix(round: number) {
  const r = Math.max(1, Math.floor(round))
  const sprint = Math.min(0.7, Math.max(0, (r - 7) * 0.08))
  const run = Math.min(1 - sprint, Math.max(0, (r - 2) * 0.18))
  return { walk: Math.max(0, 1 - run - sprint), run, sprint }
}

export const POINTS = {
  hit: 10, kill: 60, limbKill: 50, headshotKill: 100,
  knifeKill: 130, explosiveKill: 50, board: 10,
} as const

export const PRICES = {
  box: 950,
  wall: { pistol: 500, smg: 1000, ak: 1200, shotgun: 1500, sniper: 1500 },
  door: { cheap: 750, standard: 1000, expensive: 1250 },
} as const

export const wallAmmoPrice = (price: number) => Math.ceil(price / 2)
