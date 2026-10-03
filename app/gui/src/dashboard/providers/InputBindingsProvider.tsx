/**
 * @file The React provider for keyboard and mouse shortcuts, along with hooks to use the provider
 * via the shared React context. The bindings themselves are the window's
 * (`$/providers/dashboardInputBindings`), which the Vue settings page edits too.
 */
import * as React from 'react'

import * as inputBindingsModule from '$/configurations/inputBindings'
import {
  getDashboardInputBindings,
  type DashboardInputBindings,
} from '$/providers/dashboardInputBindings'
import { useVueValue } from '$/providers/react/common'

/** State contained in a `ShortcutsContext`. */
export type InputBindingsContextType = inputBindingsModule.DashboardBindingNamespace

const InputBindingsContext = React.createContext<InputBindingsContextType>(
  inputBindingsModule.createBindings(),
)

/** Props for a {@link InputBindingsProvider}. */
export interface InputBindingsProviderProps extends Readonly<React.PropsWithChildren> {
  readonly inputBindings?: DashboardInputBindings
}

/** A React Provider that lets components get the input bindings. */
export default function InputBindingsProvider(props: InputBindingsProviderProps) {
  const { children } = props

  const [inputBindings] = React.useState(() => props.inputBindings ?? getDashboardInputBindings())
  // A change (from the Vue settings page) gives the consumers a new value, so that they re-read the
  // bindings: the command palette's shortcuts, the menus' and the handlers.
  const revision = useVueValue(React.useCallback(() => inputBindings.revision, [inputBindings]))
  const value = React.useMemo(() => ({ ...inputBindings, revision }), [inputBindings, revision])

  React.useEffect(() => {
    inputBindings.register()

    return () => {
      inputBindings.unregister()
    }
  }, [inputBindings])

  return <InputBindingsContext.Provider value={value}>{children}</InputBindingsContext.Provider>
}

/**
 * Exposes a property to get the input bindings namespace.
 * @throws {Error} when used outside of its context.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useInputBindings() {
  return React.useContext(InputBindingsContext)
}
