// Run against a freshly loaded /?mode=zombies page:
//   npx agent-browser eval --stdin < scripts/check-dead-ink.js
// Uses the real menu and interaction selector. Points are staged so the smoke
// check can cover purchases without waiting through several rounds.
(async () => {
  const env = window.__environment
  const game = env.mission
  const player = env.player
  const camera = env.camera.active
  if (!game?.ready) throw new Error('Wait for mission.ready')

  const results = []
  const check = (ok, label, detail = '') => {
    results.push({ passed: !!ok, label, detail })
    if (!ok) throw new Error(`${label}${detail ? `: ${detail}` : ''}`)
  }
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
  const press = code => window.dispatchEvent(new KeyboardEvent('keydown', {
    key: code.replace('Key', '').toLowerCase(), code, bubbles: true, cancelable: true,
  }))
  const standAt = (stand, look) => {
    player.body.teleport(stand.clone())
    player.actions.syncCamera(camera)
    camera.lookAt(look)
    env.invalidate()
  }

  player.fallback = true
  game.invincible = true
  document.querySelector('#walk-start').click()
  check(player.playing, 'basic Zombies starts')
  check(game.state.points === 500 && game.weapons.current?.name === 'pistol',
    'the player starts with a pistol and 500 points')
  check(game.wallBuys.length === 4 && !!game.box,
    'four standard wall guns and one Mystery Box are placed')
  check(game.zones.gates.every(gate => gate.state === 'closed'),
    'all zone gates begin closed')

  const menuText = document.querySelector('.walk-card').textContent
  for (const removed of ['Co-op', 'Armory', 'Career', 'Shop', 'Pack-a-Punch', 'Quest'])
    check(!menuText.includes(removed), `${removed} is absent`)

  const wall = game.wallBuys[0]
  game.state.points = wall.price + 100
  standAt(wall.spot.stand.clone(), wall.point.clone())
  await sleep(250)
  press('KeyF')
  await sleep(250)
  check(game.weapons.slots.some(slot => slot?.name === wall.weapon),
    `F buys the standard ${wall.weapon}`)
  check(game.state.points === 100, 'the wall purchase spends its listed price')

  const box = game.box
  game.state.points = 2000
  standAt(box.spot.stand.clone(), box.point.clone())
  await sleep(250)
  press('KeyF')
  await sleep(250)
  check(box.state === 'spinning' && game.state.points === 1050,
    'F spins the Mystery Box for 950 points')
  await sleep(3400)
  check(box.state === 'offering' && typeof box.offer === 'string',
    'the box offers a standard weapon', String(box.offer))
  const offer = box.offer
  press('KeyF')
  await sleep(250)
  check(game.weapons.current?.name === offer && box.state === 'idle',
    'F takes the offered weapon and closes the box')

  check(game.director.zombies.every(zombie => !('boss' in zombie) && !('blot' in zombie)),
    'the runtime contains only ordinary zombies')
  game.invincible = false
  return { results, round: game.state.round, weapon: game.weapons.current?.name }
})()
