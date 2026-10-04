import * as react from 'react'
import type { EnsoDevtoolsStore } from '../devTools'

/**
 * The devtools store, for React. Nothing reads it since the devtools moved to Vue (#172); the
 * provider in `globalProvider.tsx` goes with the React shell (#93).
 */
export const EnsoDevtoolsStoreContext = react.createContext<EnsoDevtoolsStore | null>(null)
