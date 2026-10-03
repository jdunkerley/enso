/**
 * @file The React provider for keyboard and mouse shortcuts, along with hooks to use the provider
 * via the shared React context.
 */
import * as React from 'react'

import * as inputBindingsModule from '$/configurations/inputBindings'
import { getDashboardInputBindings } from '$/providers/inputBindings'

/** State contained in a `ShortcutsContext`. */
export type InputBindingsContextType = inputBindingsModule.DashboardBindingNamespace

const InputBindingsContext = React.createContext<InputBindingsContextType>(
  inputBindingsModule.createBindings(),
)

/** Props for a {@link InputBindingsProvider}. */
export interface InputBindingsProviderProps extends Readonly<React.PropsWithChildren> {
  readonly inputBindings?: inputBindingsModule.DashboardBindingNamespace
}

/** A React Provider that lets components get the input bindings. */
export default function InputBindingsProvider(props: InputBindingsProviderProps) {
  const { children } = props

  // The instance Vue reads too (`$/providers/inputBindings`), so that a rebinding reaches both.
  const [inputBindings] = React.useState(getDashboardInputBindings)

  React.useEffect(() => {
    inputBindings.register()

    return () => {
      inputBindings.unregister()
    }
  }, [inputBindings])

  return (
    <InputBindingsContext.Provider value={inputBindings}>{children}</InputBindingsContext.Provider>
  )
}

/**
 * Exposes a property to get the input bindings namespace.
 * @throws {Error} when used outside of its context.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useInputBindings() {
  return React.useContext(InputBindingsContext)
}
