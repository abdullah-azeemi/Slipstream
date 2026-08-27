import { describe, expect, it } from 'vitest'
import { buildNodeInspectorView } from './node-inspector'

const SESSION_NODE = {
  id: 'session',
  tool_name: 'resolve_session',
  label: 'resolve session 2026 Monaco',
  description: 'Resolve the race session key for the given GP.',
  depends_on: [],
  input_params: { round: 7 },
}

describe('buildNodeInspectorView', () => {
  it('mirrors identity fields from the DAG node and run info', () => {
    const view = buildNodeInspectorView(
      SESSION_NODE,
      { state: 'done', duration_ms: 42.5, summary: 'session resolved' },
      null
    )
    expect(view.nodeId).toBe('session')
    expect(view.toolName).toBe('resolve_session')
    expect(view.label).toBe('resolve session 2026 Monaco')
    expect(view.description).toBe('Resolve the race session key for the given GP.')
    expect(view.state).toBe('done')
    expect(view.durationMs).toBe(42.5)
    expect(view.summary).toBe('session resolved')
    expect(view.inputParams).toEqual({ round: 7 })
  })

  it('falls back to the trace call when live run info is missing', () => {
    const view = buildNodeInspectorView(SESSION_NODE, null, {
      tool_name: 'resolve_session',
      status: 'ok',
      input_summary: "{'round': 7}",
      output_summary: 'session key 951',
      duration_ms: 40,
      node_id: 'session',
    })
    expect(view.state).toBe('idle')
    expect(view.durationMs).toBe(40)
    expect(view.summary).toBe('session key 951')
    expect(view.call?.node_id).toBe('session')
  })

  it('returns safe defaults when the node is missing', () => {
    const view = buildNodeInspectorView(null, { state: 'error', error: 'boom' }, null)
    expect(view.nodeId).toBe('')
    expect(view.toolName).toBe('')
    expect(view.dependsOn).toEqual([])
    expect(view.inputParams).toEqual({})
    expect(view.state).toBe('idle')
    expect(view.call).toBeNull()
  })
})