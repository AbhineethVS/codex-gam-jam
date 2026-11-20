import * as THREE from 'three'
import { Draft, wallText } from '../../render/ink'
import { createStandardGun, disposeGun, type Gun } from '../standard-weapon-models'
import type { WallSize, WallSpot } from './placement'
import type { BasicWeaponName } from './basic-economy'

const facing = (normal: THREE.Vector3) => Math.atan2(normal.x, normal.z)
const label = (name: BasicWeaponName) => ({
  pistol: 'PISTOL', smg: 'SMG', ak: 'AK', shotgun: 'SHOTGUN', sniper: 'SNIPER',
})[name]

const buildGun = (name: BasicWeaponName): Gun => createStandardGun(name)

export class BasicWallBuy {
  readonly root = new THREE.Group()
  readonly point: THREE.Vector3
  private gun: Gun

  constructor(readonly spot: WallSpot, readonly weapon: BasicWeaponName, readonly price: number) {
    this.root.name = `Wall buy · ${weapon}`
    this.root.userData.noCollision = true
    const centre = spot.wall.clone().addScaledVector(spot.normal, 0.025).setY(spot.stand.y + 1.35)
    this.root.position.copy(centre)
    this.root.rotation.y = facing(spot.normal)
    const sheet = new Draft(`Wall buy sheet · ${weapon}`)
    sheet.box(1.15, 0.62, 0.015, 0, 0, 0, 'paper', 'edge')
    sheet.finish()
    this.gun = buildGun(weapon)
    this.gun.rotation.set(0, Math.PI / 2, 0)
    this.gun.position.set(0, 0.06, 0.05)
    this.root.add(sheet, this.gun, wallText(`${label(weapon)}  ${price}`, [0, -0.23, 0.02], 0.11))
    this.point = centre.clone()
  }

  dispose() {
    disposeGun(this.gun)
    this.root.removeFromParent()
  }
}

export type BasicBoxState = 'idle' | 'spinning' | 'offering'
export const BASIC_BOX_SPIN = 3.2
export const BASIC_BOX_OFFER = 12

export class BasicMysteryBox {
  static readonly SIZE: WallSize = { halfWidth: 0.72, top: 1.75, depth: 0.66 }
  readonly root = new THREE.Group()
  readonly point = new THREE.Vector3()
  state: BasicBoxState = 'idle'
  timer = 0
  offer: BasicWeaponName | null = null
  private lid = new THREE.Group()
  private floating: Gun | null = null

  constructor(readonly spot: WallSpot) {
    this.root.name = 'Mystery box'
    this.root.userData.noCollision = true
    const body = new Draft('Mystery box body')
    body.box(1.4, 0.55, 0.6, 0, 0.275, 0, 'paper', 'edge')
    for (const y of [0.18, 0.36]) body.line([[-0.7, y, 0.305], [0.7, y, 0.305]], 'detail')
    body.finish()
    const lid = new Draft('Mystery box lid')
    lid.box(1.43, 0.08, 0.63, 0, 0.04, 0.315, 'paper', 'edge')
    lid.finish()
    this.lid.position.set(0, 0.55, -0.3)
    this.lid.add(lid)
    this.root.add(body, this.lid, wallText('?', [0, 0.29, 0.307], 0.36))
    const centre = spot.wall.clone().addScaledVector(spot.normal, 0.36).setY(spot.stand.y)
    this.root.position.copy(centre)
    this.root.rotation.y = facing(spot.normal)
    this.point.copy(centre).setY(spot.stand.y + 0.7).addScaledVector(spot.normal, 0.3)
  }

  spin(weapon: BasicWeaponName) {
    if (this.state !== 'idle') return false
    this.offer = weapon
    this.state = 'spinning'
    this.timer = 0
    return true
  }

  take() {
    if (this.state !== 'offering') return null
    const offer = this.offer
    this.close()
    return offer
  }

  update(dt: number): 'landed' | 'expired' | null {
    const target = this.state === 'idle' ? 0 : -1.25
    this.lid.rotation.x += (target - this.lid.rotation.x) * Math.min(1, dt * 8)
    if (this.state === 'idle') return null
    this.timer += dt
    if (this.state === 'spinning' && this.timer >= BASIC_BOX_SPIN) {
      this.state = 'offering'
      this.timer = 0
      this.setFloating(this.offer)
      return 'landed'
    }
    if (this.state === 'offering' && this.timer >= BASIC_BOX_OFFER) {
      this.close()
      return 'expired'
    }
    if (this.floating) {
      this.floating.position.y = 0.82 + Math.sin(this.timer * 2.5) * 0.04
      this.floating.rotation.y += dt * 0.8
    }
    return null
  }

  close() {
    this.state = 'idle'
    this.timer = 0
    this.offer = null
    this.setFloating(null)
  }

  private setFloating(name: BasicWeaponName | null) {
    if (this.floating) disposeGun(this.floating)
    this.floating = name ? buildGun(name) : null
    if (!this.floating) return
    this.floating.name = `Mystery box gun · ${name}`
    this.floating.position.set(0, 0.82, 0)
    this.floating.rotation.y = Math.PI / 2
    this.root.add(this.floating)
  }

  dispose() {
    this.setFloating(null)
    this.root.removeFromParent()
  }
}
