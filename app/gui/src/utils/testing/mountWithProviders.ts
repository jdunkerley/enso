/**
 * @file Mount a Vue component for a unit test with the app-level providers it expects.
 *
 * The shared harness for Vue component tests, in particular for components ported from the React
 * dashboard (#75, #81). It supplies what `App.vue` and `entrypoint.ts` would otherwise provide:
 *
 * - a fresh TanStack `QueryClient` (no retries, so a failing query fails the test at once);
 * - a `vue-router` instance on in-memory history, already navigated to `route`;
 * - the UI language of the global text store (`$/providers/text`), English by default;
 * - the context stores `App.vue` provides to every component: the global event registry (which
 *   `MenuButton` needs to act on a press), the keyboard state, the tooltip registry and the
 *   interaction handler;
 * - further context stores made with `createContextStore` (`@/providers`), by store name, and
 *   plain `provide` values such as the `rootDirPath` that the backends store injects.
 *
 * The component is mounted inside a host that provides those stores. The returned `wrapper` is the
 * component's own; `setProps` updates its props through the host.
 *
 * Stores made with `createGlobalState` (`useBackends`, `useAuth`, `useCategories`,
 * `useContainerData`, …) are app-wide singletons that no provider can replace. A test that needs
 * one faked mocks its module, with {@link mockBackends} for the backends:
 *
 * ```ts
 * vi.mock('$/providers/backends', async () => {
 *   const { mockBackends } = await import('$/utils/testing/mountWithProviders')
 *   const listDirectory = vi.fn<Backend['listDirectory']>()
 *   return { useBackends: () => mockBackends({ remoteBackend: { listDirectory } }) }
 * })
 * ```
 */
import type { BackendsStore } from '$/providers/backends'
import { useText } from '$/providers/text'
import { provideGlobalEventRegistry } from '@/providers/globalEventRegistry'
import { provideInteractionHandler } from '@/providers/interactionHandler'
import { provideBubblingKeyboard, provideKeyboard } from '@/providers/keyboard'
import { provideTooltipRegistry } from '@/providers/tooltipRegistry'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import {
  enableAutoUnmount,
  flushPromises,
  mount,
  type ComponentMountingOptions,
  type VueWrapper,
} from '@vue/test-utils'
import { BackendType, type Backend } from 'enso-common/src/services/Backend'
import type { Language } from 'enso-common/src/text'
import { afterEach } from 'vitest'
import { defineComponent, h, reactive, type Component, type VNodeProps } from 'vue'
import { createMemoryHistory, createRouter, type RouteRecordRaw, type Router } from 'vue-router'

// Components are attached to the document (window-level event handlers only see attached elements),
// so each one is unmounted after its test.
enableAutoUnmount(afterEach)

/** A route that renders nothing, so any path resolves. */
const CATCH_ALL_ROUTE: RouteRecordRaw = { path: '/:path(.*)*', component: { render: () => null } }

/** Options for {@link mountWithProviders}, on top of some of `@vue/test-utils`' mounting options. */
export type MountWithProvidersOptions<C extends Component> = Pick<
  ComponentMountingOptions<C>,
  'props' | 'attrs' | 'slots' | 'global'
> & {
  /** The query client; a new one per mount by default. */
  readonly queryClient?: QueryClient
  /** Routes of the test router. A catch-all route is always appended. */
  readonly routes?: readonly RouteRecordRaw[]
  /** The path the router starts at. Defaults to `/`. */
  readonly route?: string
  /** The UI language. Defaults to English, whatever the host's locale. */
  readonly language?: Language
  /**
   * Context stores to provide, keyed by the name given to `createContextStore` (e.g. `drive`,
   * `driveStore`). The value is the store instance the component's `useX()` will receive.
   */
  readonly stores?: Readonly<Record<string, unknown>>
}

/** Create a query client suited to tests: no retries, and nothing collected mid-test. */
export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  })
}

/** What {@link mountWithProviders} returns. */
export interface MountedWithProviders {
  /** The mounted component's wrapper. */
  readonly wrapper: VueWrapper
  /** Update the component's props (merged into the current ones), and let Vue re-render. */
  readonly setProps: (props: Record<string, unknown>) => Promise<void>
  /** Unmount the component (each one is also unmounted after its test). */
  readonly unmount: () => void
  readonly router: Router
  readonly queryClient: QueryClient
}

/**
 * Mount `component` with the app-level providers (see the file comment), and wait for the router's
 * initial navigation and pending promises.
 * @returns the component's wrapper, `setProps` and `unmount` for it, and the router and query
 * client used.
 */
export async function mountWithProviders<C extends Component>(
  component: C,
  options: MountWithProvidersOptions<C> = {},
): Promise<MountedWithProviders> {
  const {
    queryClient = createTestQueryClient(),
    routes = [],
    route = '/',
    language = 'english',
    stores = {},
    global = {},
    props: initialProps = {},
    attrs = {},
    slots,
  } = options

  useText().setLanguage(language)

  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: [...routes, CATCH_ALL_ROUTE],
  })
  await router.push(route)
  await router.isReady()

  const provide: Record<string | symbol, unknown> = { ...global.provide }
  for (const [name, store] of Object.entries(stores)) {
    provide[Symbol.for(`contextStore-${name}`)] = store
  }

  const props = reactive<Record<string, unknown>>({ ...attrs, ...initialProps })
  const Host = defineComponent({
    name: 'MountWithProvidersHost',
    setup(_, { slots: hostSlots }) {
      const globalEvents = provideGlobalEventRegistry()
      provideKeyboard(globalEvents)
      provideBubblingKeyboard(globalEvents)
      provideTooltipRegistry()
      provideInteractionHandler()
      return () => h(component as Component, props as VNodeProps, hostSlots)
    },
  })

  const root = mount(Host, {
    ...(slots ? { slots } : {}),
    attachTo: document.body,
    global: {
      ...global,
      plugins: [...(global.plugins ?? []), [VueQueryPlugin, { queryClient }], router],
      provide,
    },
  })
  const wrapper: VueWrapper = root.findComponent(component as Component)
  await flushPromises()

  /** Update the component's props (merged into the current ones), and let Vue re-render. */
  async function setProps(newProps: Record<string, unknown>) {
    Object.assign(props, newProps)
    await flushPromises()
  }

  return { wrapper, setProps, unmount: () => root.unmount(), router, queryClient }
}

/**
 * A stand-in for the backends store (`useBackends`), for use in a `vi.mock` factory. Only the
 * methods a test passes exist on each backend; calling any other one is a test error.
 */
export function mockBackends(
  backends: {
    readonly remoteBackend?: Partial<Backend>
    readonly localBackend?: Partial<Backend> | null
  } = {},
): BackendsStore {
  const remoteBackend = { type: BackendType.remote, ...backends.remoteBackend } as Backend
  const localBackend =
    backends.localBackend === undefined || backends.localBackend === null ?
      null
    : ({ type: BackendType.local, ...backends.localBackend } as Backend)
  return reactive({
    remoteBackend,
    localBackend,
    backendForType: (type: BackendType) => {
      if (type === BackendType.remote) return remoteBackend
      if (localBackend == null) throw new Error('mockBackends: no local backend was given.')
      return localBackend
    },
  }) as unknown as BackendsStore
}
