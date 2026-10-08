/** @file Reading the authentication pages' query parameters (`email`, `verification_code`, …). */
import type { RouteLocationNormalizedLoaded } from 'vue-router'

/** A query parameter's value, or the first one when it repeats. */
export function queryParam(route: RouteLocationNormalizedLoaded, name: string) {
  const value = route.query[name]
  return (Array.isArray(value) ? value[0] : value) ?? null
}
