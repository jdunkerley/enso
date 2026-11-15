/** @file The guidance an agent reads before it works: bundled Markdown guides and the stdlib's own. */
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { z } from 'zod'
import dataPitfalls from './guides/data-pitfalls.md'
import instructions from './guides/instructions.md'
import language from './guides/language.md'
import overview from './guides/overview.md'
import type { ToolDefinition } from './toolRegistry'

export interface GuideTopic {
  readonly topic: string
  readonly title: string
}

const LIBRARY_PREFIX = 'library/'
const LIBRARY_NAME = /^[A-Za-z0-9_]+$/

const BUILT_IN: readonly (GuideTopic & { readonly text: string })[] = [
  { topic: 'overview', title: 'How to work with an Enso project', text: overview },
  { topic: 'language', title: 'The Enso language', text: language },
  { topic: 'data-pitfalls', title: 'Data-analysis pitfalls', text: dataPitfalls },
]

async function readIfExists(file: string): Promise<string | undefined> {
  try {
    return await fs.readFile(file, 'utf8')
  } catch {
    return undefined
  }
}

/** The URI of a guide as an MCP resource. */
export function guideUri(topic: string): string {
  return `enso://guide/${topic}`
}

/** The guides: built-in ones, and those the bundled standard library ships as `CLAUDE.md` files. */
export class Guides {
  /** The server `instructions` paragraph. */
  readonly instructions = instructions.trim()

  /** `stdlibRoot` is `paths.stdlibRoot(...)`; undefined when no engine is bundled. */
  constructor(private readonly stdlibRoot: string | undefined) {}

  private libraryGuide(name: string): string | undefined {
    if (this.stdlibRoot == null || !LIBRARY_NAME.test(name)) return undefined
    return path.join(this.stdlibRoot, name, '0.0.0-dev', 'CLAUDE.md')
  }

  /** Built-in topics, then `stdlib`, then `library/<Name>` for each library that has a guide. */
  async list(): Promise<readonly GuideTopic[]> {
    const topics: GuideTopic[] = BUILT_IN.map(({ topic, title }) => ({ topic, title }))
    if (this.stdlibRoot == null) return topics
    if ((await readIfExists(path.join(this.stdlibRoot, 'CLAUDE.md'))) != null) {
      topics.push({ topic: 'stdlib', title: 'Standard library conventions' })
    }
    let names: string[]
    try {
      names = (await fs.readdir(this.stdlibRoot, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && LIBRARY_NAME.test(entry.name))
        .map((entry) => entry.name)
        .sort()
    } catch {
      return topics
    }
    for (const name of names) {
      const file = this.libraryGuide(name)
      if (file != null && (await readIfExists(file)) != null) {
        topics.push({ topic: LIBRARY_PREFIX + name, title: `The ${name} library` })
      }
    }
    return topics
  }

  /** The topic's Markdown, or undefined for an unknown topic. */
  async read(topic: string): Promise<string | undefined> {
    const builtIn = BUILT_IN.find((guide) => guide.topic === topic)
    if (builtIn != null) return builtIn.text
    if (this.stdlibRoot == null) return undefined
    if (topic === 'stdlib') return readIfExists(path.join(this.stdlibRoot, 'CLAUDE.md'))
    if (topic.startsWith(LIBRARY_PREFIX)) {
      const file = this.libraryGuide(topic.slice(LIBRARY_PREFIX.length))
      return file == null ? undefined : readIfExists(file)
    }
    return undefined
  }
}

function formatTopics(topics: readonly GuideTopic[]): string {
  return topics.map(({ topic, title }) => `- ${topic}: ${title}`).join('\n')
}

/** The `get_guide` tool: with no topic, the overview and the list of topics. */
export function guideTool(guides: Guides): ToolDefinition {
  return {
    name: 'get_guide',
    title: 'Get a guide',
    description:
      'Read a guide on working with Enso projects. Call it with no `topic` first: it returns ' +
      'the overview and the list of topics (the Enso language, data pitfalls, and the ' +
      'standard libraries).',
    inputSchema: { topic: z.string().optional() },
    run: async (args) => {
      const topics = await guides.list()
      const topic = args.topic as string | undefined
      if (topic == null) {
        const text = (await guides.read('overview')) ?? ''
        return { ok: true, value: `${text}\n\n## Topics\n\n${formatTopics(topics)}\n` }
      }
      const text = await guides.read(topic)
      if (text == null) {
        return {
          ok: false,
          error: `Unknown guide topic '${topic}'. Valid topics:\n${formatTopics(topics)}`,
        }
      }
      return { ok: true, value: text }
    },
  }
}
