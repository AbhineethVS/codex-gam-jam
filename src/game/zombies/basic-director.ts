import * as THREE from 'three'
import { Capsule } from 'three/addons/math/Capsule.js'
import type { BoneName } from '../../lab/rig'
import type { CollisionWorld } from '../../player/collision'
import { EnemyActor } from '../actors'
import { hitDamage, shotgunDamageMultiplier } from '../balance'
import { rayCapsuleDistance, reactionClipName, type HitReaction, type HitZone } from '../hit-reactions'
import { EnemyNavigation } from '../navigation'
import type { EmitSound, Shot } from '../types'
import type { NavGraph } from './navgraph'

export type BasicZombieGait = 'walk' | 'run' | 'sprint'
export type BasicZombieState = 'idle' | 'rise' | 'chase' | 'dead'
export type BasicZombieTarget = { id: string; feet: THREE.Vector3; alive: boolean }

export type BasicZombie = {
  id: string
  actor: EnemyActor
  position: THREE.Vector3
  state: BasicZombieState
  gait: BasicZombieGait
  health: number
  maxHealth: number
  yaw: number
  swing: number
  attacked: boolean
  deadFor: number
  stuck: number
  stranded: boolean
  footstep: number
}

export type BasicZombieHit = {
  zombie: BasicZombie
  reaction: HitReaction
  dealt: number
  lethal: boolean
}

type Context = {
  scene: THREE.Scene
  world: CollisionWorld
  doors: THREE.Group[]
  graph: NavGraph
  emit: EmitSound
  damagePlayer: (targetId: string, amount: number, source: THREE.Vector3) => void
  onHit?: (hit: HitReaction) => void
  onRise?: (position: THREE.Vector3) => void
  actorFactory?: () => Promise<EnemyActor>
}

export const BASIC_ATTACK = { range: 1.35, cycle: 1.25, windup: 0.42, damage: 50 } as const
export const BASIC_CORPSE_TIME = 4
export const BASIC_RISE_TIME = 1.8
const SPEED: Record<BasicZombieGait, number> = { walk: 1.25, run: 2.2, sprint: 3.5 }
const BODY_CENTRE = new THREE.Vector3(0, 0.85, 0)

export class BasicZombieDirector {
  readonly zombies: BasicZombie[] = []
  readonly navigation: EnemyNavigation
  private disposed = false
  private flowTimer = 0
  private capsule = new Capsule(new THREE.Vector3(), new THREE.Vector3(), 0.27)
  private targetPoint = new THREE.Vector3()

  constructor(private context: Context) {
    this.navigation = new EnemyNavigation(context.world, context.doors, context.emit)
  }

  async init(size: number) {
    for (let i = this.zombies.length; i < size; i++) {
      const actor = await (this.context.actorFactory ?? (() => EnemyActor.create('pistol')))()
      if (this.disposed) { actor.dispose(); return }
      actor.root.name = `Zombie ${i + 1}`
      actor.root.visible = false
      actor.gun.visible = false
      addEyes(actor)
      this.context.scene.add(actor.root)
      this.zombies.push({
        id: `zombie-${i + 1}`, actor, position: new THREE.Vector3(), state: 'idle', gait: 'walk',
        health: 0, maxHealth: 0, yaw: 0, swing: 0, attacked: false, deadFor: 0,
        stuck: 0, stranded: false, footstep: 0,
      })
    }
  }

  get alive() { return this.zombies.filter(zombie => zombie.state === 'chase' || zombie.state === 'rise') }
  get aliveCount() { return this.alive.length }
  get capacity() { return this.zombies.length }

  spawn(position: THREE.Vector3, health: number, gait: BasicZombieGait, facing = 0, rise = true) {
    const zombie = this.zombies.find(candidate => candidate.state === 'idle')
    const floor = zombie ? this.navigation.floor(position) : null
    if (!zombie || !floor) return null
    zombie.position.copy(floor)
    zombie.health = zombie.maxHealth = health
    zombie.gait = gait
    zombie.yaw = facing
    zombie.state = rise ? 'rise' : 'chase'
    zombie.swing = zombie.deadFor = zombie.stuck = zombie.footstep = 0
    zombie.attacked = zombie.stranded = false
    zombie.actor.root.position.copy(floor)
    if (rise) zombie.actor.root.position.y -= 1.7
    zombie.actor.root.rotation.set(0, facing, 0)
    zombie.actor.restore('patrol')
    zombie.actor.gun.visible = false
    zombie.actor.root.visible = true
    if (rise) this.context.onRise?.(floor.clone())
    return zombie
  }

  relocate(zombie: BasicZombie, position: THREE.Vector3) {
    const floor = this.navigation.floor(position)
    if (!floor || (zombie.state !== 'chase' && zombie.state !== 'rise')) return false
    zombie.position.copy(floor)
    zombie.actor.root.position.copy(floor)
    zombie.state = 'chase'
    zombie.stuck = 0
    zombie.stranded = false
    return true
  }

  update(dt: number, targets: readonly BasicZombieTarget[]) {
    const livingTargets = targets.filter(target => target.alive)
    this.flowTimer -= dt
    if (livingTargets.length && this.flowTimer <= 0) {
      this.context.graph.flow(livingTargets.map(target => target.feet))
      this.flowTimer = 0.2
    }
    for (const zombie of this.zombies) {
      if (zombie.state === 'idle') continue
      if (zombie.state === 'dead') {
        zombie.deadFor += dt
        zombie.actor.update(dt, 'dead', false)
        if (zombie.deadFor >= BASIC_CORPSE_TIME) {
          zombie.state = 'idle'
          zombie.actor.root.visible = false
        }
        continue
      }
      if (zombie.state === 'rise') {
        zombie.swing += dt
        const t = Math.min(1, zombie.swing / BASIC_RISE_TIME)
        zombie.actor.root.position.copy(zombie.position).add(new THREE.Vector3(0, -1.7 * (1 - t), 0))
        zombie.actor.update(dt, 'patrol', false)
        zombie.actor.gun.visible = false
        if (t >= 1) { zombie.state = 'chase'; zombie.swing = 0 }
        continue
      }
      const target = nearestTarget(zombie.position, livingTargets)
      if (!target) { zombie.actor.update(dt, 'patrol', false); continue }
      const flat = Math.hypot(target.feet.x - zombie.position.x, target.feet.z - zombie.position.z)
      if (flat <= BASIC_ATTACK.range && Math.abs(target.feet.y - zombie.position.y) < 1.35) {
        this.attack(zombie, target, dt)
        continue
      }
      zombie.swing = 0
      zombie.attacked = false
      const moved = this.move(zombie, target.feet, dt)
      zombie.actor.update(dt, 'patrol', moved, undefined, SPEED[zombie.gait])
      zombie.actor.gun.visible = false
      if (moved) {
        zombie.footstep -= dt
        if (zombie.footstep <= 0) {
          zombie.footstep = zombie.gait === 'sprint' ? 0.32 : zombie.gait === 'run' ? 0.42 : 0.58
          this.context.emit({ kind: 'enemy-footstep', position: zombie.position.clone(), radius: 12 })
        }
      }
    }
  }

  private attack(zombie: BasicZombie, target: BasicZombieTarget, dt: number) {
    zombie.swing += dt
    face(zombie, target.feet, dt)
    zombie.actor.update(dt, 'combat', false, target.feet.clone().setY(target.feet.y + 1))
    zombie.actor.gun.visible = false
    if (!zombie.attacked && zombie.swing >= BASIC_ATTACK.windup) {
      zombie.attacked = true
      const distance = Math.hypot(target.feet.x - zombie.position.x, target.feet.z - zombie.position.z)
      if (distance <= BASIC_ATTACK.range + 0.25) {
        this.context.damagePlayer(target.id, BASIC_ATTACK.damage, zombie.position.clone().setY(zombie.position.y + 1))
        this.context.emit({ kind: 'zombie-swipe', position: zombie.position.clone(), radius: 8 })
      }
    }
    if (zombie.swing >= BASIC_ATTACK.cycle) {
      zombie.swing = 0
      zombie.attacked = false
    }
  }

  private move(zombie: BasicZombie, target: THREE.Vector3, dt: number) {
    const graph = this.context.graph
    const here = graph.nearest(zombie.position, 2)
    const next = here >= 0 ? graph.downhill(here) : -1
    if (next >= 0) graph.point(next, this.targetPoint)
    else this.targetPoint.copy(target)
    const dx = this.targetPoint.x - zombie.position.x, dz = this.targetPoint.z - zombie.position.z
    const distance = Math.hypot(dx, dz)
    if (distance < 0.04) return false
    const step = Math.min(distance, SPEED[zombie.gait] * dt)
    const candidate = zombie.position.clone()
    candidate.x += dx / distance * step
    candidate.z += dz / distance * step
    candidate.y = THREE.MathUtils.lerp(candidate.y, this.targetPoint.y, Math.min(1, dt * 5))
    if (!this.fits(candidate)) {
      zombie.stuck += dt
      if (zombie.stuck > 4) zombie.stranded = true
      return false
    }
    zombie.stuck = 0
    zombie.stranded = false
    zombie.position.copy(candidate)
    zombie.actor.root.position.copy(candidate)
    face(zombie, this.targetPoint, dt)
    return true
  }

  private fits(position: THREE.Vector3) {
    this.capsule.start.copy(position).y += this.capsule.radius
    this.capsule.end.copy(position).y += 1.74 - this.capsule.radius
    return this.context.world.fits(this.capsule)
  }

  private bodyHit(zombie: BasicZombie, origin: THREE.Vector3, direction: THREE.Vector3, maxDistance: number) {
    const centre = zombie.position.clone().add(BODY_CENTRE)
    if (rayCapsuleDistance(origin, direction, centre, centre, 1.9) > maxDistance) return null
    return zombie.actor.hitVolumes.raycast(origin, direction, maxDistance)
  }

  aimDistance(origin: THREE.Vector3, direction: THREE.Vector3, maxDistance: number) {
    const normalized = direction.clone().normalize()
    let distance = maxDistance
    for (const zombie of this.zombies) {
      if (zombie.state !== 'chase' && zombie.state !== 'rise') continue
      const hit = this.bodyHit(zombie, origin, normalized, distance)
      if (hit) distance = Math.min(distance, hit.distance)
    }
    return distance
  }

  hit(shot: Shot, maxDistance: number, scale: number) {
    return this.hitAll(shot, maxDistance, scale, 1)[0] ?? null
  }

  hitAll(shot: Shot, maxDistance: number, scale: number, pierce = 1): BasicZombieHit[] {
    const direction = shot.direction.clone().normalize()
    const struck: { zombie: BasicZombie; hit: NonNullable<ReturnType<BasicZombieDirector['bodyHit']>> }[] = []
    for (const zombie of this.zombies) {
      if (zombie.state !== 'chase' && zombie.state !== 'rise') continue
      const hit = this.bodyHit(zombie, shot.origin, direction, Math.min(maxDistance, shot.range))
      if (hit) struck.push({ zombie, hit })
    }
    struck.sort((a, b) => a.hit.distance - b.hit.distance)
    return struck.slice(0, Math.max(1, pierce)).map(({ zombie, hit }) => {
      const falloff = shot.weapon === 'shotgun' ? shotgunDamageMultiplier(hit.distance) : 1
      const damage = hitDamage(shot.weapon, hit.zone, shot.damage * scale) * falloff
      return this.applyHit(zombie, damage, hit.zone, hit.point, direction, hit.bone, shot.weapon)
    })
  }

  blast(centre: THREE.Vector3, radius: number, damage: number) {
    const hits: BasicZombieHit[] = []
    const from = centre.clone().setY(centre.y + 0.4)
    for (const zombie of this.zombies) {
      if (zombie.state !== 'chase' && zombie.state !== 'rise') continue
      const chest = zombie.position.clone().setY(zombie.position.y + 1.1)
      const distance = chest.distanceTo(centre)
      if (distance > radius || !this.context.world.visible(from, chest, zombie.actor.root)) continue
      hits.push(this.applyHit(zombie, damage * (1 - 0.5 * distance / radius), 'torso', chest,
        chest.clone().sub(centre).normalize(), undefined, 'shotgun'))
    }
    return hits
  }

  knife(origin: THREE.Vector3, forward: THREE.Vector3, range: number, damage: number) {
    const flatForward = forward.clone().setY(0).normalize()
    let best: BasicZombie | null = null
    let bestDistance = range
    for (const zombie of this.zombies) {
      if (zombie.state !== 'chase' && zombie.state !== 'rise') continue
      const chest = zombie.position.clone().setY(zombie.position.y + 1.1)
      const to = chest.clone().sub(origin)
      const distance = Math.hypot(to.x, to.z)
      if (distance > bestDistance || Math.abs(to.y) > 1.4 || to.setY(0).normalize().dot(flatForward) < Math.cos(Math.PI * 40 / 180)) continue
      if (!this.context.world.visible(origin, chest, zombie.actor.root)) continue
      best = zombie
      bestDistance = distance
    }
    if (!best) return null
    return this.applyHit(best, damage, 'torso', best.position.clone().setY(best.position.y + 1.1), flatForward, undefined, undefined)
  }

  private applyHit(zombie: BasicZombie, damage: number, zone: HitZone, point: THREE.Vector3, direction: THREE.Vector3,
    bone: BoneName | undefined, weapon: Shot['weapon']): BasicZombieHit {
    const before = zombie.health
    zombie.health = Math.max(0, zombie.health - Math.max(1, Math.round(damage)))
    const lethal = zombie.health === 0
    const reaction: HitReaction = { zone, point: point.clone(), direction: direction.clone(), lethal, bone, weapon, targetId: zombie.id }
    const behind = direction.x * Math.sin(zombie.yaw) + direction.z * Math.cos(zombie.yaw) > 0.25
    zombie.actor.react(reactionClipName(reaction, behind), lethal, direction)
    if (lethal) {
      zombie.state = 'dead'
      zombie.deadFor = zombie.swing = 0
      zombie.actor.update(0, 'dead', false)
      this.context.emit({ kind: 'enemy-down', position: zombie.position.clone(), radius: 8 })
    }
    this.context.onHit?.(reaction)
    this.context.emit({ kind: 'enemy-hit', position: point.clone(), radius: 14, zone })
    return { zombie, reaction, dealt: before - zombie.health, lethal }
  }

  clear() {
    for (const zombie of this.zombies) {
      zombie.state = 'idle'
      zombie.health = 0
      zombie.actor.root.visible = false
    }
  }

  dispose() {
    this.disposed = true
    for (const zombie of this.zombies) {
      zombie.actor.root.removeFromParent()
      zombie.actor.dispose()
    }
    this.zombies.length = 0
  }
}

function nearestTarget(position: THREE.Vector3, targets: readonly BasicZombieTarget[]) {
  let best: BasicZombieTarget | null = null
  let distance = Infinity
  for (const target of targets) {
    const next = position.distanceToSquared(target.feet)
    if (next < distance) { best = target; distance = next }
  }
  return best
}

function face(zombie: BasicZombie, point: THREE.Vector3, dt: number) {
  const target = Math.atan2(point.x - zombie.position.x, point.z - zombie.position.z)
  const delta = Math.atan2(Math.sin(target - zombie.yaw), Math.cos(target - zombie.yaw))
  zombie.yaw += THREE.MathUtils.clamp(delta, -dt * 6, dt * 6)
  zombie.actor.root.rotation.y = zombie.yaw
}

function addEyes(actor: EnemyActor) {
  const material = new THREE.MeshBasicMaterial({ color: 0xd4332a, toneMapped: false })
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), material)
    eye.name = 'Zombie eye'
    eye.position.set(side * 0.045, 0.22, 0.17)
    actor.rig.bones.head.add(eye)
  }
}
