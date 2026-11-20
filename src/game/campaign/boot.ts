import { MISSIONS, mapFor, missionById } from './missions'
import type { MapModule } from './types'

/**
 * The map the hostage mission loads with: the one the chosen mission plays on (?mission= on the address, or the
 * first mission). A map with its own build() (a real place, traced from OpenStreetMap) replaces the
 * compound's geometry; the compound map builds nothing here (main.ts builds it as before). Switching to a
 * mission on another map reloads the page onto that map (session.ts).
 */
export function bootMap(search = typeof location === 'undefined' ? '' : location.search): MapModule {
  const asked = missionById(new URLSearchParams(search).get('mission'))
  return mapFor(asked ?? MISSIONS[0])
}
