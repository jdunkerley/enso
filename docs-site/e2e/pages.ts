/** The pages the accessibility tests visit: the fixture's by default, the real ones in CI. */
export const FUNCTION_PAGE =
  process.env.DOCS_SITE_E2E_FUNCTION ?? 'docs/api/Standard.Fixture/Shapes/Shape.area/'
export const TYPE_PAGE = process.env.DOCS_SITE_E2E_TYPE ?? 'docs/api/Standard.Fixture/Shapes/Shape/'
export const GUIDE_PAGE = 'docs/intro/'
