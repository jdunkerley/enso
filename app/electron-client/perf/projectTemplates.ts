/**
 * @file The projects the open-time harness can open besides the new-project template
 * (`--template`): each replaces the new project's `Main.enso` and adds its data files. See Note
 * [A Project That Uses A Library With Java Code].
 */
import { randomUUID } from 'node:crypto'
import zlib from 'node:zlib'

/* Note [A Project That Uses A Library With Java Code]
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * The native image has the Java of `Standard.Base`, `Table`, `Database` and `DuckDB` compiled in
 * (`EnsoLibraryFeature` marks them AOT-ready); any other library's Java is not available under
 * native, and using it is an error that says to run on the JVM (Note [A Library's Java Must Be In
 * The Native Image] in `EnsoPolyglotJava`). On the JVM every library's Java is hosted. The `image`
 * template opens a project whose first node calls `Standard.Image` (OpenCV through Java, so the
 * JVM only) on a PNG in the project's `data/`, and whose second node shows the result in a table,
 * the analogue of the welcome table; it needs no credentials and no service. The headline is that
 * table showing `headline`.
 */

/** A project the harness writes over a new one. */
export interface ProjectTemplate {
  /** `src/Main.enso`, for a project of the given name. */
  readonly main: string
  /** Other files, by path relative to the project's root. */
  readonly files: Readonly<Record<string, Uint8Array>>
  /** Text the headline's table visualisation shows when the open is done. */
  readonly headline: string
  /** Whether the extras (component browser, the `format` dropdown of `Data.read`) apply. */
  readonly extras: boolean
}

/** The names `--template` accepts: `welcome` is the new project as the launcher creates it. */
export const TEMPLATE_NAMES = ['welcome', 'image'] as const
export type TemplateName = (typeof TEMPLATE_NAMES)[number]

/** The template named `name`; throws on an unknown one. */
export function parseTemplateName(name: string): TemplateName {
  const found = TEMPLATE_NAMES.find((n) => n === name.trim())
  if (found == null) throw new Error(`Unknown template: ${name}`)
  return found
}

/** A 16 x 16 RGB PNG, so the image project needs no download. */
const SAMPLE_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAABlklEQVR42hXRURVEIQhFUSMYgQhGMAIRiGCEE8EIRiACEYhABCLMG7/ZrMt1jMEcyGAN9kAHNjgDBnfwBj6IQQ5q0IMxJnMikzXZE53Y5EyY3Mmb+CQmOalJzw8IUxBhCVtQwYQjIFzhCS6EkEIJLR9YzIUs1mIvdGGLs2BxF2/hi1jkoha9PrCZG9mszd7oxjZnw+Zu3sY3sclNbXp/QJmKKEvZiiqmHAXlKk9xJZRUSmn9gDENMZaxDTXMOAbGNZ7hRhhplNH2gcM8yGEd9kEPdjgHDvfwDn6IQx7q0OcD/wK/Sr4jv9hfkG/1N/x/Fx44BCQU9Pc94zIvclmXfdGLXc79j9/Lu/glLnmpS98PPOZDHuuxH/qwx3n/5ffxHv6IRz7q0e8DznTEWc521DHn+D/KdZ7jTjjplNP+gWAGEqxgBxpYcOIf/AYv8CCCDCro+EAyE0lWshNNLDn5P/MmL/Ekkkwq6fxAMQspVrELLaw49S/lFq/wIoosquj6QDMbaVazG22sOf2v8Dav8SaabKrp5geIAnAQC3NfwAAAAABJRU5ErkJggg=='

const IMAGE_CODE = `from Standard.Base import all
from Standard.Table import all
from Standard.Image import Image
import Standard.Visualization

main =
    image = Image.read (enso_project.data / "sample.png")
    summary = Table.new [["Library", ["Image " + image.rows.to_text + "x" + image.columns.to_text]]]
`

/**
 * `code` with the metadata the GUI reads: the node whose expression is `shown` gets an id and an
 * open visualisation, and `snapshot` is the code the id map's spans refer to (as the ydoc server
 * writes it), so they are not re-resolved. Only that node is in the id map; the GUI gives the rest
 * ids at open, the same work on every engine.
 */
export function withVisualisedNode(code: string, shown: string): string {
  const index = code.indexOf(shown)
  if (index < 0 || code.indexOf(shown, index + 1) >= 0) {
    throw new Error(`The node expression must occur once: ${shown}`)
  }
  const id = randomUUID()
  const idMap = [[{ index: { value: index }, size: { value: shown.length } }, id]]
  const metadata = {
    ide: {
      node: {
        [id]: {
          position: { vector: [-388, 282] },
          visualization: { show: true, width: 800, height: 200 },
        },
      },
      widget: {},
      import: {},
      snapshot: zlib.deflateSync(Buffer.from(code, 'utf8')).toString('base64'),
    },
  }
  return `${code}\n\n\n#### METADATA ####\n${JSON.stringify(idMap)}\n${JSON.stringify(metadata)}\n`
}

/** The template named `name`; `undefined` for `welcome`, which is the project as created. */
export function projectTemplate(name: TemplateName): ProjectTemplate | undefined {
  switch (name) {
    case 'welcome':
      return undefined
    case 'image':
      return {
        main: withVisualisedNode(
          IMAGE_CODE,
          'Table.new [["Library", ["Image " + image.rows.to_text + "x" + image.columns.to_text]]]',
        ),
        files: { 'data/sample.png': Buffer.from(SAMPLE_PNG, 'base64') },
        headline: 'Image 16x16',
        extras: false,
      }
  }
}
