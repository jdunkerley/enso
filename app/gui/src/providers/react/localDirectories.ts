import * as react from 'react'
import type { LocalPathsStore } from '../localDirectories'
import { useInReactFunction } from './common'

export const LocalDirectoriesContext = react.createContext<LocalPathsStore | null>(null)
export const useLocalDirectories = useInReactFunction(LocalDirectoriesContext)
