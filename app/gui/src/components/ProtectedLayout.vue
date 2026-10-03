<script lang="ts">
/**
 * @file A component watching changes in current user state. It hides subcomponents and redirects
 * if user lost privileges to see them. Also makes sure user will agree with Terms of Service and
 * privacy policy.
 */
import {
  EnsoDevtools as EnsoDevToolsReact,
  ReactQueryDevtools as ReactQueryDevtoolsReact,
} from '#/components/Devtools'
import LocalStorage from '$/utils/LocalStorage'
import { DASHBOARD_PATH, LOGIN_PATH, RESTORE_USER_PATH } from '$/appUtils'
import { useAppTitle } from '$/composables/appTitle'
import { useAuth, type AuthStore } from '$/providers/auth'
import { useFeatureFlag } from '$/providers/featureFlags'
import {
  agreementsModal,
  hasAgreementsGate,
  loadAgreementsGate,
  type UserAgreements,
} from '$/providers/layoutContributions'
import type { DataLoader } from '$/router'
import { useAppClass } from '@/providers/appClass'
import { reactComponent } from '$/utils/react'
import * as vueQuery from '@tanstack/vue-query'
import { useQueryClient } from '@tanstack/vue-query'
import { Err, Ok } from 'enso-common/src/utilities/data/result'
import {
  computed,
  defineAsyncComponent,
  effectScope,
  EffectScope,
  watch,
  watchPostEffect,
} from 'vue'
import { useRoute, useRouter, type RouteLocation } from 'vue-router'

declare module 'vue-router' {
  interface RouteMeta {
    access?: 'guest' | 'anyLoggedIn' | 'deleted'
  }
}

// Loaded on its own, so that its dialog code is not on every route's critical path.
const SessionOverlays = defineAsyncComponent(() => import('$/components/SessionOverlays.vue'))

function routeAllowed(route: RouteLocation, auth: AuthStore) {
  switch (route.meta.access) {
    case undefined:
      console.error(
        'A route ',
        route,
        'is inside ProtectedLayout but does not specify access level.',
      )
      return true
    case 'guest':
      return auth.session == null
    case 'anyLoggedIn':
      return auth.session != null && !auth.isUserMarkedForDeletion()
    case 'deleted':
      return auth.isUserSoftDeleted()
    default:
      return !auth.isUserMarkedForDeletion()
  }
}

function redirect(auth: AuthStore, localStorage: LocalStorage) {
  if (auth.session == null || auth.isUserDeleted()) return { path: LOGIN_PATH }
  if (auth.isUserSoftDeleted()) return { path: RESTORE_USER_PATH }
  return { path: localStorage.consume('loginRedirect') ?? DASHBOARD_PATH }
}

function requireUserAgreements(route: RouteLocation, auth: AuthStore) {
  // The gate is the cloud's (`src/cloud/agreements/`, contributed through `registerCloud`): a build
  // without the cloud has no agreements to accept.
  if (!hasAgreementsGate()) return false
  // The Terms of Service / Privacy Policy hashes are served by the Enso Cloud web host. On a
  // local-only deployment (no Cognito configuration) that host does not exist, so there is
  // nothing to fetch or agree to. A transient cloud outage (degraded-auth mode) still shows the
  // agreements — the endpoint typically stays reachable and the user may have already accepted.
  if (auth.isAuthDisabled) return false
  switch (route.meta.access) {
    case 'deleted':
    case 'guest':
    case undefined:
      return false
    default:
      return true
  }
}

let scope: EffectScope | undefined

/**
 * Read the user's agreements through the contributed gate, in a new {@link scope}. Call it before
 * the guard's first `await`, so that the scope belongs to the guard's own.
 */
async function loadUserAgreements(queryClient: vueQuery.QueryClient) {
  const gateScope = effectScope()
  scope = gateScope
  const gate = await loadAgreementsGate()
  const agreements = await gateScope.run(() => gate.useUserAgreements(queryClient))
  // A stopped scope (the navigation was superseded) runs nothing: fail rather than skip the gate.
  if (agreements == null) throw new Error('The agreements gate was stopped while loading.')
  return agreements
}

type Props = {
  agreementsModalProps: UserAgreements | undefined
}

export const dataLoader: DataLoader<Props> = {
  async beforeRouteEnter(to) {
    const queryClient = vueQuery.useQueryClient()
    const localStorage = LocalStorage.getInstance()
    const auth = useAuth()

    if (!routeAllowed(to, auth)) {
      return Err(redirect(auth, localStorage) ?? false)
    }

    if (requireUserAgreements(to, auth)) {
      return Ok({ agreementsModalProps: await loadUserAgreements(queryClient) })
    }
    return Ok({ agreementsModalProps: undefined })
  },

  async beforeRouteUpdate(to, from, data) {
    if (to.meta.access !== from.meta.access) {
      const queryClient = vueQuery.useQueryClient()
      const localStorage = LocalStorage.getInstance()
      const auth = useAuth()
      if (!routeAllowed(to, auth)) {
        return redirect(auth, localStorage) ?? false
      }
      const agreementsRequired = requireUserAgreements(to, auth)
      if (agreementsRequired && data.agreementsModalProps == null) {
        scope?.stop()
        data.agreementsModalProps = await loadUserAgreements(queryClient)
      } else if (!agreementsRequired && data.agreementsModalProps != null) {
        scope?.stop()
        data.agreementsModalProps = undefined
      }
    }
  },
}
</script>

<script setup lang="ts">
const props = defineProps<Props>()

const auth = useAuth()
const route = useRoute()
const router = useRouter()
const queryClient = useQueryClient()
const EnsoDevtools = reactComponent(EnsoDevToolsReact)
const ReactQueryDevtools = reactComponent(ReactQueryDevtoolsReact)

// Needed by devtools - act on feature flag changes
const debugHoverAreas = useFeatureFlag('debugHoverAreas')
useAppClass(() => ({ debugHoverAreas: debugHoverAreas.value }))

const allowed = computed(() => routeAllowed(route, auth))

watch(
  allowed,
  (allowed) => {
    if (!allowed) {
      const redirectValue = redirect(auth, LocalStorage.getInstance())
      if (redirectValue) {
        router.replace(redirectValue)
      }
    }
  },
  { immediate: true },
)

// Once user is logged out, we clear queries. We do it in post effect to make sure all unused
// queries are inactive.
watchPostEffect(() => {
  if (auth.session == null) {
    queryClient.removeQueries({ type: 'inactive' })
    queryClient.nukePersister()
  }
})

const displayDevTools = computed(() => auth.session != null)

const AgreementsModal = computed(agreementsModal)
const shouldDisplayAgreementsModal = computed(
  () =>
    !(props.agreementsModalProps?.agreedToTos && props.agreementsModalProps?.agreedToPrivacyPolicy),
)

useAppTitle(computed(() => auth.session))
</script>

<template>
  <div v-if="auth.session == null" data-testid="before-auth-layout" aria-hidden>
    <!-- This div is used as a flag to indicate that the user is not logged in. -->
  </div>
  <div v-else data-testid="after-auth-layout" aria-hidden>
    <!--This div is used as a flag to indicate that the dashboard has been loaded and the user is
    authenticated. -->
  </div>

  <SessionOverlays />

  <!-- The gate blocks the page: it is loaded with `agreementsModalProps`, before this renders. -->
  <component
    :is="AgreementsModal"
    v-if="allowed && agreementsModalProps && shouldDisplayAgreementsModal"
    v-bind="agreementsModalProps"
  />
  <RouterView v-else-if="allowed || route.meta.access == null || route.meta.access === 'guest'" />
  <div v-else data-testid="content-not-allowed"></div>

  <EnsoDevtools v-if="displayDevTools" />
  <ReactQueryDevtools v-if="displayDevTools" />
</template>
