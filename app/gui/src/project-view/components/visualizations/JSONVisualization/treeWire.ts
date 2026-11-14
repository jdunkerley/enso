/**
 * @file The JSON of `Standard.Visualization.Tree`'s `prepare` and `children`. The format is
 * described in `distribution/lib/Standard/Visualization/0.0.0-dev/CLAUDE.md` and pinned by the
 * `tree_*` goldens in `test/Visualization_Tests/data/pinned/`.
 */
import * as z from 'zod'

const TreeKey = z.union([z.string(), z.number().int()])
/** An object key or an array index. */
export type TreeKey = z.infer<typeof TreeKey>

const LeafNode = z.object({ kind: z.literal('leaf'), value: z.unknown() })
const BranchNode = z.object({
  kind: z.enum(['object', 'array']),
  size: z.number().int().nonnegative(),
  label: z.string(),
})
const TreeNode = z.discriminatedUnion('kind', [LeafNode, BranchNode])
/** A leaf (its JSON value) or a branch (its kind, size and label). */
export type TreeNode = z.infer<typeof TreeNode>

const entryFields = { key: TreeKey, expr: z.string().nullable() }
const TreeEntry = z.discriminatedUnion('kind', [
  LeafNode.extend(entryFields),
  BranchNode.extend(entryFields),
])
/** A child: its key, its node, and the node expression that reaches it from its parent. */
export type TreeEntry = z.infer<typeof TreeEntry>

const TreePage = z.object({
  start: z.number().int().nonnegative(),
  size: z.number().int().nonnegative(),
  entries: z.array(TreeEntry),
})
/** The children of a branch from `start`; `size` is the branch's whole size. */
export type TreePage = z.infer<typeof TreePage>

const Prepared = z.union([
  z.object({ root: BranchNode, children: TreePage }),
  z.object({ root: LeafNode }),
])
/** What `Tree.prepare` sends: the root, and the first page when it is a branch. */
export type Prepared = z.infer<typeof Prepared>

/** A page, or why it could not be loaded. */
export type PageResult = { ok: true; page: TreePage } | { ok: false; message: string }

/** Read the visualization's data, or `undefined` when it is not `Tree.prepare`'s JSON. */
export function parsePrepared(data: unknown): Prepared | undefined {
  const parsed = Prepared.safeParse(data)
  return parsed.success ? parsed.data : undefined
}

/** Read `Tree.children`'s JSON. */
export function parsePageResult(data: unknown): PageResult {
  const page = TreePage.safeParse(data)
  if (page.success) return { ok: true, page: page.data }
  const error = z.object({ error: z.string() }).safeParse(data)
  return {
    ok: false,
    message: error.success ? error.data.error : 'unexpected data',
  }
}
