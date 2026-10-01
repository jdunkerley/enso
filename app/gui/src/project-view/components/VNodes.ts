import type { VNode } from 'vue'

/**
 * A functional component that renders vnodes passed through props as-is.
 *
 * A plain module rather than an SFC: vue-tsc 3 adds its own default export to every `.vue` file,
 * which collides with an `export default function` in a non-setup `<script>`.
 */
export default function VNodes(props: { vnodes: VNode[] }) {
  return props.vnodes
}
