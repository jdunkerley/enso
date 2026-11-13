/** @file The layout rule for nodes making room: which nodes move, and where, when a node changes size. */

/** The largest gap kept between a pusher and the node it pushes. */
export const MAX_GAP = 32
/** Positions closer than this are the same position: the project file rounds them. */
export const POSITION_TOLERANCE = 1
const EPS = 1e-6

export interface Point {
  x: number
  y: number
}
export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}
export type PushDirection = 'down' | 'right'
export interface Pusher {
  id: string
  gap: number
  dir: PushDirection
}
export interface Displaced {
  home: Point
  at: Point
  by: Pusher[]
  /** Nodes this one overlapped at home. They do not count as taking its home. */
  under?: string[]
}
export interface LayoutNode {
  id: string
  /** Top-left corner, after the change being laid out. */
  pos: Point
  /** Full size, open visualization included, after the change. */
  size: Point
  displaced?: Displaced | undefined
  /** Never moved (input nodes). */
  fixed?: boolean | undefined
}
export interface Change {
  id: string
  /** The node's rectangle before the change. */
  old: Box
  /** Whether nodes newly reached are pushed. False for a node moved by hand. */
  adds: boolean
}
export interface Placement {
  pos: Point
  displaced: Displaced | undefined
}

/** The rectangle of a node at `pos` with `size`. */
export function boxAt(pos: Point, size: Point): Box {
  return {
    left: pos.x,
    top: pos.y,
    right: pos.x + size.x,
    bottom: pos.y + size.y,
  }
}

function near(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) <= POSITION_TOLERANCE && Math.abs(a.y - b.y) <= POSITION_TOLERANCE
}
function overlapsX(a: Box, b: Box): boolean {
  return a.left < b.right - EPS && b.left < a.right - EPS
}
function overlapsY(a: Box, b: Box): boolean {
  return a.top < b.bottom - EPS && b.top < a.bottom - EPS
}
function overlaps(a: Box, b: Box): boolean {
  return overlapsX(a, b) && overlapsY(a, b)
}

/**
 * The push a node gets when a pusher grows to `now`, if it is reached. Which side the node is on,
 * and the gap it keeps, are judged where both nodes were before anything was pushed (`old` and
 * `node` are home rectangles): judged on current positions, two nodes pushed in one pass could each
 * find the other in its way.
 */
function firstContact(
  old: Box,
  now: Box,
  nowAtHome: Box,
  node: Box,
): Omit<Pusher, 'id'> | undefined {
  const below = node.top - old.bottom
  if (below >= -EPS) {
    const gap = Math.min(MAX_GAP, Math.max(0, below))
    return overlapsX(nowAtHome, node) && node.top < now.bottom + gap - EPS ?
        { gap, dir: 'down' }
      : undefined
  }
  const rightOf = node.left - old.right
  if (rightOf >= -EPS) {
    const gap = Math.min(MAX_GAP, Math.max(0, rightOf))
    return overlapsY(nowAtHome, node) && node.left < now.right + gap - EPS ?
        { gap, dir: 'right' }
      : undefined
  }
  return undefined
}

interface State {
  id: string
  pos: Point
  size: Point
  displaced: Displaced | undefined
  fixed: boolean
  /** Has a position and a measured size. */
  placed: boolean
}

/**
 * Lay out the nodes after `changes`. `nodes` is every node of the graph as it is after the change
 * (a removed node is absent); each change names a node whose rectangle changed and gives the
 * rectangle it had. Returns the nodes whose position or `displaced` field must be written.
 */
export function relayout(
  nodes: readonly LayoutNode[],
  changes: readonly Change[],
  stats?: { capped: boolean },
): Map<string, Placement> {
  const state = new Map<string, State>()
  for (const n of nodes) {
    const placed =
      Number.isFinite(n.pos.x) && Number.isFinite(n.pos.y) && n.size.x > 0 && n.size.y > 0
    state.set(n.id, {
      id: n.id,
      pos: { ...n.pos },
      size: n.size,
      displaced: n.displaced,
      fixed: n.fixed ?? false,
      placed,
    })
  }
  const removed = new Set(changes.filter((c) => !state.has(c.id)).map((c) => c.id))
  const box = (id: string): Box | undefined => {
    const s = state.get(id)
    return s?.placed ? boxAt(s.pos, s.size) : undefined
  }
  const homeBox = (s: State): Box => boxAt(s.displaced?.home ?? s.pos, s.size)

  /** Nodes that moved back towards home, with the direction to step aside in. */
  const returned = new Map<string, PushDirection>()

  /**
   * Set the node's position from its field. Returns whether it moved. A pusher with no measured
   * size is unknown, not absent: while any is, the node and its field stay as they are.
   */
  function recompute(s: State): boolean {
    const d = s.displaced
    if (!d) return false
    if (d.by.some((e) => !box(e.id))) return false
    let dx = 0
    let dy = 0
    const kept: Pusher[] = []
    // How far a pusher reaches is read from where it is now. Whether it is in line with this node
    // is read from where both were at home, so two nodes pushed together stay in line.
    const home = boxAt(d.home, s.size)
    const pusherAtHome = (id: string) => homeBox(state.get(id)!)
    for (const e of d.by) {
      if (e.dir !== 'right') continue
      const pusher = box(e.id)!
      const need = pusher.right + e.gap - home.left
      if (need > EPS && overlapsY(pusherAtHome(e.id), home)) {
        dx = Math.max(dx, need)
        kept.push(e)
      }
    }
    for (const e of d.by) {
      if (e.dir !== 'down') continue
      const pusher = box(e.id)!
      const need = pusher.bottom + e.gap - home.top
      if (need > EPS && overlapsX(pusherAtHome(e.id), home)) {
        dy = Math.max(dy, need)
        kept.push(e)
      }
    }
    const pos = { x: d.home.x + dx, y: d.home.y + dy }
    const moved = pos.x !== s.pos.x || pos.y !== s.pos.y
    // The direction it steps aside in, if its home is taken, is that of the push it is returning
    // from: the axis whose offset shrank (down when both did).
    if (pos.y < s.pos.y - EPS) returned.set(s.id, 'down')
    else if (pos.x < s.pos.x - EPS) returned.set(s.id, 'right')
    s.pos = pos
    s.displaced = kept.length > 0 ? { ...d, at: pos, by: kept } : undefined
    if (!s.displaced) homes.set(s.id, d)
    return moved
  }
  /** The field a node had before it went home in this pass. */
  const homes = new Map<string, Displaced>()

  const queue: Change[] = changes.filter((c) => state.has(c.id))

  // Check the saved fields. All of them first: a recompute below reads other nodes' homes.
  for (const s of state.values()) {
    if (s.displaced && !near(s.displaced.at, s.pos)) {
      // Moved by something else: it stays where it was put.
      s.displaced = undefined
    }
  }
  for (const s of state.values()) {
    const d = s.displaced
    if (!d) continue
    const live = d.by.filter((e) => state.has(e.id))
    if (live.length === d.by.length) continue
    const pusherRemoved = d.by.some((e) => removed.has(e.id))
    if (live.length === 0 && !pusherRemoved) {
      // Its pushers vanished without a removal by the user: it stays where it is.
      s.displaced = undefined
      continue
    }
    s.displaced = { ...d, by: live }
    if (pusherRemoved) {
      const old = boxAt(s.pos, s.size)
      if (recompute(s)) queue.push({ id: s.id, old, adds: false })
    }
  }

  const cap = (state.size + 1) * (state.size + 1) * 4
  let steps = 0
  while (queue.length > 0) {
    if (steps++ >= cap) {
      if (stats) stats.capped = true
      break
    }
    const item = queue.shift()!
    const now = box(item.id)
    if (!now) continue
    const grew = now.bottom > item.old.bottom + EPS || now.right > item.old.right + EPS
    const pusherHome = state.get(item.id)!.displaced?.home ?? {
      x: item.old.left,
      y: item.old.top,
    }
    const oldAtHome = boxAt(pusherHome, {
      x: item.old.right - item.old.left,
      y: item.old.bottom - item.old.top,
    })
    for (const s of state.values()) {
      if (s.id === item.id || s.fixed || !s.placed) continue
      const before = boxAt(s.pos, s.size)
      let moved = false
      if (s.displaced?.by.some((e) => e.id === item.id)) {
        moved = recompute(s)
      } else if (item.adds && grew) {
        const atHome = homeBox(s)
        const contact = firstContact(oldAtHome, now, homeBox(state.get(item.id)!), atHome)
        if (contact) {
          if (!s.displaced) {
            // A node counts as under this one if it overlaps this one's home at its own home or
            // where it is now (pushed onto it): either way it is no stranger when this one returns.
            const under = [...state.values()]
              .filter(
                (o) =>
                  o.id !== s.id &&
                  o.id !== item.id &&
                  o.placed &&
                  (overlaps(homeBox(o), atHome) || overlaps(boxAt(o.pos, o.size), atHome)),
              )
              .map((o) => o.id)
            s.displaced = {
              home: { ...s.pos },
              at: { ...s.pos },
              by: [],
              ...(under.length > 0 ? { under } : {}),
            }
          }
          s.displaced = {
            ...s.displaced,
            by: [...s.displaced.by, { id: item.id, ...contact }],
          }
          moved = recompute(s)
        }
      }
      if (moved) queue.push({ id: s.id, old: before, adds: item.adds })
    }
  }

  // Home taken: a node that came back onto a node that was not there before steps clear of it and
  // forgets its home.
  for (const [id, dir] of returned) {
    const s = state.get(id)!
    const field = s.displaced ?? homes.get(id)
    const allowed = new Set([...(field?.under ?? []), ...(field?.by.map((e) => e.id) ?? [])])
    for (let guard = 0; guard <= state.size; guard++) {
      const mine = boxAt(s.pos, s.size)
      const blocker = [...state.values()].find(
        (o) =>
          o.id !== id && o.placed && !allowed.has(o.id) && overlaps(mine, boxAt(o.pos, o.size)),
      )
      if (!blocker) break
      const theirs = boxAt(blocker.pos, blocker.size)
      s.pos =
        dir === 'down' ?
          { x: s.pos.x, y: theirs.bottom + MAX_GAP }
        : { x: theirs.right + MAX_GAP, y: s.pos.y }
      s.displaced = undefined
    }
  }

  const result = new Map<string, Placement>()
  for (const n of nodes) {
    const s = state.get(n.id)!
    const samePos = s.pos.x === n.pos.x && s.pos.y === n.pos.y
    const sameField = JSON.stringify(s.displaced ?? null) === JSON.stringify(n.displaced ?? null)
    if (!samePos || !sameField) result.set(n.id, { pos: s.pos, displaced: s.displaced })
  }
  return result
}
