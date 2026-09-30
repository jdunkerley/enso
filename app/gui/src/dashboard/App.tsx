/**
 * @file File containing the {@link App} React component, which is the entrypoint into our React
 * application.
 *
 * The {@link App} component defines the global React context used by child components: the
 * react-aria router, the input bindings, and the About modal. The toasts, the modal stack and the
 * app-wide effects (theme, selection clearing) are Vue's, in `App.vue`.
 */
import * as React from 'react'

import * as z from 'zod'

import InputBindingsProvider from '#/providers/InputBindingsProvider'

import VersionChecker from '#/layouts/VersionChecker'
import { RouterProvider } from 'react-aria-components'

import { AboutModal } from '#/modals/AboutModal'

import LocalStorage from '$/utils/LocalStorage'

import type { ModalApi } from '#/utilities/modal'
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

window.api?.menu.setMenuItemHandler('about', () => {
  AboutModal.open()
})

/**
 * Component called by the parent module, returning the root React component for this
 * package.
 */
export default function App(props: React.PropsWithChildren) {
  const { children } = props
  const { router } = useRouter()
  const navigate = router.push.bind(router)
  const aboutModalRef = React.useRef<ModalApi>(null)

  // `InputBindingsProvider` depends on `LocalStorageProvider`.
  return (
    <RouterProvider navigate={navigate}>
      <InputBindingsProvider>
        <VersionChecker />
        <AboutModal ref={aboutModalRef} />
        {children}
      </InputBindingsProvider>
    </RouterProvider>
  )
}
