export interface DagLayoutNodeSpec {
  id: string
  depends_on: string[]
}

export interface DagLayoutPosition {
  x: number
  y: number
}

export const DAG_NODE_W = 240
export const DAG_NODE_H = 88
export const DAG_GAP_X = 60
export const DAG_GAP_Y = 28
export const DAG_PAD = 16

export function layeredLayout(
  nodes: DagLayoutNodeSpec[],
  scale = 1
): Record<string, DagLayoutPosition> {
  if (nodes.length === 0) return {}

  const byId = new Map(nodes.map((n) => [n.id, n]))
  const depth = new Map<string, number>()
  const visiting = new Set<string>()

  function computeDepth(id: string): number {
    if (depth.has(id)) return depth.get(id)!
    if (visiting.has(id)) return 0 // cycle guard — never infinite loop
    visiting.add(id)
    const node = byId.get(id)
    let d = 0
    if (node) {
      for (const dep of node.depends_on) {
        d = Math.max(d, computeDepth(dep) + 1)
      }
    }
    visiting.delete(id)
    depth.set(id, d)
    return d
  }

  for (const node of nodes) computeDepth(node.id)

  // Group ids by depth → that's the "column" (layer). Longest-path depth
  // guarantees a dependent always sits strictly to the right of its deps.
  const byLayer = new Map<number, string[]>()
  for (const node of nodes) {
    const layer = depth.get(node.id) ?? 0
    const col = byLayer.get(layer) ?? []
    col.push(node.id)
    byLayer.set(layer, col)
  }

  const result: Record<string, DagLayoutPosition> = {}
  const strideY = DAG_NODE_H + DAG_GAP_Y
  for (const [layer, ids] of byLayer.entries()) {
    const columnCenterY = ((ids.length - 1) * strideY) / 2
    ids.forEach((id, index) => {
      result[id] = {
        x: (DAG_PAD + layer * (DAG_NODE_W + DAG_GAP_X)) * scale,
        y: (DAG_PAD + columnCenterY - index * strideY) * scale,
      }
    })
  }
  return result
}

// Returns { [nodeId]: rank } where rank is 0-based topo layer index. Used to
// stagger ghost node entrance (each layer appears 60ms after the previous one).
export function topoRankMap(nodes: Array<{ id: string; depends_on?: string[] }>): Record<string, number> {
  const deps: Record<string, string[]> = {}
  nodes.forEach((n) => {
    deps[n.id] = [...(n.depends_on ?? [])]
  })
  const rank: Record<string, number> = {}
  const visited = new Set<string>()

  function dfs(id: string): number {
    if (visited.has(id)) return rank[id] ?? 0
    visited.add(id)
    const depRanks = (deps[id] ?? []).map(dfs)
    rank[id] = depRanks.length ? Math.max(...depRanks) + 1 : 0
    return rank[id]
  }

  nodes.forEach((n) => dfs(n.id))
  return rank
}