import { ensoMarkdown } from '@/components/MarkdownEditor/codemirror'
import { setVueHost } from '@/util/codemirror/vueHostExt'
import { EditorState } from '@codemirror/state'
import { Decoration, EditorView } from '@codemirror/view'
import { expect, test } from 'vitest'

function decorations<T>(
  source: string,
  recognize: (from: number, to: number, decoration: Decoration) => T | undefined,
) {
  const view = new EditorView({
    state: EditorState.create({
      doc: source,
      extensions: ensoMarkdown({
        customClipboardAction: () => false,
        customDropAction: () => false,
      }),
    }),
  })
  const vueHost = {
    register: () => ({
      unregister: () => {},
      update: () => {},
    }),
  }
  view.dispatch({ effects: setVueHost.of(vueHost) })
  const decorationSets = view.state.facet(EditorView.decorations)
  const results = []
  for (const decorationSet of decorationSets) {
    const resolvedDecorations =
      decorationSet instanceof Function ? decorationSet(view) : decorationSet
    const cursor = resolvedDecorations.iter()
    while (cursor.value != null) {
      const recognized = recognize(cursor.from, cursor.to, cursor.value)
      if (recognized) results.push(recognized)
      cursor.next()
    }
  }
  return results
}

function links(source: string) {
  return decorations(source, (from, to, deco) => {
    if (deco.spec.tagName === 'a') {
      return {
        text: source.substring(from, to),
        href: deco.spec.attributes.href,
        title: deco.spec.attributes.title,
      }
    }
  })
}

function images(source: string) {
  return decorations(source, (from, to, deco) => {
    if ('widget' in deco.spec && 'props' in deco.spec.widget && 'src' in deco.spec.widget.props) {
      return {
        from,
        to,
        src: deco.spec.widget.props.src,
        alt: deco.spec.widget.props.alt,
      }
    }
  })
}

test.each([
  {
    markdown: '[Link text](https://www.example.com/index.html)',
    expectedLinks: [
      {
        text: 'Link text',
        href: 'https://www.example.com/index.html',
      },
    ],
  },
  {
    markdown: '[*Emphasized link text*](https://www.example.com/index.html)',
    expectedLinks: [
      {
        text: '*Emphasized link text*',
        href: 'https://www.example.com/index.html',
      },
    ],
  },
  {
    markdown: '[*Emphasized* link text](https://www.example.com/index.html)',
    expectedLinks: [
      {
        text: '*Emphasized* link text',
        href: 'https://www.example.com/index.html',
      },
    ],
  },
  {
    markdown: '[Link text **with emphasis**](https://www.example.com/index.html)',
    expectedLinks: [
      {
        text: 'Link text **with emphasis**',
        href: 'https://www.example.com/index.html',
      },
    ],
  },
  {
    markdown: '[Link text](https://www.example.com/index.html "title text")',
    expectedLinks: [
      {
        text: 'Link text',
        href: 'https://www.example.com/index.html',
        title: '"title text"',
      },
    ],
  },
  {
    markdown: '[Link text](<https://www.example.com/index.html>)',
    expectedLinks: [
      {
        text: 'Link text',
        href: 'https://www.example.com/index.html',
      },
    ],
  },
  {
    markdown: '[Link text](<https://www.example.com/Url with spaces.html>)',
    expectedLinks: [
      {
        text: 'Link text',
        href: 'https://www.example.com/Url with spaces.html',
      },
    ],
  },
  {
    markdown: '[Link text](https://www.example.com/Spaces not allowed without angle brackets.html)',
    expectedLinks: [],
  },
  {
    markdown: '[Unclosed url](https://www.example.com/index.html',
    expectedLinks: [],
  },
  {
    markdown: '[](https://www.example.com/index.html)',
    expectedLinks: [],
  },
  {
    markdown: '[With empty URL]()',
    expectedLinks: [],
  },
  {
    markdown: '[With no URL]',
    expectedLinks: [],
  },
  {
    markdown: '[Unclosed',
    expectedLinks: [],
  },
  {
    markdown: '<https://example.com>',
    expectedLinks: [
      {
        text: 'https://example.com',
        href: 'https://example.com',
      },
    ],
  },
  {
    markdown: '<example.com>',
    expectedLinks: [],
  },
])('Link decoration: $markdown', ({ markdown, expectedLinks }) => {
  expect(links(markdown)).toEqual(expectedLinks)
  expect(images(markdown)).toEqual([])
})

test.each([
  {
    markdown: '![Image](https://www.example.com/image.avif)',
    image: {
      src: 'https://www.example.com/image.avif',
      alt: 'Image',
    },
  },
  {
    markdown: '![](https://www.example.com/image.avif)',
    image: {
      src: 'https://www.example.com/image.avif',
      alt: '',
    },
  },
  {
    markdown: '![](<https://www.example.com/The image.avif>)',
    image: {
      src: 'https://www.example.com/The image.avif',
      alt: '',
    },
  },
  {
    markdown: '![](<https://www.example.com/The image.avif)',
    image: null,
  },
  {
    markdown: '![](https://www.example.com/The image.avif)',
    image: null,
  },
  {
    markdown: '![Image](https://www.example.com/image.avif',
    image: null,
  },
  {
    markdown: '![Image]()',
    image: null,
  },
  {
    markdown: '![Image]',
    image: null,
  },
  {
    markdown: '![Image',
    image: null,
  },
])('Image decoration: $markdown', ({ markdown, image }) => {
  expect(links(markdown)).toEqual([])
  expect(images(markdown)).toEqual(
    image == null ?
      []
    : [
        {
          from: markdown.length,
          to: markdown.length,
          src: image.src,
          alt: image.alt,
        },
      ],
  )
})

/** The classes of each line's decoration, by line number. */
function lineClasses(source: string) {
  return decorations(source, (from, _to, deco) => {
    if (
      deco.spec.class?.startsWith('cm-heading') ||
      /cm-(codeBlock|blockquote)/.test(deco.spec.class ?? '')
    ) {
      return { line: source.slice(0, from).split('\n').length, class: deco.spec.class }
    }
  })
}

test('Block lines: headings, code blocks and quotes', () => {
  const markdown = [
    '# Title',
    'Text',
    '## Arguments',
    '### Example',
    '```',
    'code',
    '```',
    '> Quoted',
  ].join('\n')
  expect(lineClasses(markdown)).toEqual([
    { line: 1, class: 'cm-heading cm-heading1' },
    { line: 3, class: 'cm-heading cm-heading2' },
    { line: 4, class: 'cm-heading cm-heading3' },
    { line: 5, class: 'cm-codeBlock cm-codeBlock-first' },
    { line: 6, class: 'cm-codeBlock' },
    { line: 7, class: 'cm-codeBlock cm-codeBlock-last' },
    { line: 8, class: 'cm-blockquote' },
  ])
})

test('Table decoration: a GFM table is replaced by the table widget', () => {
  const markdown = 'Text\n\n| Name | Count |\n|------|-------|\n| John | 1     |\n\nAfter'
  const tables = decorations(markdown, (from, to, deco) => {
    const widget = deco.spec.widget
    if (widget && 'props' in widget && widget.props.parsed?.name === 'Table') {
      return markdown.slice(from, to)
    }
  })
  expect(tables).toEqual(['| Name | Count |\n|------|-------|\n| John | 1     |'])
})
