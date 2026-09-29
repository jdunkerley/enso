import { syntaxHighlighting } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { tagHighlighter, tags, type Tag } from '@lezer/highlight'

const tagNames: (keyof typeof tags)[] = [
  'comment',
  'lineComment',
  'blockComment',
  'docComment',
  'name',
  'variableName',
  'typeName',
  'tagName',
  'propertyName',
  'attributeName',
  'className',
  'labelName',
  'namespace',
  'macroName',
  'literal',
  'string',
  'docString',
  'character',
  'attributeValue',
  'number',
  'integer',
  'float',
  'bool',
  'regexp',
  'escape',
  'color',
  'url',
  'keyword',
  'self',
  'null',
  'atom',
  'unit',
  'modifier',
  'operatorKeyword',
  'controlKeyword',
  'definitionKeyword',
  'moduleKeyword',
  'operator',
  'derefOperator',
  'arithmeticOperator',
  'logicOperator',
  'bitwiseOperator',
  'compareOperator',
  'updateOperator',
  'definitionOperator',
  'typeOperator',
  'controlOperator',
  'punctuation',
  'separator',
  'bracket',
  'angleBracket',
  'squareBracket',
  'paren',
  'brace',
  'content',
  'heading',
  'heading1',
  'heading2',
  'heading3',
  'heading4',
  'heading5',
  'heading6',
  'contentSeparator',
  'list',
  'quote',
  'emphasis',
  'strong',
  'link',
  'monospace',
  'strikethrough',
  'inserted',
  'deleted',
  'changed',
  'invalid',
  'meta',
  'documentMeta',
  'annotation',
  'processingInstruction',
]

/**
 * A stable class on every comment token, next to the mapped highlighting class. The mapped classes
 * are usually CSS module classes, private to the component that defines the colours; this one is
 * for styles that apply to comments in only some editors, such as the code editor's comment font
 * (`CodeEditorImpl.vue`).
 */
export const COMMENT_TOKEN_CLASS = 'tok-comment'

const commentTagNames: ReadonlySet<keyof typeof tags> = new Set([
  'comment',
  'lineComment',
  'blockComment',
  'docComment',
])

/**
 * Defines an {@link Extension} that applies a highlighting CSS class for any {@link Tag} with a provided class mapping.
 * @param css A mapping from {@link Tag} names to CSS class names.
 */
export function highlightStyle(css: Record<string, string>): Extension {
  const modTagClasses = (mod: keyof typeof tags) =>
    tagNames.map((tag) => ({
      tag: (tags[mod] as any)(tags[tag]) as Tag,
      class: `${tags[mod]}-${tag}`,
    }))
  const tagClasses = tagNames.map((tag) => {
    const tagClass = css[tag] ?? tag
    return {
      tag: tags[tag] as Tag,
      class: commentTagNames.has(tag) ? `${tagClass} ${COMMENT_TOKEN_CLASS}` : tagClass,
    }
  })
  return syntaxHighlighting(
    tagHighlighter([
      ...tagClasses,
      ...modTagClasses('definition'),
      ...modTagClasses('constant'),
      ...modTagClasses('function'),
      ...modTagClasses('standard'),
      ...modTagClasses('local'),
      ...modTagClasses('special'),
    ]),
  )
}
