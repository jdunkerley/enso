import { isFunctionPage, isMethodFromOtherModule, type Page, type SiteModel } from './model'
import { simpleName } from './typeText'

const id = (page: Page) => `api/${page.dir}/index`
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
              page.entry.selfType === qualified &&
              // Listed under the module that defines it, where its URL is.
              !isMethodFromOtherModule(page, model))),
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
              (page.kind === 'moduleFunction' ||
                page.kind === 'extensionMethod' ||
                isMethodFromOtherModule(page, model)) &&
              page.module === module.module,
          )
          .map((page) => doc(page, page.nodeName)),
      ],
    })
    const mainHasMembers = pages.some(
      (page) =>
        page.kind !== 'library' && page.kind !== 'module' && page.module === libraryPage.module,
    )
    // The library is a category above its modules, so a page's breadcrumbs read
    // Library › Module › Type › function (spec, "Page design"). `Main`'s own members get a
    // category without a page of its own: the library's page is `Main`'s.
    const { link: _mainLink, ...mainCategory } = moduleCategory(libraryPage)
    sidebars[`api-${library}`] = [
      {
        type: 'category',
        label: library,
        link: { type: 'doc', id: id(libraryPage) },
        collapsed: false,
        items: [
          ...(mainHasMembers ? [mainCategory] : []),
          ...pages.filter((page) => page.kind === 'module').map(moduleCategory),
        ],
      },
    ]
  }
  return sidebars
}
