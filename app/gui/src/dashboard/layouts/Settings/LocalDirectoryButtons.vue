<script setup lang="ts">
/**
 * @file The buttons below a directory of the Local settings tab: browse for a new one (in the
 * desktop app only) and reset it to the default.
 */
import { setDownloadDirectory, setLocalRootDirectory } from '#/layouts/Drive/persistentState'
import Button from '$/components/Button/Button.vue'
import ButtonGroup from '$/components/Button/ButtonGroup.vue'
import { useText } from '$/providers/text'
import { Path } from 'enso-common/src/services/Backend'
import { normalizePath } from 'enso-common/src/utilities/file'

const { directory } = defineProps<{
  /** The local projects' root directory, or the download directory. */
  directory: 'download' | 'localRoot'
}>()

const { getText } = useText()

const hasFileBrowser = window.api != null

function setDirectory(path: Path | null) {
  if (directory === 'localRoot') setLocalRootDirectory(path)
  else setDownloadDirectory(path)
}

async function browse() {
  const [newDirectory] = (await window.api?.fileBrowser.openFileBrowser('directory')) ?? []
  if (newDirectory != null) setDirectory(Path(normalizePath(newDirectory)))
}
</script>

<template>
  <ButtonGroup class="grow-0">
    <Button v-if="hasFileBrowser" size="small" variant="outline" @press="browse">
      {{
        getText(
          directory === 'localRoot' ?
            'browseForNewLocalRootDirectory'
          : 'browseForNewDownloadDirectory',
        )
      }}
    </Button>
    <Button size="small" variant="outline" class="self-start" @press="setDirectory(null)">
      {{
        getText(directory === 'localRoot' ? 'resetLocalRootDirectory' : 'resetDownloadDirectory')
      }}
    </Button>
  </ButtonGroup>
</template>
