import * as THREE from 'three'
import { box, dark, gun, metal, part, tube, type Gun, type V } from './common'

function profile(shape: THREE.Shape, width: number, pos: V, material = metal) {
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: width, bevelEnabled: false, steps: 1, curveSegments: 12,
  })
  geometry.translate(0, 0, -width / 2)
  geometry.rotateY(-Math.PI / 2)
  return part(geometry, material, pos)
}

function triggerGuard(rear: number, front: number, top: number, bottom: number) {
  const shape = new THREE.Shape()
  shape.moveTo(rear, top)
  shape.lineTo(front, top)
  shape.lineTo(front, bottom + 0.013)
  shape.quadraticCurveTo(front, bottom, front - 0.013, bottom)
  shape.lineTo(rear, bottom)
  shape.closePath()
  const hole = new THREE.Path()
  hole.moveTo(rear + 0.007, top - 0.006)
  hole.lineTo(rear + 0.007, bottom + 0.007)
  hole.lineTo(front - 0.015, bottom + 0.007)
  hole.quadraticCurveTo(front - 0.007, bottom + 0.007, front - 0.007, bottom + 0.016)
  hole.lineTo(front - 0.007, top - 0.006)
  hole.closePath()
  shape.holes.push(hole)
  return profile(shape, 0.012, [0, 0, 0], dark)
}

/**
 * Legacy Dead Ink Death Machine. It lives outside the standard automatic models so rescue and basic
 * Zombies do not pull this special weapon into their production graph.
 */
export function buildDeathMachine(): Gun {
  const result = gun('ak', 'ak', true, [0, 0.077, 0.68], [0.045, 0.09, 0.1], (g, parts) => {
    g.add(box(0.064, 0.078, 0.23, [0, 0.07, 0.09]))
    g.add(box(0.066, 0.01, 0.17, [0, 0.114, 0.09], dark))
    g.add(tube(0.036, 0.04, [0, 0.077, 0.225], dark))
    g.add(box(0.034, 0.12, 0.05, [0, 0, 0], dark, [-10, 0, 0]))
    g.add(triggerGuard(0.02, 0.085, 0.024, -0.024))
    g.add(box(0.056, 0.07, 0.1, [-0.07, 0.02, 0.085]))
    g.add(box(0.052, 0.01, 0.096, [-0.07, 0.058, 0.085], dark))
    g.add(box(0.034, 0.022, 0.05, [-0.042, 0.066, 0.085], dark, [0, 0, -30]))
    g.add(box(0.03, 0.085, 0.034, [0, -0.02, 0.27], dark))
    const barrels = new THREE.Group()
    barrels.position.set(0, 0.077, 0.25)
    for (let index = 0; index < 6; index++) {
      const angle = index * Math.PI / 3
      barrels.add(tube(0.0095, 0.42, [Math.cos(angle) * 0.03, Math.sin(angle) * 0.03, 0.21], index % 2 ? metal : dark))
    }
    barrels.add(tube(0.012, 0.43, [0, 0, 0.21], dark))
    for (const z of [0.04, 0.24, 0.41]) barrels.add(tube(0.044, 0.016, [0, 0, z]))
    parts.barrels = barrels
    g.add(barrels)
  }, 'death-machine')
  result.userData.support = new THREE.Vector3(0, -0.005, 0.27)
  return result
}
