/**
 * @file The release's name and notes: a port of the retired build CLI's `release.rs`
 * (`generate_release_body`, `release-body.md`) and `changelog.rs` (`top_release_notes`). Two
 * deliberate differences: the notes are not HTML-escaped (Handlebars' `{{changelog}}` turned every
 * backtick, quote and `<kbd>` into an entity, which GitHub then showed literally), and the
 * "Anonymous Data Collection" section is gone (the IDE is local-only and sends no usage data).
 */
import { downloadUrl, installerName, RELEASE_TARGETS } from './assets.ts'

/** The release's display name: `Enso <version>`. */
export function prettyName(version: string): string {
  return `Enso ${version}`
}

/**
 * The start and end offsets of each level-1 ATX heading (`# …`) outside fenced code blocks: the
 * headings `pulldown_cmark` reported as `HeadingLevel::H1`, for the shape `CHANGELOG.md` has.
 */
function levelOneHeadings(text: string): { start: number; end: number; title: string }[] {
  const headings: { start: number; end: number; title: string }[] = []
  let fence: string | null = null
  let offset = 0
  for (const line of text.split('\n')) {
    const start = offset
    offset += line.length + 1
    const content = line.replace(/\r$/, '')
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(content)
    if (fenceMatch != null) {
      const marker = fenceMatch[1] ?? ''
      if (fence == null) fence = marker
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null
      continue
    }
    if (fence != null) continue
    const heading = /^ {0,3}#(?:[ \t]+(.*?))?[ \t]*$/.exec(content)
    if (heading != null) {
      headings.push({ start, end: start + line.length, title: (heading[1] ?? '').trim() })
    }
  }
  return headings
}

/**
 * The notes under the first level-1 heading of `CHANGELOG.md`, up to the next one, trimmed: the
 * `# Next Release` section while a release is being prepared.
 */
export function topReleaseNotes(changelog: string): string {
  const [first, second] = levelOneHeadings(changelog)
  if (first == null) throw new Error('Failed to find a level one header.')
  return changelog.slice(first.end, second?.start ?? changelog.length).trim()
}

/** The release body: download links for every installer, then the changelog section. */
export function releaseBody(repository: string, version: string, changelog: string): string {
  const links = RELEASE_TARGETS.map(
    (target) =>
      `- [${target.pretty}](${downloadUrl(repository, version, installerName(target, version))})`,
  )
  return [
    '# Download',
    '',
    '## Enso IDE',
    '',
    'Enso IDE is the main product of the Enso project. The packages are stand-alone, they contain both GUI and the backend.',
    '',
    'Download links:',
    ...links,
    '',
    'This is the recommended download for most users.',
    '',
    '# Changelog',
    '',
    topReleaseNotes(changelog),
    '',
  ].join('\n')
}
