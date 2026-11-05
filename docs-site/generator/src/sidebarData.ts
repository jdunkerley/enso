import { isFunctionPage, type Page, type SiteModel } from './model'
import { simpleName } from './typeText'

const id = (page: Page) => `api/${page.path}/index`
const doc = (page: Page, label: string) => ({
  type: 'doc',
  id: id(page),
  label,
})

/** `api`: the intro and the libraries; `api-<library>`: that library's modules, types and functions. */
export function buildSidebars(model: SiteModel): Record<string, unknown[]> {
  const sidebars: Record<string, unknown[]> = {
    api: [{ type: 'doc', id: 'api/index', label: 'Components' }],
  }
  for (const library of model.libraries) {
    const libraryPage = model.byPath.get(library)!
    ;(sidebars.api as unknown[]).push({
      type: 'ref',
      id: id(libraryPage),
      label: library,
    })
    const pages = model.pages.filter((page) => page.library === library)
    const memberOf = (type: Page) => {
      const qualified = `${type.module}.${type.title}`
      return pages.filter(
        (page) =>
          isFunctionPage(page) &&
          ((page.kind === 'constructor' &&
            'returnType' in page.entry &&
            page.entry.returnType === qualified) ||
            ((page.kind === 'staticMethod' || page.kind === 'instanceMethod') &&
              'selfType' in page.entry &&
              page.entry.selfType === qualified)),
      )
    }
    const orderMembers = (members: Page[]) => [
      ...members.filter((page) => page.kind === 'constructor'),
      ...members.filter((page) => page.kind === 'staticMethod'),
      ...members.filter((page) => page.kind === 'instanceMethod'),
    ]
    const moduleCategory = (module: Page) => ({
      type: 'category',
      label: module.kind === 'library' ? 'Main' : simpleName(module.module),
      link: { type: 'doc', id: id(module) },
      collapsed: true,
      items: [
        ...pages
          .filter((page) => page.kind === 'type' && page.module === module.module)
          .map((type) => ({
            type: 'category',
            label: type.title,
            link: { type: 'doc', id: id(type) },
            collapsed: true,
            items: orderMembers(memberOf(type)).map((page) => doc(page, page.nodeName)),
          })),
        ...pages
          .filter(
            (page) =>
              (page.kind === 'moduleFunction' || page.kind === 'extensionMethod') &&
              page.module === module.module,
          )
          .map((page) => doc(page, page.nodeName)),
      ],
    })
    const mainHasMembers = pages.some(
      (page) =>
        page.kind !== 'library' && page.kind !== 'module' && page.module === libraryPage.module,
    )
    sidebars[`api-${library}`] = [
      doc(libraryPage, library),
      ...(mainHasMembers ? [moduleCategory(libraryPage)] : []),
      ...pages.filter((page) => page.kind === 'module').map(moduleCategory),
    ]
  }
  return sidebars
}
