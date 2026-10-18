/** @file Automatic updates through the Electron updater (see `app/electron-client/src/updater.ts`). */
import { useIncludePrereleases } from '$/providers/updateSettings'
import type { UpdateMode, UpdateStatus } from 'enso-common/src/updater'
import { onScopeDispose, ref } from 'vue'

/** Status and actions of the Electron updater; `mode` is `manual` outside Electron. */
export function useAutoUpdate() {
  const api = window.api?.updater
  const includePrereleases = useIncludePrereleases()
  const mode = ref<UpdateMode | null>(api == null ? 'manual' : null)
  const status = ref<UpdateStatus>({ state: 'idle' })

  if (api != null) {
    void api.mode().then((value) => (mode.value = value))
    const dispose = api.onStatus((value) => (status.value = value))
    onScopeDispose(dispose)
  }

  return {
    mode,
    status,
    /** Check for an update. The status it returns also tells a reloaded window where a download is. */
    async check() {
      if (api != null) status.value = await api.check(includePrereleases.value)
    },
    async download() {
      await api?.download()
    },
    async restart() {
      await api?.quitAndInstall()
    },
  }
}
