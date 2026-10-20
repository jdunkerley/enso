/**
 * @file The local secrets, as queries shared by the Settings page's Secrets section and the
 * datalink editor's secret picker: the list of names (never a value) and creating one.
 *
 * Both take the local backend, since the Settings page gets it from its context and the rest of
 * the app from {@link useBackends}. With no backend, the list is empty and nothing is fetched.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import type { LocalBackend } from 'enso-common/src/services/LocalBackend'
import { computed, toValue, type MaybeRefOrGetter } from 'vue'

/** The cache key under which every local-secrets query lives, so one invalidation covers them. */
export const LOCAL_SECRETS_KEY = ['localSecrets'] as const
const LIST_KEY = [...LOCAL_SECRETS_KEY, 'list'] as const

/** The local secrets' names, ids and `secret://` paths. */
export function useLocalSecretsQuery(backend: MaybeRefOrGetter<LocalBackend | null | undefined>) {
  return useQuery({
    queryKey: LIST_KEY,
    queryFn: async () => (await toValue(backend)?.listSecrets()) ?? [],
    enabled: computed(() => toValue(backend) != null),
  })
}

/**
 * Create a local secret. The mutation resolves to the new secret's `secret://` path, and refreshes
 * the secrets queries once it settles.
 */
export function useCreateLocalSecret(backend: MaybeRefOrGetter<LocalBackend | null | undefined>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ name, value }: { name: string; value: string }) => {
      const local = toValue(backend)
      if (local == null) throw new Error('There is no local backend to save the secret in.')
      await local.createSecret({ name, value, parentDirectoryId: null })
      return `secret://${name}`
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: LOCAL_SECRETS_KEY }),
  })
}
