/**
 * @file The core's contributions to the app's registries, made by `entrypoint.ts` before the
 * router starts. The Versions tab serves local git versioning
 * (decision 7 of `docs/superpowers/specs/2026-10-17-local-only-ide-design.md`).
 */
import { contributeRightPanelTab } from '$/providers/rightPanelContributions'

/** Contribute the core's right-panel tabs. Call it before the router's first navigation. */
export function registerCore() {
  contributeRightPanelTab('versions', () => import('$/versions/AssetVersions.vue'))
}
