import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, extname, join, normalize, relative, resolve } from 'node:path'
import { WEAPON_RULES } from '../src/game/balance'
import {
  BASIC_BOX_WEIGHTS, BASIC_RESERVE_MAGAZINES, BASIC_WALL_WEAPONS, BASIC_ZOMBIE_SLOTS,
  basicStartingPistol, basicWallOffer, freshBasicWeapon, pointsForBasicHit, rollBasicBox,
} from '../src/game/zombies/basic-economy'
import { FIRST_ROUND_DELAY, newBasicGame, returnBasicSpawns, stepBasicRounds } from '../src/game/zombies/basic-rounds'
import { MAX_ALIVE, ROUND_BREAK, zombiesInRound } from '../src/game/zombies/basic-rules'
import { seeded } from '../src/game/shared/random'

function playRound(killRate = 3, fps = 60) {
  const state = newBasicGame()
  let alive = 0, spawned = 0, peak = 0, killClock = 0
  const events: string[] = []
  for (let frame = 0; frame < fps * 600; frame++) {
    const event = stepBasicRounds(state, 1 / fps, alive)
    if (event.roundStarted) events.push(`start ${event.roundStarted}`)
    alive += event.spawn
    spawned += event.spawn
    peak = Math.max(peak, alive)
    killClock += 1 / fps
    while (killClock >= 1 / killRate && alive > 0) { alive--; killClock -= 1 / killRate }
    if (event.roundEnded) { events.push(`end ${event.roundEnded}`); break }
  }
  return { state, alive, spawned, peak, events }
}

{
  const result = playRound()
  assert.deepEqual(result.events, ['start 1', 'end 1'])
  assert.equal(result.spawned, zombiesInRound(1))
  assert.equal(result.state.phase, 'break')
  assert.equal(result.state.timer, ROUND_BREAK)
  assert(result.peak <= MAX_ALIVE)
}

{
  const state = newBasicGame()
  Object.assign(state, { round: 1, phase: 'active', timer: 0, toSpawn: 1, spawnTimer: 0 })
  const failed = stepBasicRounds(state, 1 / 60, 0).spawn
  assert.equal(failed, 1)
  returnBasicSpawns(state, failed)
  assert.equal(state.toSpawn, 1, 'a failed placement returns to the round')
  assert.equal(stepBasicRounds(state, 2.1, 0).spawn, 1, 'the returned spawn is tried again')
  assert.equal(FIRST_ROUND_DELAY, 5)
}

assert.equal(pointsForBasicHit({ lethal: false, zone: 'head' }), 10)
assert.equal(pointsForBasicHit({ lethal: true, zone: 'torso' }), 60)
assert.equal(pointsForBasicHit({ lethal: true, zone: 'head' }), 100)
assert.equal(pointsForBasicHit({ lethal: true, knife: true }), 130)
assert.equal(pointsForBasicHit({ lethal: true, explosive: true }), 50)
assert.equal(BASIC_ZOMBIE_SLOTS, 2)

{
  const start = basicStartingPistol()
  assert.deepEqual([start.name, start.magazine, start.reserve], ['pistol', 12, 48])
  const wall = BASIC_WALL_WEAPONS.find(entry => entry.name === 'ak')!
  assert.equal(basicWallOffer('ak', wall.price, [start, null]).kind, 'buy')
  const ak = freshBasicWeapon('ak', 'ak')
  assert.equal(ak.reserve, WEAPON_RULES.ak.capacity * BASIC_RESERVE_MAGAZINES)
  assert.equal(basicWallOffer('ak', wall.price, [start, { ...ak, magazine: 1, reserve: 2 }]).kind, 'ammo')
  assert.equal(basicWallOffer('ak', wall.price, [start, ak]).kind, 'full')
}

{
  const random = seeded(90210)
  const held = [basicStartingPistol(), freshBasicWeapon('ak', 'ak')]
  const names = new Set<string>()
  for (let i = 0; i < 5000; i++) names.add(rollBasicBox(random, held))
  assert(!names.has('pistol') && !names.has('ak'), 'the box excludes held guns')
  assert([...names].every(name => name in BASIC_BOX_WEIGHTS), 'the box contains only standard guns')
  assert(!Object.keys(BASIC_BOX_WEIGHTS).some(name => ['rocket', 'cannon'].includes(name)))
}

// The solo branch keeps the original zombie, boss and special-enemy actors while
// staying isolated from networking, progression, perks and special weapons.
{
  const root = resolve('src/game/zombies')
  const entry = resolve(root, 'basic-runtime.ts')
  const visited = new Set<string>()
  const imports = new Set<string>()
  const visit = (file: string) => {
    file = normalize(file)
    if (visited.has(file)) return
    visited.add(file)
    const source = readFileSync(file, 'utf8')
    const pattern = /^\s*import(?!\s+type\b)[\s\S]*?\sfrom\s+['"]([^'"]+)['"]/gm
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1]
      if (!specifier.startsWith('.')) continue
      let target = resolve(dirname(file), specifier)
      if (!extname(target)) target += '.ts'
      if (!target.startsWith(root)) continue
      imports.add(relative(root, target).replaceAll('\\', '/'))
      visit(target)
    }
  }
  visit(entry)
  const forbidden = [
    'runtime.ts', 'coop.ts', 'perks.ts', 'quest.ts', 'buildables.ts', 'traps.ts',
    'wonder.ts', 'mythic.ts', 'ink-cannon.ts', 'rockets.ts',
    'powerups.ts', 'decoy.ts', 'revive.ts', 'last-stand.ts', 'summary.ts', 'minimap.ts',
    'cosmetics/index.ts',
  ]
  for (const file of forbidden) assert(!imports.has(file), `production basic runtime must not import ${file}`)
  for (const file of ['director.ts', 'brute.ts', 'flyers.ts', 'gas.ts'])
    assert(imports.has(file), `production basic runtime should restore ${file}`)
  const main = readFileSync(join('src', 'main.ts'), 'utf8')
  assert(main.includes("./game/zombies/basic-runtime"))
  assert(!main.includes("./game/zombies/runtime"))
}

console.log('basic zombies checks passed: solo rounds, standard guns, restored zombie gait, boss and special enemies')
