/** @file Global setup for dashboard tests. */
import '$/config'
import * as jestDomMatchers from '@testing-library/jest-dom/matchers'
import { expect } from 'vitest'

expect.extend(jestDomMatchers)
