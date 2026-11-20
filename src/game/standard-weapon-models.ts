import { buildAk, buildLmg, buildSmg } from '../lab/weapons/models/automatics'
import { disposeGun, type Gun } from '../lab/weapons/models/common'
import { buildPistol, buildRevolver } from '../lab/weapons/models/handguns'
import { buildShotgun, buildSniper } from '../lab/weapons/models/long-guns'
import type { WeaponName } from './types'

export { disposeGun, type Gun }

export type StandardWeaponName = Extract<
  WeaponName,
  'pistol' | 'smg' | 'ak' | 'shotgun' | 'sniper' | 'magnum' | 'lmg'
>

/** Models shared by rescue and the basic Zombies mode; special Dead Ink guns never enter this graph. */
export function createStandardGun(name: StandardWeaponName): Gun {
  switch (name) {
    case 'pistol': return buildPistol()
    case 'smg': return buildSmg()
    case 'ak': return buildAk()
    case 'shotgun': return buildShotgun()
    case 'sniper': return buildSniper()
    case 'magnum': return buildRevolver()
    case 'lmg': return buildLmg()
  }
}

export function isStandardWeapon(name: WeaponName): name is StandardWeaponName {
  return name === 'pistol' || name === 'smg' || name === 'ak' || name === 'shotgun' ||
    name === 'sniper' || name === 'magnum' || name === 'lmg'
}
