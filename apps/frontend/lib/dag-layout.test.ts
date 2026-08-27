import { describe, expect, it } from 'vitest'
import { DAG_NODE_W, DAG_GAP_X, layeredLayout } from './dag-layout'

const PIT_STOP_DAG = [
  { id: 'session', depends_on: [] },
  { id: 'driver', depends_on: [] },
  { id: 'pits', depends_on: ['session', 'driver'] },
  { id: 'artifacts', depends_on: ['pits'] },
  { id: 'window', depends_on: ['pits'] },
  { id: 'verify', depends_on: ['artifacts', 'window'] },
]

describe('layeredLayout', () => {
  it('places independent roots in the same column', () => {
    const pos = layeredLayout(PIT_STOP_DAG)
    expect(pos.session.x).toBe(pos.driver.x)
    expect(pos.session.y).not.toBe(pos.driver.y)
  })

  it('pushes dependents one full column to the right', () => {
    const pos = layeredLayout(PIT_STOP_DAG)
    const column = DAG_NODE_W + DAG_GAP_X
    expect(pos.pits.x).toBe(pos.session.x + column)
    expect(pos.verify.x).toBe(pos.pits.x + 2 * column)
  })

  it('never loops forever on a cyclic graph', () => {
    const pos = layeredLayout([
      { id: 'a', depends_on: ['b'] },
      { id: 'b', depends_on: ['a'] },
    ])
    expect(pos).toHaveProperty('a')
    expect(pos).toHaveProperty('b')
    expect(pos.a.x).toBeTypeOf('number')
    expect(pos.b.y).toBeTypeOf('number')
  })

  it('returns an empty map for an empty graph', () => {
    expect(layeredLayout([])).toEqual({})
  })
})