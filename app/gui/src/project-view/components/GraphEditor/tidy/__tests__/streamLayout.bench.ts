import { Vec2 } from '@/util/data/vec2'
import { bench, describe } from 'vitest'
import { streamLayout, type LayoutComponent } from '../streamLayout'

const SPACING = { horizontal: 40, vertical: 40 }
const SIZE = new Vec2(100, 32)

function comp(id: string, x: number, y: number, inputs: string[]): LayoutComponent<string> {
  return { id, position: new Vec2(x, y), size: SIZE, inputs, selfSource: inputs[0], order: 0 }
}

/** A small, fast seeded PRNG (mulberry32), for a reproducible benchmark fixture. */
function mulberry32(seed: number): () => number {
  let state = seed
  return () => {
    state |= 0
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * A random DAG shaped like a typical dataflow graph: each node but the first takes a *recent*
 * node as its self input (code mostly builds on what was just defined, not on something far
 * back), plus, with some chance, one more recent node as an extra input — a mix of chains, splits
 * and merges, without the one-giant-subtree skew a uniformly-random parent choice would give.
 */
function randomDag(
  rand: () => number,
  n: number,
  extraEdgeChance: number,
  window = 12,
): LayoutComponent<string>[] {
  const recent = (i: number) => i - 1 - Math.floor(rand() * Math.min(i, window))
  const nodes: LayoutComponent<string>[] = [comp('n0', rand() * 4000, 0, [])]
  for (let i = 1; i < n; i++) {
    const self = recent(i)
    const inputs = [`n${self}`]
    if (i > 1 && rand() < extraEdgeChance) {
      const extra = recent(i)
      if (extra !== self) inputs.push(`n${extra}`)
    }
    nodes.push(comp(`n${i}`, rand() * 4000, i * 90, inputs))
  }
  return nodes.map((c, order) => ({ ...c, order }))
}

describe('streamLayout performance', () => {
  let input: LayoutComponent<string>[] = []

  bench(
    'streamLayout on a random DAG (300 components, ~400 edges)',
    () => {
      streamLayout(input, SPACING)
    },
    {
      setup: () => {
        input = randomDag(mulberry32(42), 300, 0.35)
      },
      warmupIterations: 5,
      iterations: 20,
    },
  )
})

/**
 * A random LCG, matching the exact one used to probe this module in review: each node picks its
 * self (and, with probability `p2`, one more) input uniformly from *every* earlier node, not a
 * recent window. That gives a shallow, wide tree — unlike `randomDag` above, not representative of
 * a real dataflow graph, but a harder case for the crossing pass: with parents spread uniformly
 * over the whole node range, one swap's two subtrees can between them touch most of the graph's
 * edges, and its rows end up far less spread out, so many more edge pairs share a row than in a
 * graph with real locality.
 */
function uniformParentDag(seed: number, n: number, p2: number): LayoutComponent<string>[] {
  let state = seed
  const rand = () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648
  const nodes: LayoutComponent<string>[] = []
  for (let i = 0; i < n; i++) {
    const inputs: string[] = []
    if (i > 0 && rand() < 0.85) inputs.push(`c${Math.floor(rand() * i)}`)
    if (i > 0 && rand() < p2) inputs.push(`c${Math.floor(rand() * i)}`)
    nodes.push({
      id: `c${i}`,
      position: new Vec2(rand() * 5000, rand() * 5000),
      size: new Vec2(80 + rand() * 200, 32),
      inputs,
      selfSource: inputs[0],
      order: i,
    })
  }
  return nodes
}

describe('streamLayout performance (uniform-parent, adversarial)', () => {
  let input: LayoutComponent<string>[] = []

  for (const seed of [1, 2, 3, 4, 5]) {
    bench(
      `streamLayout on a uniform-parent DAG, seed ${seed} (300 components, ~400 edges)`,
      () => {
        streamLayout(input, SPACING)
      },
      {
        setup: () => {
          input = uniformParentDag(seed, 300, 0.5)
        },
        warmupIterations: 5,
        iterations: 10,
      },
    )
  }
})
