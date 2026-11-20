import { MAX_ALIVE, ROUND_BREAK, spawnDelay, zombiesInRound } from './basic-rules'

export type BasicRoundState = {
  round: number
  phase: 'break' | 'active'
  timer: number
  toSpawn: number
  spawnTimer: number
}

export type BasicRoundEvents = { spawn: number; roundStarted?: number; roundEnded?: number }
export const FIRST_ROUND_DELAY = 5

export const newBasicGame = (): BasicRoundState => ({
  round: 0, phase: 'break', timer: FIRST_ROUND_DELAY, toSpawn: 0, spawnTimer: 0,
})

export function stepBasicRounds(state: BasicRoundState, dt: number, alive: number): BasicRoundEvents {
  const events: BasicRoundEvents = { spawn: 0 }
  if (!(dt > 0)) return events
  if (state.phase === 'break') {
    state.timer -= dt
    if (state.timer > 0) return events
    state.round++
    state.phase = 'active'
    state.toSpawn = zombiesInRound(state.round)
    state.spawnTimer = 0
    events.roundStarted = state.round
  }
  state.spawnTimer -= dt
  while (state.spawnTimer <= 0 && state.toSpawn > 0 && alive + events.spawn < MAX_ALIVE) {
    events.spawn++
    state.toSpawn--
    state.spawnTimer += spawnDelay(state.round)
  }
  if (state.spawnTimer < 0) state.spawnTimer = 0
  if (state.toSpawn === 0 && alive + events.spawn === 0) {
    events.roundEnded = state.round
    state.phase = 'break'
    state.timer = ROUND_BREAK
  }
  return events
}

export function returnBasicSpawns(state: BasicRoundState, count: number) {
  if (count <= 0 || state.phase !== 'active') return
  state.toSpawn += count
  state.spawnTimer = Math.max(state.spawnTimer, 0.5)
}
