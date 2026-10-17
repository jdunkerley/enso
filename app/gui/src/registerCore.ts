/**
 * @file The core's contributions to the app's registries, made by `entrypoint.ts` before the
 * router starts. Since the IDE became local-only (PR 1 of
 * `docs/superpowers/specs/2026-10-17-local-only-ide-design.md`) `registerCloud` is no longer
 * called, but the Versions tab serves local git versioning (decision 7), so the core registers it.
 */
import { contributeRightPanelTab } from '$/providers/rightPanelContributions'

/** Contribute the core's right-panel tabs. Call it before the router's first navigation. */
export function registerCore() {
  // The tab moves to `$/versions/` in PR 2; until then it lives under `src/cloud/`. A dynamic
  // `import()` is outside `no-restricted-imports` (static imports only), so the core boundary
  // rule does not flag it.
  contributeRightPanelTab('versions', () => import('$/versions/AssetVersions.vue'))
}
