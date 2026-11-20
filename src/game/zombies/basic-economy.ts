import { WEAPON_RULES } from '../balance'
import type { HitZone } from '../hit-reactions'
import type { WeaponItem, WeaponName } from '../types'
import { weighted, type Random } from '../shared/random'
import { POINTS, PRICES, wallAmmoPrice } from './basic-rules'

export type BasicWeaponName = Extract<WeaponName, 'pistol' | 'smg' | 'ak' | 'shotgun' | 'sniper'>

export function pointsForBasicHit(hit: { lethal: boolean; zone?: HitZone; knife?: boolean; explosive?: boolean }) {
  return !hit.lethal ? POINTS.hit : hit.knife ? POINTS.knifeKill : hit.explosive ? POINTS.explosiveKill
    : hit.zone === 'head' ? POINTS.headshotKill : hit.zone === 'arm' || hit.zone === 'leg' ? POINTS.limbKill : POINTS.kill
}

export const BASIC_ZOMBIE_SLOTS = 2
export const BASIC_RESERVE_MAGAZINES = 4

export const BASIC_WALL_WEAPONS: { name: BasicWeaponName; price: number }[] = [
  { name: 'smg', price: PRICES.wall.smg },
  { name: 'shotgun', price: PRICES.wall.shotgun },
  { name: 'ak', price: PRICES.wall.ak },
  { name: 'sniper', price: PRICES.wall.sniper },
]

export const BASIC_BOX_WEIGHTS: Record<BasicWeaponName, number> = {
  pistol: 10, smg: 25, ak: 25, shotgun: 22, sniper: 18,
}

export function freshBasicWeapon(id: string, name: BasicWeaponName): WeaponItem {
  const capacity = WEAPON_RULES[name].capacity
  return { id, name, magazine: capacity, reserve: capacity * BASIC_RESERVE_MAGAZINES }
}

export function basicStartingPistol(): WeaponItem {
  const capacity = WEAPON_RULES.pistol.capacity
  return { id: 'start-pistol', name: 'pistol', magazine: capacity, reserve: capacity * 4 }
}

export type BasicWallOffer =
  | { kind: 'buy' | 'ammo'; cost: number; label: string }
  | { kind: 'full'; cost: 0; label: string }

export function basicWallOffer(name: BasicWeaponName, price: number, slots: readonly (WeaponItem | null)[]): BasicWallOffer {
  const label = WEAPON_RULES[name].label
  const owned = slots.find(item => item?.name === name)
  if (!owned) return { kind: 'buy', cost: price, label: `Buy ${label} · ${price}` }
  const capacity = WEAPON_RULES[name].capacity
  if (owned.magazine >= capacity && owned.reserve >= capacity * BASIC_RESERVE_MAGAZINES)
    return { kind: 'full', cost: 0, label: `${label} ammo full` }
  const cost = wallAmmoPrice(price)
  return { kind: 'ammo', cost, label: `${label} ammo · ${cost}` }
}

export function rollBasicBox(random: Random, held: readonly (WeaponItem | null)[]): BasicWeaponName {
  const weights = { ...BASIC_BOX_WEIGHTS }
  for (const item of held) if (item && item.name in weights) weights[item.name as BasicWeaponName] = 0
  const pool = Object.values(weights).some(Boolean) ? weights : BASIC_BOX_WEIGHTS
  return weighted(random, pool)
}
