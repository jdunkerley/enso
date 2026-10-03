/**
 * @file The cloud-only part of the app: its one entry point. The app's entry (`entrypoint.ts`)
 * calls {@link registerCloud} before the router starts; nothing else outside `src/cloud/` imports
 * a cloud-only area (an ESLint rule enforces it), so that a community build can drop this folder
 * and that one call. See decision 6b in
 * `docs/superpowers/specs/2026-09-30-react-to-vue-foundations.md`.
 */
import type { Router } from 'vue-router'
import { registerAccountSettings } from './account/settings'
import { registerAuthRoutes } from './auth/routes'

/** Contribute the cloud-only areas to the app. Call it before the router's first navigation. */
export function registerCloud(router: Router) {
  registerAuthRoutes(router)
  registerAccountSettings()
}
