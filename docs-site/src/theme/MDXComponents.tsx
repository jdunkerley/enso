import ComponentNode from '@site/src/components/ComponentNode'
import MDXComponents from '@theme-original/MDXComponents'

/** Makes `<ComponentNode>` available to every MDX page without an import (the generated pages use it). */
export default { ...MDXComponents, ComponentNode }
