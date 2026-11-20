import * as THREE from 'three'
import { Capsule } from 'three/addons/math/Capsule.js'
import type { EnvironmentCamera } from '../../camera'
import type { ActionTarget } from '../../player/actions'
import type { FirstPersonController } from '../../player/controller'
import { setDoorOpen } from '../../world/doors'
import { BulletTrails } from '../bullet-trails'
import { fallDamage, WEAPON_RULES } from '../balance'
import { MissionAudio } from '../audio'
import { MissionHUD } from '../hud'
import { MissionBlood } from '../hit-reactions'
import { MissionImpacts } from '../impacts'
import type { MenuCopy } from '../menu'
import { PlayerDeathSequence } from '../player-death'
import { PlayerHitReactions } from '../player-hit-reactions'
import { paintColor } from '../paint'
import { getSettings, lookScale, subscribeSettings, volumeFor } from '../settings'
import { DamageIndicator } from '../shared/damage-indicator'
import { HitMarkers } from '../shared/hitmarkers'
import { seeded, type Random } from '../shared/random'
import type { MissionWorld, Shot, SoundEvent } from '../types'
import { FirstPersonWeapons, THROW_RELEASE } from '../weapons'
import {
  BASIC_RESERVE_MAGAZINES, BASIC_WALL_WEAPONS,
  basicStartingPistol, basicWallOffer, freshBasicWeapon, pointsForBasicHit, rollBasicBox,
} from './basic-economy'
import { ZombieDirector, type Zombie, type ZombieGait, type ZombieTarget } from './director'
import { bruteDue, roundAlive } from './brute'
import { BLOT, GAS, rollBlot } from './gas'
import { StormPack } from './flyers'
import { BasicZombieHud } from './basic-hud'
import { newBasicGame, returnBasicSpawns, stepBasicRounds, type BasicRoundState } from './basic-rounds'
import {
  MAX_ALIVE, PLAYER_HEALTH, PRICES, STARTING_POINTS, ZOMBIE_DAMAGE_SCALE, movementMix, zombieHealth,
} from './basic-rules'
import { BOSS, STORM, inkwingHealth, isStormRound, stormNumber } from './rules'
import { BasicMysteryBox, BasicWallBuy } from './basic-stations'
import { Explosion, createGrenadeModel } from './vfx'
import { GRENADE, Grenades } from './grenades'
import { NavGraph, geometryHash, type NavData } from './navgraph'
import { findWallSpots } from './placement'
import { pickSpawn } from './spawn'
import { Barriers, WINDOW, type Barrier } from './windows'
import { SEALED, ZoneGates, type ZoneGate } from './zones'

export type BasicZombieState = {
  phase: 'active' | 'dead'
  health: number
  elapsed: number
  kills: number
  points: number
  round: number
  headshots: number
  knifeKills: number
}

export const BASIC_SPAWN_POINT: [number, number, number] = [-30, 0, -25]
export const BASIC_KNIFE = { damage: 150, range: 2.1, cooldown: 0.55 } as const
export const BASIC_POOL_SIZE = MAX_ALIVE + 8

export const BASIC_DEAD_INK_COPY: MenuCopy = {
  title: 'Dead Ink',
  premise: 'Survive the rounds. Buy guns off the walls. Try your luck at the box.',
  begin: 'Start',
  resume: 'Resume',
  restart: 'New game',
  deadTitle: 'Game over.',
  completeTitle: 'Game over.',
  completePremise: '',
  objective: state => {
    const current = state as BasicZombieState
    return current.round > 0 ? `Round ${current.round} · ${current.points} points` : 'Get ready'
  },
  deadPremise: state => {
    const current = state as BasicZombieState
    return `You survived ${current.round} round${current.round === 1 ? '' : 's'} · ${current.kills} kills · ${current.headshots} headshots`
  },
  recap: state => {
    const current = state as BasicZombieState
    return [['Round', String(current.round)], ['Kills', String(current.kills)], ['Headshots', String(current.headshots)]]
  },
  restartWarning: 'This game ends and a new one starts at round 1.',
  missionPage: false,
  modeLink: { label: 'Hostage mission', href: './' },
  mode: 'zombies',
  music: false,
  controls: [['Knife', 'V'], ['Grenade', 'Q or G'], ['Switch weapon', 'Wheel or 1–2']],
  tutorial: [
    ['Move', 'W A S D', 'Left stick'],
    ['Aim / fire', 'Mouse', 'LT / RT'],
    ['Buy / open', 'F', 'Hold X / Square'],
    ['Reload', 'R', 'Tap X / Square'],
    ['Knife', 'V', 'RB / R1'],
    ['Grenade', 'Q / G', 'LB / L1'],
  ],
}

export class BasicZombiesRuntime {
  state: BasicZombieState = this.freshState()
  readonly weapons: FirstPersonWeapons
  readonly audio = new MissionAudio()
  readonly blood: MissionBlood
  readonly impacts: MissionImpacts
  readonly bulletTrails: BulletTrails
  readonly playerHits = new PlayerHitReactions()
  readonly death = new PlayerDeathSequence()
  readonly hud: MissionHUD
  readonly zombieHud: BasicZombieHud
  readonly hits: HitMarkers
  readonly indicator: DamageIndicator
  readonly grenades: Grenades
  readonly explosions: Explosion
  director: ZombieDirector | null = null
  graph: NavGraph | null = null
  rounds: BasicRoundState = newBasicGame()
  zones: ZoneGates | null = null
  barriers: Barriers | null = null
  wallBuys: BasicWallBuy[] = []
  box: BasicMysteryBox | null = null
  ready = false
  readonly initialized: Promise<void>
  deaths = 0
  invincible = false
  grenadeCount: number = GRENADE.start

  private random: Random
  private spawn = new THREE.Vector3(...BASIC_SPAWN_POINT)
  private abort = new AbortController()
  private stopSettings = () => {}
  private disposed = false
  private active = false
  private aiming = false
  private interactionTime = 0
  private knifeCooldown = 0
  private grenadeCooldown = 0
  private pendingThrow = -1
  private lastHurt = -100
  private safePosition = new THREE.Vector3()
  private impactPoint: THREE.Vector3 | null = null
  private wheelAmount = 0
  private wheelAt = 0
  private repairing: Barrier | null = null
  private repairWait = 0
  private strandTimer = 0
  private pushCapsule = new Capsule(new THREE.Vector3(), new THREE.Vector3(), 0.3)
  private paintRound = 0
  private brute: Zombie | null = null
  private bruteTimer = 0
  private storm = false
  private stormPack = new StormPack()
  private gasDamage = 0

  constructor(private scene: THREE.Scene, private camera: EnvironmentCamera, readonly player: FirstPersonController,
    readonly world: MissionWorld, private invalidate: () => void, seed = Math.floor(Math.random() * 2 ** 31)) {
    this.random = seeded(seed)
    player.missionMode = true
    player.canPlay = () => this.ready && this.state.phase === 'active'
    if (!camera.perspective.parent) scene.add(camera.perspective)
    this.weapons = new FirstPersonWeapons({
      scene, camera: camera.perspective, world: player.world,
      aimDistance: (origin, direction, maxDistance) => this.director?.aimDistance(origin, direction, maxDistance) ?? maxDistance,
      emit: event => this.emit(event),
      onShot: shot => this.shot(shot),
    })
    this.blood = new MissionBlood(scene, player.world, id => {
      const zombie = this.director?.zombies.find(candidate => candidate.id === id)
      return zombie?.state === 'dead' ? zombie.actor.rig.bones.chest.getWorldPosition(new THREE.Vector3()) : null
    })
    this.impacts = new MissionImpacts(scene, player.world)
    this.bulletTrails = new BulletTrails(scene, 'Player bullet')
    this.grenades = new Grenades(scene, player.world, createGrenadeModel)
    this.explosions = new Explosion(scene, player.world)
    player.lookSensitivity = () => lookScale(this.weapons.lookSensitivity, this.aiming)
    this.hud = new MissionHUD(world, {
      retry: () => { this.restart(); void this.audio.unlock(); this.player.requestControl() },
      restart: () => { this.restart(); void this.audio.unlock(); this.player.requestControl() },
      volume: () => this.applySettings(),
      mute: () => this.applySettings(),
    }, BASIC_DEAD_INK_COPY)
    const hudRoot = document.querySelector<HTMLElement>('#mission-hud')!
    this.zombieHud = new BasicZombieHud(hudRoot)
    this.hits = new HitMarkers(hudRoot)
    this.indicator = new DamageIndicator(hudRoot)
    this.stopSettings = subscribeSettings(() => this.applySettings())
    this.applySettings()
    document.querySelector('#world')?.setAttribute('aria-label',
      'Dead Ink solo zombies. Mouse to look, WASD move, left click fire, right click aim, wheel switches weapons, V knife, Q grenade, F buys or uses, R reloads, Escape pauses.')
    player.onPlayingChange = playing => this.hud.setPlaying(playing)
    player.actions.extraTargets = () => this.targets()
    player.actions.onAction = target => {
      this.weapons.cancel()
      this.aiming = false
      this.interactionTime = 0.25
      if (target.kind === 'door' || target.kind === 'ladder')
        this.emit({ kind: target.kind, position: target.point, radius: target.kind === 'door' ? 8 : 5 })
    }
    this.bindInput()
    this.initialized = this.initialize()
  }

  private freshState(): BasicZombieState {
    return { phase: 'active', health: PLAYER_HEALTH.base, elapsed: 0, kills: 0, points: STARTING_POINTS, round: 0, headshots: 0, knifeKills: 0 }
  }

  private async initialize() {
    try {
      const doors: THREE.Group[] = []
      this.scene.traverse(object => { if (object.userData.kind === 'door') doors.push(object as THREE.Group) })
      for (const door of doors) { door.userData.missionLocked = false; setDoorOpen(door, true, true) }
      const hash = geometryHash(this.scene)
      for (const door of doors) if (SEALED.some(seal => seal.door === door.name)) {
        door.userData.missionLocked = true
        setDoorOpen(door, false, true)
      }
      this.player.world.refresh()
      const response = await fetch(`${import.meta.env?.BASE_URL ?? '/'}nav/compound.json`)
      if (!response.ok) throw new Error(`navigation data: HTTP ${response.status}`)
      const graph = NavGraph.fromData(await response.json() as NavData)
      if (this.disposed) return
      if (graph.geometry && graph.geometry !== hash)
        console.warn(`Dead Ink: navigation graph was baked for geometry ${graph.geometry}, map is ${hash}.`)
      this.graph = graph
      this.director = new ZombieDirector({
        scene: this.scene, world: this.player.world, doors: doors.filter(door => !door.userData.missionLocked), graph,
        emit: event => this.emit(event),
        damagePlayer: (_id, amount, source, knock) => this.damage(amount, source, knock),
        players: () => [{ id: 'p1', feet: this.player.body.position, alive: this.state.phase === 'active',
          air: !this.player.body.grounded }],
        onHit: hit => { this.impactPoint = hit.point.clone(); this.blood.emitHit(hit); this.audio.confirmHit(hit) },
      })
      this.director.random = this.random
      await this.director.init(BASIC_POOL_SIZE)
      if (this.disposed) return
      this.zones = new ZoneGates(this.scene, this.player.world, graph)
      this.zones.closeAll()
      this.barriers = new Barriers(this.scene, this.player.world, graph, event => this.emit(event))
      this.director.windows = this.barriers.list
      this.player.world.warm()
      const floor = this.player.world.floor(this.spawn.clone().setY(0.6), 1, 1.5, 0.28)
      if (Number.isFinite(floor)) this.spawn.y = floor
      this.placeStations()
      this.startGame()
      this.ready = true
      this.hud.ready()
      this.invalidate()
    } catch (error) {
      if (this.disposed) return
      console.error('Dead Ink failed to load', error)
      this.hud.error(`Could not load Dead Ink: ${error instanceof Error ? error.message : String(error)}. Reload this page to retry.`)
      this.invalidate()
    }
  }

  private placeStations() {
    const graph = this.graph!
    graph.flow([this.spawn])
    const spots = findWallSpots(graph, this.player.world, this.random, {
      count: BASIC_WALL_WEAPONS.length + 1, near: 6, far: 70, spacing: 9, size: BasicMysteryBox.SIZE,
    })
    const boxIndex = Math.min(2, spots.length - 1)
    for (const [index, spot] of spots.entries()) {
      if (index === boxIndex) {
        this.box = new BasicMysteryBox(spot)
        this.scene.add(this.box.root)
        continue
      }
      const offer = BASIC_WALL_WEAPONS[this.wallBuys.length]
      if (!offer) continue
      const buy = new BasicWallBuy(spot, offer.name, offer.price)
      this.wallBuys.push(buy)
      this.scene.add(buy.root)
    }
  }

  private startGame() {
    this.state = this.freshState()
    this.rounds = newBasicGame()
    this.director?.clear()
    this.zones?.closeAll()
    this.barriers?.reset()
    this.box?.close()
    this.weapons.restore({ slots: [basicStartingPistol(), null], selected: 0, pickups: [], nextId: 1 })
    this.grenades.clear()
    this.grenadeCount = GRENADE.start
    this.grenadeCooldown = 0
    this.pendingThrow = -1
    this.repairing = null
    this.player.actions.reset()
    this.player.body.teleport(this.spawn.clone())
    this.player.world.refresh()
    this.player.body.update(1 / 60, new THREE.Vector3(), false)
    this.player.actions.syncCamera(this.camera.perspective)
    const look = this.wallBuys[0]?.point ?? this.spawn.clone().add(new THREE.Vector3(0, 1.7, -5))
    this.camera.perspective.lookAt(look.x, this.spawn.y + 1.7, look.z)
    this.safePosition.copy(this.player.body.position)
    this.lastHurt = -100
    this.knifeCooldown = 0
    this.strandTimer = 0
    this.brute = null
    this.bruteTimer = 0
    this.storm = false
    this.stormPack = new StormPack()
    this.gasDamage = 0
    delete document.body.dataset.deadInkStorm
    document.body.style.removeProperty('--dead-ink-gas')
  }

  restart() {
    this.death.reset()
    this.weapons.resetDeath()
    this.playerHits.clear()
    this.player.pause()
    this.cancelInput()
    this.audio.reset()
    this.player.actions.reset()
    this.player.movementLocked = false
    this.blood.restore(undefined)
    this.interactionTime = 0
    this.bulletTrails.clear()
    this.impacts.clear()
    this.explosions.clear()
    this.hits.clear()
    this.indicator.clear()
    this.zombieHud.clear()
    this.hud.reset()
    this.startGame()
    this.invalidate()
  }

  retry() { this.restart() }

  private bindInput() {
    const options = { signal: this.abort.signal }
    document.querySelector('#walk-start')!.addEventListener('click', () => { void this.audio.unlock() }, options)
    window.addEventListener('keydown', this.keyDown, options)
    document.querySelector('#world')!.addEventListener('wheel', event => {
      const wheel = event as WheelEvent
      if (!this.isActive() || wheel.ctrlKey || wheel.metaKey || wheel.altKey) return
      wheel.preventDefault()
      if (this.aiming && this.weapons.current?.name === 'sniper') {
        this.weapons.adjustScopeZoom(-Math.sign(wheel.deltaY))
        return
      }
      const now = performance.now()
      if (now - this.wheelAt > 400) this.wheelAmount = 0
      this.wheelAmount += wheel.deltaY * (wheel.deltaMode === 1 ? 40 : wheel.deltaMode === 2 ? 400 : 1)
      if (Math.abs(this.wheelAmount) >= 50 && now - this.wheelAt >= 150) {
        this.weapons.cycle(this.wheelAmount > 0 ? 1 : -1)
        this.wheelAmount = 0
        this.wheelAt = now
      }
      this.invalidate()
    }, { ...options, passive: false })
    window.addEventListener('mousedown', event => {
      if (!this.isActive() || event.target !== document.querySelector('#world')) return
      void this.audio.unlock()
      if (event.button === 0) this.weapons.trigger(true)
      if (event.button === 2) this.aiming = this.weapons.canAim && !this.aiming
      this.invalidate()
    }, options)
    window.addEventListener('mouseup', event => { if (event.button === 0) this.weapons.trigger(false) }, options)
    window.addEventListener('blur', () => this.cancelInput(), options)
    document.addEventListener('pointerlockchange', () => { if (!this.player.playing) this.cancelInput() }, options)
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.cancelInput() }, options)
  }

  private keyDown = (event: KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.repeat || !this.isActive()) return
    if (event.target instanceof HTMLElement && event.target.closest('button,input,select,textarea,summary,[contenteditable="true"]')) return
    switch (event.code) {
      case 'KeyR': this.weapons.reload(); break
      case 'Digit1': this.weapons.switchSlot(0); break
      case 'Digit2': this.weapons.switchSlot(1); break
      case 'KeyV': this.knife(); break
      case 'KeyQ': case 'KeyG': this.throwGrenade(); break
      default: return
    }
    if (!this.weapons.canAim) this.aiming = false
    event.preventDefault()
    this.invalidate()
  }

  private isActive() {
    return this.ready && this.state.phase === 'active' && this.player.enabled && this.player.playing && !this.player.immersive
  }

  private cancelInput() {
    this.aiming = false
    this.weapons.cancel()
  }

  private targets(): ActionTarget[] {
    if (!this.isActive()) return []
    const targets: ActionTarget[] = []
    for (const buy of this.wallBuys) {
      const offer = basicWallOffer(buy.weapon, buy.price, this.weapons.slots)
      const label = offer.kind === 'full' || this.state.points >= offer.cost ? offer.label : `${offer.label} · need ${offer.cost - this.state.points} more`
      targets.push({ object: buy.root, point: buy.point, kind: 'mission', descending: false, label, use: () => this.useWall(buy) })
    }
    const eye = this.camera.perspective.position
    for (const gate of this.zones?.gates ?? []) {
      if (gate.state !== 'closed') continue
      const point = this.zones!.nearestPoint(gate, eye)
      if (point.distanceTo(eye) > 4) continue
      const cost = gate.spec.cost
      targets.push({
        object: gate.closed, point, kind: 'mission', descending: false,
        label: `Open the gate to ${gate.spec.zone} · ${cost}${this.state.points >= cost ? '' : ` · need ${cost - this.state.points} more`}`,
        use: () => this.useGate(gate),
      })
    }
    for (const barrier of this.barriers?.list ?? []) {
      if (barrier.boards >= WINDOW.boards || barrier.vaulting || !barrier.inside(eye) || barrier.point.distanceTo(eye) > 2.65) continue
      targets.push({
        object: this.barriers!.root, point: barrier.point, kind: 'mission', descending: false,
        label: 'Hold to rebuild the barrier', use: () => { this.repairing = barrier; return true },
      })
    }
    if (this.box && this.box.state !== 'spinning') {
      const box = this.box
      const label = box.state === 'offering' && box.offer
        ? `Take ${WEAPON_RULES[box.offer].label}`
        : `Mystery Box · ${PRICES.box}${this.state.points >= PRICES.box ? '' : ` · need ${PRICES.box - this.state.points} more`}`
      targets.push({ object: box.root, point: box.point, kind: 'mission', descending: false, label, use: () => this.useBox(box) })
    }
    return targets
  }

  private canReach(point: THREE.Vector3, object: THREE.Object3D) {
    const eye = this.camera.perspective.position
    return eye.distanceTo(point) <= 2.65 && this.player.world.visible(eye, point, object)
  }

  private spend(cost: number) {
    if (this.state.points < cost) { this.hud.notify('Not enough points.', 1.6, true); return false }
    this.state.points -= cost
    this.zombieHud.spend(cost)
    return true
  }

  private useWall(buy: BasicWallBuy) {
    if (!this.isActive() || !this.canReach(buy.point, buy.root)) return false
    const offer = basicWallOffer(buy.weapon, buy.price, this.weapons.slots)
    if (offer.kind === 'full' || !this.spend(offer.cost)) return false
    if (offer.kind === 'buy') this.weapons.give(freshBasicWeapon(`wall-${buy.weapon}-${Math.floor(this.state.elapsed * 1000)}`, buy.weapon))
    else {
      const capacity = WEAPON_RULES[buy.weapon].capacity
      this.weapons.refill(buy.weapon, capacity, capacity * BASIC_RESERVE_MAGAZINES)
    }
    this.invalidate()
    return true
  }

  private useGate(gate: ZoneGate) {
    if (!this.zones || gate.state !== 'closed') return false
    const point = this.zones.nearestPoint(gate, this.camera.perspective.position)
    if (!this.canReach(point, gate.closed) || !this.spend(gate.spec.cost)) return false
    this.zones.open(gate)
    this.hud.notify(`${gate.spec.zone} is open.`, 2.5)
    this.emit({ kind: 'door', position: point, radius: 30 })
    this.invalidate()
    return true
  }

  private useBox(box: BasicMysteryBox) {
    if (!this.isActive() || !this.canReach(box.point, box.root)) return false
    if (box.state === 'offering') {
      const name = box.take()
      if (!name) return false
      this.weapons.give(freshBasicWeapon(`box-${name}-${Math.floor(this.state.elapsed * 1000)}`, name))
      return true
    }
    if (box.state !== 'idle' || !this.spend(PRICES.box)) return false
    box.spin(rollBasicBox(this.random, this.weapons.slots))
    this.emit({ kind: 'pickup', position: box.point, radius: 8 })
    return true
  }

  private award(amount: number) {
    this.state.points += amount
    this.zombieHud.gain(amount)
  }

  private shot(shot: Shot) {
    if (!this.isActive() || !this.director) return
    const paint = paintColor(this.paintRound++)
    const surface = this.player.world.raySurface(shot.origin, shot.direction, shot.range)
    const distance = surface?.distance ?? shot.range
    this.impactPoint = null
    const pierce = shot.weapon === 'sniper' ? 3 : 1
    const struck = this.director.hitAll(shot, distance, ZOMBIE_DAMAGE_SCALE, false, pierce)
    for (const hit of struck) {
      this.award(pointsForBasicHit({ lethal: hit.lethal, zone: hit.reaction.zone }))
      this.hits.hit(hit.reaction.point, hit.dealt, hit.zombie.id, hit.reaction.zone === 'head', hit.lethal)
      if (hit.lethal) {
        this.state.kills++
        if (hit.reaction.zone === 'head') this.state.headshots++
      }
    }
    const end = this.impactPoint ?? shot.origin.clone().addScaledVector(shot.direction, distance)
    const impact = !struck.length && surface
      ? () => this.impacts.emit(end, shot.direction, surface, shot.weapon, paint)
      : undefined
    this.bulletTrails.emit(shot.origin, end, shot.weapon, undefined, impact, paint)
  }

  knife() {
    if (!this.isActive() || !this.director || this.knifeCooldown > 0) return false
    this.knifeCooldown = BASIC_KNIFE.cooldown
    this.weapons.knifeSwing()
    const eye = this.camera.perspective.getWorldPosition(new THREE.Vector3())
    const forward = this.camera.perspective.getWorldDirection(new THREE.Vector3())
    const hit = this.director.knife(eye, forward, BASIC_KNIFE.range, BASIC_KNIFE.damage)
    if (!hit) return false
    this.award(pointsForBasicHit({ lethal: hit.lethal, zone: hit.reaction.zone, knife: true }))
    this.hits.hit(hit.reaction.point, hit.dealt, hit.zombie.id, false, hit.lethal)
    if (hit.lethal) { this.state.kills++; this.state.knifeKills++ }
    return true
  }

  throwGrenade() {
    if (!this.isActive() || this.grenadeCount <= 0 || this.grenadeCooldown > 0) return false
    this.grenadeCount--
    this.grenadeCooldown = GRENADE.cooldown
    this.pendingThrow = THROW_RELEASE
    this.weapons.throwItem(createGrenadeModel())
    return true
  }

  private launchGrenade() {
    const camera = this.camera.perspective
    const forward = camera.getWorldDirection(new THREE.Vector3())
    const origin = camera.getWorldPosition(new THREE.Vector3()).addScaledVector(forward, 0.45).add(new THREE.Vector3(0, -0.05, 0))
    this.grenades.throw(origin, forward, this.player.body.velocity.clone().multiplyScalar(0.5))
  }

  private grenadeBlast(at: THREE.Vector3) {
    if (!this.director) return
    for (const hit of this.director.blast(at, GRENADE.radius, GRENADE.damage)) {
      this.award(pointsForBasicHit({ lethal: hit.lethal, explosive: true }))
      this.hits.hit(hit.reaction.point, hit.dealt, hit.zombie.id, false, hit.lethal)
      if (hit.lethal) this.state.kills++
    }
    const eye = this.camera.perspective.getWorldPosition(new THREE.Vector3())
    const distance = eye.distanceTo(at)
    if (distance < GRENADE.selfRadius && this.player.world.visible(at.clone().setY(at.y + 0.3), eye, new THREE.Object3D()))
      this.damage(Math.round(GRENADE.selfDamage * (1 - distance / GRENADE.selfRadius)), at)
    this.explosions.emit(at, GRENADE.radius)
    this.emit({ kind: 'grenade-blast', position: at, radius: 120 })
  }

  damage(amount: number, source?: THREE.Vector3, knock?: THREE.Vector3) {
    if (this.invincible || !this.isActive() || !(amount > 0)) return
    this.state.health = Math.max(0, this.state.health - amount)
    this.lastHurt = this.state.elapsed
    if (knock && this.state.health > 0 && !this.player.actions.traversing) {
      this.player.body.velocity.add(knock)
      if (knock.y > 0) this.player.body.grounded = false
    }
    if (source) {
      this.indicator.hit(source, amount)
      const point = this.player.body.position.clone().add(new THREE.Vector3(0, 1.17, 0))
      this.playerHits.hit({ region: 'torso', side: 0, point, direction: point.clone().sub(source) }, amount, this.player.body.grounded)
    }
    this.hud.hurt()
    this.audio.play({ kind: 'damage' })
    if (this.state.health === 0) this.gameOver(source)
    this.invalidate()
  }

  private gameOver(source?: THREE.Vector3) {
    this.state.phase = 'dead'
    this.deaths++
    const direction = source ? this.camera.perspective.position.clone().sub(source) : undefined
    this.death.begin(this.camera.perspective, this.player.body.position, this.player.world, this.hud.reducedMotion, direction)
    this.weapons.beginDeath()
    this.player.pause()
    this.player.actions.reset()
    this.cancelInput()
    this.player.body.velocity.set(0, 0, 0)
    this.audio.beginDeath()
    this.hud.setScoped(false)
    this.hud.clearThreat()
    this.hud.setDeath(this.death)
  }

  private spawnZombie() {
    if (!this.director || !this.graph) return false
    if (this.storm) {
      const group = this.stormPack.next(this.random,
        1 + Math.min(this.rounds.toSpawn, MAX_ALIVE - 1 - this.director.aliveCount))
      if (group) return this.spawnInkwings(group)
    }
    this.graph.flow([this.player.body.position])
    const windowSpawn = this.barriers?.pickSpawn(this.random)
    const spot = windowSpawn?.rise ?? pickSpawn(this.graph, this.player.world, {
      near: 14, far: 48, eyes: [this.camera.perspective.getWorldPosition(new THREE.Vector3())],
    }, this.random)
    if (!spot) return false
    const mix = movementMix(this.rounds.round)
    const roll = this.random()
    const gait: ZombieGait = this.storm ? 'sprint' : roll < mix.walk ? 'walk' : roll < mix.walk + mix.run ? 'run' : 'sprint'
    const blot = !this.storm && rollBlot(this.rounds.round, this.random)
    const health = Math.round(zombieHealth(this.rounds.round) * (this.storm ? STORM.health : 1) * (blot ? BLOT.health : 1))
    const zombie = this.director.spawn(spot, health, gait,
      windowSpawn?.barrier.facing ?? this.random() * Math.PI * 2, true, false, blot)
    if (zombie && windowSpawn) this.director.sendToWindow(zombie, windowSpawn.barrier)
    return !!zombie
  }

  private spawnInkwings(group: number) {
    const targets: ZombieTarget[] = [{ id: 'p1', feet: this.player.body.position, alive: this.state.phase === 'active' }]
    const health = inkwingHealth(this.rounds.round, 1)
    const placed = this.director!.flyers.arrive(group, targets, health, this.random, stormNumber(this.rounds.round))
    if (placed < group) {
      this.stormPack.back(group - placed)
      this.rounds.toSpawn += group - placed - (placed ? 0 : 1)
    }
    return placed > 0
  }

  private get bruteHunting() {
    return !!this.brute && this.brute.boss && this.brute.state === 'chase'
  }

  private spawnBrute() {
    if (!this.director || !this.graph || this.bruteHunting) return
    const spot = pickSpawn(this.graph, this.player.world, {
      near: 16, far: 40, eyes: [this.camera.perspective.position],
    }, this.random)
    const feet = this.player.body.position
    const brute = spot && this.director.spawn(spot, BOSS.health(this.rounds.round), 'run',
      Math.atan2(feet.x - spot.x, feet.z - spot.z), true, true)
    if (!brute) { this.bruteTimer = 1; return }
    this.brute = brute
    this.zombieHud.announce('The Brute', 3)
    this.emit({ kind: 'boss-roar', position: brute.position.clone().setY(brute.position.y + 3), radius: 250 })
  }

  private setStorm(on: boolean) {
    this.storm = on
    if (on && !this.hud.reducedMotion) document.body.dataset.deadInkStorm = 'true'
    else delete document.body.dataset.deadInkStorm
  }

  private updateRounds(dt: number) {
    if (!this.director) return
    const events = stepBasicRounds(this.rounds, dt, roundAlive(this.director.zombies))
    this.state.round = this.rounds.round
    if (events.roundStarted) {
      this.setStorm(isStormRound(events.roundStarted))
      if (this.storm) {
        this.rounds.toSpawn = Math.max(0, this.stormPack.begin(events.roundStarted, 1) - events.spawn)
        this.zombieHud.announce(`Round ${events.roundStarted}: Ink Storm`)
        this.emit({ kind: 'storm' })
      } else this.zombieHud.announce(`Round ${events.roundStarted}`)
      if (bruteDue(events.roundStarted, this.bruteHunting)) this.bruteTimer = BOSS.delay
      else if (this.bruteHunting) this.hud.notify('The Brute is still hunting you.', 3.5)
      if (events.roundStarted > 1) this.grenadeCount = Math.min(GRENADE.max, this.grenadeCount + GRENADE.perRound)
    }
    if (this.bruteTimer > 0 && (this.bruteTimer -= dt) <= 0) this.spawnBrute()
    let failed = 0
    for (let i = 0; i < events.spawn; i++) if (!this.spawnZombie()) failed++
    returnBasicSpawns(this.rounds, failed)
    if (events.roundEnded) {
      this.zombieHud.announce(this.storm ? 'The storm passes' : `Round ${events.roundEnded} survived`, 3.5)
      if (this.storm) this.setStorm(false)
    }
    if (this.rounds.phase === 'active' && this.rounds.toSpawn === 0 && roundAlive(this.director.zombies) === 1) {
      const last = this.director.alive.find(zombie => !zombie.boss && !this.director!.flyers.owns(zombie))
      if (last) last.gait = 'sprint'
    }
  }

  private updateRepair(dt: number) {
    this.repairWait = Math.max(0, this.repairWait - dt)
    const barrier = this.repairing
    if (!barrier) return
    const eye = this.camera.perspective.position
    if (!this.player.useHeld || !this.isActive() || barrier.boards >= WINDOW.boards || !barrier.inside(eye) || barrier.point.distanceTo(eye) > 2.65) {
      this.repairing = null
      return
    }
    this.interactionTime = Math.max(this.interactionTime, 0.2)
    if (this.repairWait > 0) return
    this.repairWait = WINDOW.repairSeconds
    const paid = this.barriers!.rebuild(barrier, 'p1', this.rounds.round)
    if (paid > 0) this.award(paid)
  }

  private relocateStranded(dt: number) {
    this.strandTimer -= dt
    if (this.strandTimer > 0 || !this.director || !this.graph) return
    this.strandTimer = 0.5
    for (const zombie of this.director.alive) {
      if (!zombie.stranded || zombie.boss || this.director.flyers.owns(zombie) ||
        this.player.world.visible(this.camera.perspective.position, zombie.position.clone().setY(zombie.position.y + 1.2), zombie.actor.root)) continue
      const spot = pickSpawn(this.graph, this.player.world, {
        near: 12, far: 32, eyes: [this.camera.perspective.position],
      }, this.random)
      if (spot) this.director.relocate(zombie, spot)
    }
  }

  private blockByZombies() {
    const feet = this.player.body.position
    const push = new THREE.Vector3()
    for (const zombie of this.director?.alive ?? []) {
      if (zombie.rise > 0 || zombie.climb || this.director?.flyers.owns(zombie) ||
        Math.abs(zombie.position.y - feet.y) > 1.2) continue
      const dx = feet.x - zombie.position.x, dz = feet.z - zombie.position.z, distance = Math.hypot(dx, dz)
      const reach = 0.3 + 0.34 * (zombie.boss ? BOSS.scale : 1)
      if (distance >= reach) continue
      if (distance < 1e-4) push.x += reach
      else { push.x += dx / distance * (reach - distance); push.z += dz / distance * (reach - distance) }
    }
    if (push.lengthSq() < 1e-8) return
    const target = feet.clone().add(push)
    this.pushCapsule.start.copy(target).y += 0.35
    this.pushCapsule.end.copy(target).y += 1.44
    if (!this.player.world.fits(this.pushCapsule)) return
    feet.copy(target)
    this.camera.perspective.position.x += push.x
    this.camera.perspective.position.z += push.z
  }

  private emit(event: SoundEvent) {
    if (this.death.active && !['player-death', 'player-fall'].includes(event.kind)) return
    this.audio.play(event)
    if (event.text && (!event.position || event.position.distanceTo(this.camera.perspective.position) <= (event.radius ?? 38)))
      this.hud.notify(event.text, 3.5)
  }

  private applySettings() {
    const settings = getSettings()
    this.audio.setVolume(volumeFor(settings, 'effects'))
    this.audio.setMuted(settings.masterVolume <= 0 || settings.effectsVolume <= 0)
    this.blood.setMode(settings.blood)
  }

  update(dt: number, _elapsed = dt) {
    this.finishFrame()
    const active = this.isActive()
    if (active !== this.active) { this.cancelInput(); this.active = active }
    const deathPlaying = this.death.active && this.player.enabled && !this.player.immersive && !this.death.menuVisible && !document.hidden
    this.audio.setActive(active || deathPlaying)
    if (active && this.director) {
      this.state.elapsed += dt
      const landingSpeed = this.player.body.landingSpeed
      this.player.body.landingSpeed = 0
      if (!this.player.actions.traversing) this.damage(fallDamage(landingSpeed))
      const bounds = this.world.bounds
      const body = this.player.body
      if (body.position.y < -12 || body.position.x < bounds.minX || body.position.x > bounds.maxX || body.position.z < bounds.minZ || body.position.z > bounds.maxZ) {
        body.teleport(this.safePosition)
        this.player.actions.syncCamera(this.camera.perspective)
      }
      this.updateRounds(dt)
      const targets: ZombieTarget[] = [{ id: 'p1', feet: body.position, alive: this.state.phase === 'active',
        air: !body.grounded }]
      this.director.update(dt, targets)
      const gasExposure = this.director.gas.exposure(this.camera.perspective.position)
      if (gasExposure > 0) {
        this.gasDamage += GAS.damagePerSecond * gasExposure * dt
        if (this.gasDamage >= 5) {
          const amount = Math.floor(this.gasDamage)
          this.gasDamage -= amount
          this.damage(amount)
        }
      } else this.gasDamage = 0
      document.body.style.setProperty('--dead-ink-gas', gasExposure.toFixed(3))
      this.relocateStranded(dt)
      this.blockByZombies()
      if (this.state.elapsed - this.lastHurt > PLAYER_HEALTH.regenDelay)
        this.state.health = Math.min(PLAYER_HEALTH.base, this.state.health + PLAYER_HEALTH.regenPerSecond * dt)
      this.knifeCooldown = Math.max(0, this.knifeCooldown - dt)
      this.grenadeCooldown = Math.max(0, this.grenadeCooldown - dt)
      if (this.pendingThrow >= 0 && (this.pendingThrow -= dt) <= 0) { this.pendingThrow = -1; this.launchGrenade() }
      for (const burst of this.grenades.update(dt)) this.grenadeBlast(burst)
      this.interactionTime = Math.max(0, this.interactionTime - dt)
      this.updateRepair(dt)
      this.zones?.update(dt)
      this.barriers?.update(dt)
      const boxEvent = this.box?.update(dt)
      if (boxEvent === 'expired') this.hud.notify('The box closed.', 2)
      if (boxEvent === 'landed') this.hud.notify('The box has a weapon.', 2)
      this.safePosition.copy(body.position)
    } else if (deathPlaying && this.director) {
      this.director.update(dt, [{ id: 'p1', feet: this.player.body.position, alive: true }])
    }
    this.blood.update(active || deathPlaying ? dt : 0)
    this.impacts.update(active || deathPlaying ? dt : 0)
    this.explosions.update(active || deathPlaying ? dt : 0)
    return this.render(dt, active, deathPlaying)
  }

  private render(dt: number, active: boolean, deathPlaying: boolean) {
    const yaw = new THREE.Euler().setFromQuaternion(this.camera.perspective.quaternion, 'YXZ').y
    const hitPose = this.playerHits.update(active ? dt : 0, yaw, this.hud.reducedMotion)
    if (active) this.playerHits.applyCamera(this.camera.perspective, this.player.world)
    if (this.death.active && this.player.enabled && !this.player.immersive) {
      if (this.death.update(document.hidden ? 0 : dt, this.camera.perspective, this.player.world)) this.audio.play({ kind: 'player-fall' })
      this.weapons.updateDeath(this.death.elapsed, this.death.reducedMotion, this.death.hitKick, this.death.hitSide)
      this.hud.setDeath(this.death)
    } else {
      if (this.death.active) { this.death.reset(); this.weapons.resetDeath(); this.hud.clearDeath() }
      this.weapons.update(dt, {
        active: active && this.interactionTime === 0, climbing: this.player.actions.traversing,
        moving: this.player.body.velocity.length(), aiming: this.aiming,
        reducedMotion: this.hud.reducedMotion, feet: this.player.body.position, hitPose,
      })
    }
    const running = active || deathPlaying ? dt : 0
    if (running) this.bulletTrails.update(dt)
    this.audio.update(this.camera.perspective)
    this.hud.setScoped(this.weapons.scoped, this.weapons.scopeMagnification)
    this.hits.update(running, this.camera.perspective, window.innerWidth, window.innerHeight)
    this.indicator.update(running, this.camera.perspective.position, yaw)
    this.zombieHud.update(running, this.state.round, this.state.points)
    this.zombieHud.grenades(this.grenadeCount)
    this.hud.update(dt, this.state, {
      playing: this.player.playing, enabled: this.player.enabled && !this.player.immersive,
      weapon: this.weapons.current, reloading: this.weapons.reloading, position: this.player.body.position,
      yaw, deaths: this.deaths, ready: this.ready,
    })
    return active || this.death.running
  }

  finishFrame() {
    this.playerHits.removeCamera()
  }

  dispose() {
    this.disposed = true
    this.abort.abort()
    this.stopSettings()
    delete document.body.dataset.deadInkStorm
    document.body.style.removeProperty('--dead-ink-gas')
    for (const buy of this.wallBuys) buy.dispose()
    this.box?.dispose()
    this.zones?.dispose()
    this.barriers?.dispose()
    this.director?.dispose()
    this.hits.dispose()
    this.indicator.dispose()
    this.zombieHud.dispose()
    this.bulletTrails.dispose()
    this.weapons.dispose()
    this.blood.dispose()
    this.impacts.dispose()
    this.grenades.dispose()
    this.explosions.dispose()
    this.audio.dispose()
    this.hud.dispose()
  }
}
