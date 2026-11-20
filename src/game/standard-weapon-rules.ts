import { WEAPON_RULES } from './balance'
import type { WeaponName } from './types'

/** Unmodified rescue/basic-Zombies rules: no rarity, Pack-a-Punch, or special-weapon overlays. */
export function standardWeaponRules(item: { name: WeaponName }) {
  switch (item.name) {
    case 'pistol':
    case 'smg':
    case 'ak':
    case 'shotgun':
    case 'sniper':
    case 'magnum':
    case 'lmg':
      return WEAPON_RULES[item.name]
    default:
      throw new Error(`Unsupported standard weapon: ${item.name}`)
  }
}
