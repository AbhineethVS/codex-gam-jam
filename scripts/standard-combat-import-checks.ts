import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, extname, relative, resolve } from 'node:path'

const sourceRoot = resolve('src')
const entry = resolve(sourceRoot, 'main.ts')
const visited = new Set<string>()

function sourceFile(importer: string, specifier: string) {
  const target = resolve(dirname(importer), specifier)
  if (extname(target)) return existsSync(target) ? target : null
  for (const candidate of [`${target}.ts`, `${target}.tsx`, resolve(target, 'index.ts')])
    if (existsSync(candidate)) return candidate
  return null
}

function visit(file: string) {
  if (visited.has(file)) return
  visited.add(file)
  const source = readFileSync(file, 'utf8')
  const imports = /^\s*import(?!\s+type\b)[\s\S]*?\sfrom\s+['"]([^'"]+)['"]/gm
  for (const match of source.matchAll(imports)) {
    const specifier = match[1]
    if (!specifier.startsWith('.')) continue
    const target = sourceFile(file, specifier)
    if (target?.startsWith(sourceRoot)) visit(target)
  }
}

visit(entry)
const modules = new Set([...visited].map(file => relative(sourceRoot, file).replaceAll('\\', '/')))
const forbidden = [
  'game/weapon-models.ts',
  'game/akimbo.ts',
  'game/loot.ts',
  'game/save-transfer.ts',
  'game/shared/awards.ts',
  'game/shared/coop.ts',
  'game/rescue-coop.ts',
  'game/rescue-coop-rules.ts',
  'game/campaign/progress.ts',
  'game/campaign/rewards.ts',
  'game/zombies/runtime.ts',
  'game/zombies/coop.ts',
  'game/zombies/perks.ts',
  'game/zombies/quest.ts',
  'game/zombies/buildables.ts',
  'game/zombies/traps.ts',
  'game/zombies/powerups.ts',
  'game/zombies/decoy.ts',
  'game/zombies/revive.ts',
  'game/zombies/last-stand.ts',
  'game/zombies/mythic.ts',
  'game/zombies/wonder.ts',
  'game/zombies/ink-cannon.ts',
  'game/zombies/rockets.ts',
  'lab/weapons/models/cannon.ts',
  'lab/weapons/models/launcher.ts',
  'lab/weapons/models/wonder.ts',
  'lab/weapons/models/dead-ink-guns.ts',
  'lab/weapons/models/special-automatics.ts',
]
for (const module of forbidden) assert(!modules.has(module), `production entry graph must not import ${module}`)
assert(![...modules].some(module => module.startsWith('game/zombies/cosmetics/')),
  'production entry graph must not import Zombies cosmetics')
assert(![...modules].some(module => module.startsWith('vr/')),
  'production entry graph must not import VR')

for (const module of ['game/runtime.ts', 'game/weapons.ts', 'game/actors.ts', 'game/standard-weapon-models.ts',
  'game/standard-weapon-rules.ts', 'game/zombies/basic-runtime.ts', 'game/zombies/basic-stations.ts',
  'game/zombies/director.ts', 'game/zombies/brute.ts', 'game/zombies/flyers.ts', 'game/zombies/gas.ts'])
  assert(modules.has(module), `production entry graph should include ${module}`)

const weapons = readFileSync(resolve(sourceRoot, 'game/weapons.ts'), 'utf8')
assert(!weapons.includes('createRarityBeam'), 'standard first-person weapons must not create rarity beams')

console.log(`standard combat import checks passed: ${modules.size} production modules, no removed weapon systems`)
