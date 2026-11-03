// Pre-commit formatting, run by `.husky/pre-commit` through lint-staged on the
// staged files only. The Rust/Java/Scala work lives in
// tools/pre-commit/format-staged.mjs, which skips (with a notice) when its tool
// is missing. See "Formatting hook" in docs/CONTRIBUTING.md.
const script = 'node ./tools/pre-commit/format-staged.mjs'
const quote = (files) => files.map((f) => JSON.stringify(f)).join(' ')

export default {
  '*.{js,jsx,cjs,mjs,cts,mts,ts,tsx,vue,json,jsonc,md,mdx,yml,yaml,html,css,scss}':
    'node ./node_modules/prettier/bin/prettier.cjs --write',
  // Whole workspace, so the staged file list is discarded (see the script).
  '*.rs': () => `${script} rust`,
  '*.java': (files) => `${script} java ${quote(files)}`,
  '*.{scala,sbt}': (files) => `${script} scala ${quote(files)}`,
}
