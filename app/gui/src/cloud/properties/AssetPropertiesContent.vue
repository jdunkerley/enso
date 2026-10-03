<script setup lang="ts">
/**
 * @file The Properties tab's content for one asset: its path, owner, dates, size, creator, sharing
 * and labels; a secret's value (or a credential's state); a datalink's configuration. The Vue port
 * of the React `AssetPropertiesInternal`.
 *
 * When the asset's context menu chose "Edit" on a secret or a datalink, the right panel's context
 * names it in `spotlightOn`: the window then dims around that section (`SpotlightOverlay.vue`) until the
 * overlay is clicked.
 */
import CopyButton from '$/components/Button/CopyButton.vue'
import StatelessSpinner from '$/components/Spinner/StatelessSpinner.vue'
import Text from '$/components/Text/Text.vue'
import UpsertSecretForm from '$/cloud/credentials/UpsertSecretForm.vue'
import { useAuth } from '$/providers/auth'
import type { Category } from '$/providers/category'
import { useFeatureFlag } from '$/providers/featureFlags'
import { useRightPanelData } from '$/providers/rightPanel'
import { useText } from '$/providers/text'
import { backendMutationOptions } from '@/composables/backend'
import { useMutation, useQuery } from '@tanstack/vue-query'
import {
  AssetType,
  BackendType,
  getAssetPermissionId,
  getAssetPermissionName,
  isAssetCredential,
  Plan,
  type AnyAsset,
  type Backend,
  type DatalinkId,
} from 'enso-common/src/services/Backend'
import { formatBytes } from 'enso-common/src/utilities/bytes'
import { toReadableIsoString } from 'enso-common/src/utilities/data/dateTime'
import {
  PermissionAction,
  tryFindSelfPermission,
  tryGetOwnerPermission,
} from 'enso-common/src/utilities/permissions'
import { computed, useTemplateRef } from 'vue'
import AssetLabel from './AssetLabel.vue'
import DatalinkConfiguration from './DatalinkConfiguration.vue'
import PermissionDisplay from './PermissionDisplay.vue'
import { datalinkQueryOptions, labelsQueryOptions } from './queries'
import SpotlightOverlay, { SPOTLIGHT_TARGET_STYLE } from './SpotlightOverlay.vue'

const { backend, item, category } = defineProps<{
  backend: Backend
  category: Category
  item: AnyAsset
}>()

/** A section of the tab. */
const SECTION_CLASS =
  'pointer-events-auto flex flex-col items-start gap-side-panel-section rounded-default'
/** A section's heading (react-aria's `Heading`: a plain `h2`). */
const HEADING_CLASS = 'h-side-panel-heading py-side-panel-heading-y text-lg leading-snug'

const rightPanel = useRightPanelData()
const auth = useAuth()
const { getText } = useText()
const showDeveloperIds = useFeatureFlag('showDeveloperIds')
const enableBackgroundRefresh = useFeatureFlag('enableAssetsTableBackgroundRefresh')
const backgroundRefreshInterval = useFeatureFlag('assetsTableBackgroundRefreshInterval')

const spotlightOn = computed(() => rightPanel.context?.spotlightOn)
function closeSpotlight() {
  rightPanel.updateContext({ type: 'drive' }, (ctx) => {
    ctx.spotlightOn = undefined
    return ctx
  })
}
const secretSection = useTemplateRef<HTMLElement>('secretSection')
const datalinkSection = useTemplateRef<HTMLElement>('datalinkSection')

const user = computed(() => auth.session?.user)
const isEnterprise = computed(() => user.value?.plan === Plan.enterprise)
const isTeam = computed(() => category.type === 'team')
const credential = isAssetCredential(item) ? item : undefined
const secret = item.type === AssetType.secret && credential == null ? item : undefined
const datalink = item.type === AssetType.datalink ? item : undefined
const isCloud = backend.type === BackendType.remote

const datalinkQuery = useQuery(
  computed(() =>
    datalinkQueryOptions(
      backend,
      // Only a datalink's query is enabled.
      item.id as DatalinkId,
      item.title,
      {
        enabled: datalink != null,
        refetchInterval: enableBackgroundRefresh.value ? backgroundRefreshInterval.value : false,
      },
    ),
  ),
)
const labelsQuery = useQuery(labelsQueryOptions(backend))
const labels = computed(() => labelsQuery.data.value ?? [])

const self = computed(() =>
  user.value != null ? tryFindSelfPermission(user.value, item.permissions) : undefined,
)
const canEditThisAsset = computed(
  () =>
    self.value?.permission === PermissionAction.own ||
    self.value?.permission === PermissionAction.admin ||
    self.value?.permission === PermissionAction.edit,
)
const createDatalinkMutation = useMutation(backendMutationOptions('createDatalink', backend))
const updateSecretMutation = useMutation(backendMutationOptions('updateSecret', backend))
const ownerPermission = computed(() => tryGetOwnerPermission(item))

/** The labels on the asset that the organization has, in the asset's order. */
const assetLabels = computed(() =>
  (item.labels ?? []).flatMap((value) => {
    const label = labels.value.find((otherLabel) => otherLabel.value === value)
    return label ? [label] : []
  }),
)
/** Who may use the asset: everyone it is shared with, or in the trash only its owner. */
const sharedWith = computed(() =>
  category.type === 'trash' ?
    (item.permissions ?? []).filter((permission) => permission.permission === PermissionAction.own)
  : (item.permissions ?? []),
)
</script>

<template>
  <div class="flex w-full flex-col gap-8">
    <SpotlightOverlay
      v-if="spotlightOn === 'secret'"
      :element="secretSection ?? undefined"
      @close="closeSpotlight"
    />
    <SpotlightOverlay
      v-if="spotlightOn === 'datalink'"
      :element="datalinkSection ?? undefined"
      @close="closeSpotlight"
    />

    <div v-if="isCloud" :class="SECTION_CLASS">
      <h2 :class="HEADING_CLASS">{{ getText('properties') }}</h2>
      <table>
        <tbody>
          <tr data-testid="asset-panel-path" class="h-row">
            <td class="my-auto min-w-side-panel-label p-0">
              <Text>{{ getText('path') }}</Text>
            </td>
            <td class="w-full p-0">
              <div class="flex items-center gap-2">
                <Text class="w-0 grow" truncate="1">{{ item.ensoPath }}</Text>
                <CopyButton :copyText="encodeURI(item.ensoPath)" />
              </div>
            </td>
          </tr>
          <tr v-if="showDeveloperIds" class="h-row">
            <td class="my-auto min-w-side-panel-label p-0">
              <Text color="accent">{{ getText('assetId') }}</Text>
            </td>
            <td class="w-full p-0">
              <div class="flex items-center gap-2">
                <Text color="accent" class="w-0 grow" truncate="1">{{ item.id }}</Text>
                <CopyButton :copyText="item.id" />
              </div>
            </td>
          </tr>
          <tr v-if="showDeveloperIds" class="h-row">
            <td class="my-auto min-w-side-panel-label p-0">
              <Text color="accent">{{ getText('parentId') }}</Text>
            </td>
            <td class="w-full p-0">
              <div class="flex items-center gap-2">
                <Text color="accent" class="w-0 grow" truncate="1">{{ item.parentId }}</Text>
                <CopyButton :copyText="item.parentId" />
              </div>
            </td>
          </tr>
          <tr v-if="ownerPermission" data-testid="asset-panel-owner" class="h-row">
            <td class="min-w-side-panel-label p-0">
              <Text class="inline-block">{{ getText('owner') }}</Text>
            </td>
            <td class="w-full p-0">
              <div class="flex items-center gap-2">
                <Text class="w-0 grow" truncate="1">
                  {{ getAssetPermissionName(ownerPermission) }}
                </Text>
              </div>
            </td>
          </tr>
          <tr v-if="showDeveloperIds && ownerPermission" class="h-row">
            <td class="my-auto min-w-side-panel-label p-0">
              <Text color="accent">{{ getText('ownerId') }}</Text>
            </td>
            <td class="w-full p-0">
              <div class="flex items-center gap-2">
                <Text color="accent" class="w-0 grow" truncate="1">
                  {{ getAssetPermissionId(ownerPermission) }}
                </Text>
                <CopyButton :copyText="getAssetPermissionId(ownerPermission)" />
              </div>
            </td>
          </tr>
          <tr data-testid="asset-panel-modified-at" class="h-row">
            <td class="min-w-side-panel-label p-0">
              <Text class="inline-block">{{ getText('modifiedAt') }}</Text>
            </td>
            <td class="w-full p-0">
              <Text class="grow" truncate="1">
                {{ toReadableIsoString(new Date(item.modifiedAt)) }}
              </Text>
            </td>
          </tr>
          <tr data-testid="asset-panel-created-at" class="h-row">
            <td class="min-w-side-panel-label p-0">
              <Text class="inline-block">{{ getText('createdAt') }}</Text>
            </td>
            <td class="w-full p-0">
              <Text class="grow" truncate="1">
                {{ toReadableIsoString(new Date(item.createdAt)) }}
              </Text>
            </td>
          </tr>
          <tr v-if="item.size != null" data-testid="asset-panel-size" class="h-row">
            <td class="min-w-side-panel-label p-0">
              <Text class="inline-block">{{ getText('sizeColumnName') }}</Text>
            </td>
            <td class="w-full p-0">
              <Text class="grow" truncate="1">{{ formatBytes(item.size) }}</Text>
            </td>
          </tr>
          <tr v-if="isTeam" data-testid="asset-panel-created-by" class="h-row">
            <td class="min-w-side-panel-label p-0">
              <Text class="inline-block">{{ getText('createdByColumnName') }}</Text>
            </td>
            <td class="w-full p-0">
              <Text class="grow" truncate="1">
                <div class="group flex items-center gap-1">
                  <PermissionDisplay v-if="item.createdBy" :action="PermissionAction.own">
                    {{ item.createdBy.name }}
                  </PermissionDisplay>
                </div>
              </Text>
            </td>
          </tr>
          <tr v-if="isEnterprise" data-testid="asset-panel-permissions" class="h-row">
            <td class="my-auto min-w-side-panel-label p-0">
              <Text class="inline-block">{{ getText('sharedWith') }}</Text>
            </td>
            <td class="flex w-full gap-1 p-0">
              <div class="group flex items-center gap-1">
                <PermissionDisplay
                  v-for="(other, index) in sharedWith"
                  :key="getAssetPermissionId(other) + index"
                  :action="other.permission"
                >
                  {{ getAssetPermissionName(other) }}
                </PermissionDisplay>
              </div>
            </td>
          </tr>
          <tr data-testid="asset-panel-labels" class="h-row">
            <td class="my-auto min-w-side-panel-label p-0">
              <Text class="inline-block">{{ getText('labels') }}</Text>
            </td>
            <td class="flex w-full gap-1 p-0">
              <AssetLabel v-for="label in assetLabels" :key="label.value" :color="label.color">
                {{ label.value }}
              </AssetLabel>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div
      v-if="secret != null"
      ref="secretSection"
      :class="SECTION_CLASS"
      :style="SPOTLIGHT_TARGET_STYLE"
    >
      <h2 :class="HEADING_CLASS">{{ getText('configuration') }}</h2>
      <UpsertSecretForm
        :key="item.id"
        cancel="reset"
        :secretId="secret.id"
        :name="secret.title"
        @create="
          (title, value) => updateSecretMutation.mutateAsync([secret!.id, { title, value }, title])
        "
      />
    </div>

    <div
      v-if="credential != null"
      ref="secretSection"
      :class="SECTION_CLASS"
      :style="SPOTLIGHT_TARGET_STYLE"
    >
      <h2 :class="HEADING_CLASS">{{ getText('configuration') }}</h2>
      <table>
        <tbody>
          <tr class="h-row">
            <td class="my-auto min-w-side-panel-label p-0">
              <Text>{{ getText('credentialServiceName') }}</Text>
            </td>
            <td class="w-full p-0">
              <div class="flex items-center gap-2">
                <Text class="w-0 grow" truncate="1">
                  {{ credential.credentialMetadata.serviceName }}
                </Text>
              </div>
            </td>
          </tr>
          <tr class="h-row">
            <td class="my-auto min-w-side-panel-label p-0">
              <Text>{{ getText('credentialState') }}</Text>
            </td>
            <td class="w-full p-0">
              <div class="flex items-center gap-2">
                <Text class="w-0 grow" truncate="1">
                  {{ getText(`credentialState${credential.credentialMetadata.state}`) }}
                </Text>
              </div>
            </td>
          </tr>
          <tr v-if="credential.credentialMetadata.expirationDate" class="h-row">
            <td class="my-auto min-w-side-panel-label p-0">
              <Text>{{ getText('credentialExpiresAt') }}</Text>
            </td>
            <td class="w-full p-0">
              <div class="flex items-center gap-2">
                <Text class="w-0 grow" truncate="1">
                  {{ toReadableIsoString(new Date(credential.credentialMetadata.expirationDate)) }}
                </Text>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div
      v-if="datalink != null"
      ref="datalinkSection"
      :class="SECTION_CLASS"
      :style="SPOTLIGHT_TARGET_STYLE"
    >
      <h2 :class="HEADING_CLASS">{{ getText('configuration') }}</h2>
      <div v-if="datalinkQuery.isLoading.value" class="grid place-items-center self-stretch">
        <StatelessSpinner :size="48" phase="loading-medium" />
      </div>
      <DatalinkConfiguration
        v-else
        :datalink="datalinkQuery.data.value"
        :canEdit="canEditThisAsset"
        :onSubmit="
          async (value) => {
            await createDatalinkMutation.mutateAsync([
              {
                datalinkId: datalink!.id,
                name: datalink!.title,
                parentDirectoryId: datalink!.parentId,
                value,
              },
            ])
          }
        "
      />
    </div>
  </div>
</template>
