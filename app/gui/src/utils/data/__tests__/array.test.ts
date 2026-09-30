import { fc, test as fcTest } from '@fast-check/vitest'
import { expect, test } from 'vitest'
import * as array from '../array'

interface TransposeCase {
  matrix: number[][]
  expected: number[][]
}

const transposeCases: TransposeCase[] = [
  { matrix: [], expected: [] },
  { matrix: [[]], expected: [[]] },
  { matrix: [[1]], expected: [[1]] },
  { matrix: [[1, 2]], expected: [[1], [2]] },
  { matrix: [[1], [2]], expected: [[1, 2]] },
  {
    matrix: [
      [1, 2, 3],
      [4, 5, 6],
    ],
    expected: [
      [1, 4],
      [2, 5],
      [3, 6],
    ],
  },
]

test.each(transposeCases)('transpose: case %#', ({ matrix, expected }) => {
  const transposed = array.transpose(matrix)
  expect(transposed).toStrictEqual(expected)
})

fcTest.prop({ array: fc.array(fc.anything()) })('`array.shallowEqual`', ({ array: items }) => {
  expect(array.shallowEqual(items, [...items]))
})

fcTest.prop({
  array: fc.array(fc.anything(), { minLength: 1 }).chain((items) =>
    fc.record({
      array: fc.constant(items),
      i: fc.nat(items.length - 1),
    }),
  ),
})('`array.includesPredicate`', ({ array: { array: items, i } }) => {
  expect(
    array.includesPredicate(items)(items[i]),
    `'${JSON.stringify(items)}' should include '${JSON.stringify(items[i])}'`,
  ).toBe(true)
  expect(array.includesPredicate(items)({}), 'unique object should not be in array').toBe(false)
})
