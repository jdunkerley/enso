/**
 * @file The React provider for the {@link Logger} interface, along with a hook to use the
 * provider via the shared React context.
 */
import type { Logger } from '$/log'
import * as React from 'react'

/** See `AuthContext` for safety details. */
// eslint-disable-next-line no-restricted-syntax
const LoggerContext = React.createContext<Logger>({} as Logger)

/** Props for a {@link LoggerProvider}. */
export interface LoggerProviderProps {
  readonly children: React.ReactNode
  readonly logger: Logger
}

/** A React provider containing the diagnostic logger. */
export default function LoggerProvider(props: LoggerProviderProps) {
  const { children, logger } = props
  return <LoggerContext.Provider value={logger}>{children}</LoggerContext.Provider>
}

/** A React context hook exposing the diagnostic logger. */
// eslint-disable-next-line react-refresh/only-export-components
export function useLogger() {
  return React.useContext(LoggerContext)
}
