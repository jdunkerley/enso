/**
 * @file File containing the {@link App} React component, which is the entrypoint into our React
 * application.
 *
 * The {@link App} component defines the global React context used by child components: the
 * react-aria router and the input bindings. The toasts, the modal stack, the About dialog with its
 * menu handler, the version checker and the app-wide effects (theme, selection clearing) are Vue's,
 * in `App.vue`.
 */
import * as React from 'react'

import * as z from 'zod'

import InputBindingsProvider from '#/providers/InputBindingsProvider'

import { RouterProvider } from 'react-aria-components'

import LocalStorage from '$/utils/LocalStorage'

import { useRouter } from '$/providers/react'

declare module '$/utils/LocalStorage' {
  /** */
  interface LocalStorageData {
    readonly preferredTimeZone: string
    readonly loginRedirect: string
  }
}
LocalStorage.registerKey('preferredTimeZone', { schema: z.string() })
LocalStorage.registerKey('loginRedirect', {
  isUserSpecific: true,
  schema: z.string(),
})

/**
 * Component called by the parent module, returning the root React component for this
 * package.
 */
export default function App(props: React.PropsWithChildren) {
  const { children } = props
  const { router } = useRouter()
  const navigate = router.push.bind(router)

  // `InputBindingsProvider` depends on `LocalStorageProvider`.
  return (
    <RouterProvider navigate={navigate}>
      <InputBindingsProvider>{children}</InputBindingsProvider>
    </RouterProvider>
  )
}
