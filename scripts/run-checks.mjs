import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const files = readdirSync('scripts')
  .filter(file => file.endsWith('-checks.ts'))
  .sort()

let failed = false
for (const file of files) {
  const path = `scripts/${file}`
  const result = spawnSync(process.execPath, ['scripts/check-player.mjs', path], {
    stdio: 'ignore',
  })
  if (result.status === 0) console.log(`ok   ${path}`)
  else {
    console.log(`FAIL ${path}`)
    failed = true
  }
}

process.exitCode = failed ? 1 : 0
