/**
 * @file The React drive's view of the in-flight batched mutations, whose options are the
 * framework-free ones in `$/utils/driveMutations`. They go with the React drive (#91).
 */
import { resolveDuplications } from '$/components/Drive/duplicateAssets'
import {
  deleteAssetsMutationOptions,
  moveAssetsMutationOptions,
  restoreAssetsMutationOptions,
  type DeleteAssetsVariables,
  type RestoreAssetsVariables,
  type TransferAssetsVariables,
} from '$/utils/driveMutations'
import type { MutationOptions } from '@tanstack/query-core'
import { useMutationState, type Mutation } from '@tanstack/react-query'
import type { Backend } from 'enso-common/src/services/Backend'

/** Options for the hooks returning in-flight mutations. */
interface MutationStateOptions<TVariables, Result> {
  readonly predicate?: (mutation: Mutation<unknown, Error, TVariables>) => boolean
  readonly select?: (mutation: Mutation<unknown, Error, TVariables>) => Result
}

/** Return the pending mutations with the given options' key, matching the predicate. */
function usePendingMutationState<TData, TVariables, Result>(
  mutationOptions: MutationOptions<TData, Error, TVariables>,
  options: MutationStateOptions<TVariables, Result>,
) {
  const { predicate, select } = options
  const { mutationKey } = mutationOptions
  return useMutationState({
    filters: {
      ...(mutationKey != null ? { mutationKey } : {}),
      // We rely on mutation key pointing to properly typed mutation.
      // eslint-disable-next-line no-restricted-syntax
      predicate: ((mutation: Mutation<unknown, Error, TVariables>) =>
        mutation.state.status === 'pending' && (predicate?.(mutation) ?? true)) as (
        mutation: Mutation,
      ) => boolean,
    },
    // This is UNSAFE when the `Result` parameter is explicitly specified in the
    // generic parameter list.
    // eslint-disable-next-line no-restricted-syntax
    select: select as (mutation: Mutation<unknown, Error, unknown, unknown>) => Result,
  })
}

/** Return matching in-flight "delete assets" mutations. */
export function useDeleteAssetsMutationState<Result>(
  backend: Backend,
  options: MutationStateOptions<DeleteAssetsVariables, Result> = {},
) {
  return usePendingMutationState(deleteAssetsMutationOptions(backend), options)
}

/** Return matching in-flight "restore assets" mutations. */
export function useRestoreAssetsMutationState<Result>(
  backend: Backend,
  options: MutationStateOptions<RestoreAssetsVariables, Result> = {},
) {
  return usePendingMutationState(restoreAssetsMutationOptions(backend), options)
}

/** Return matching in-flight "move assets" mutations. */
export function useMoveAssetsMutationState<Result>(
  backend: Backend,
  options: MutationStateOptions<TransferAssetsVariables, Result> = {},
) {
  return usePendingMutationState(moveAssetsMutationOptions(backend, resolveDuplications), options)
}
