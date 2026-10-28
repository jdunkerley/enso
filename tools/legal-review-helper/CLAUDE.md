# tools/legal-review-helper

A small Express server (`index.js`, `static/`) for reviewing the legal-review
report in the browser. `sbt openLegalReviewReport` runs
`GatherLicenses.runReportServer` (`project/GatherLicenses.scala`), which runs
`npm install` and then `npm start` in this directory.

- This is a standalone npm package with its own `package-lock.json`. It is not a
  member of the pnpm workspace, so it uses `npm` rather than `corepack pnpm`.
- See `tools/legal-review/CLAUDE.md` for the report and review data itself.
