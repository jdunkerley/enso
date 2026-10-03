<script setup lang="ts">
/**
 * @file The Enso devtools panel (#172): the floating Enso button at the bottom left, and the popover
 * it opens. The Vue counterpart of React's `EnsoDevtools` (`EnsoDevtoolsImpl.tsx`), with the same
 * sections in the same order:
 *
 * - "Hide Devtools", and "Clear cache and reload" (the query cache and its persisted copy);
 * - the user's plan, overridden through the `developerPlanOverride` feature flag (signed in only);
 * - the version checker, which development builds do not run unless forced here;
 * - the feature flags, each written as soon as it changes to a valid value;
 * - the paywall features, each forced on or left to the plan (a half-way switch is one the plan
 *   itself unlocks);
 * - the local storage viewer and editor (`LocalStorageSection.vue`).
 *
 * The forms are created as the popover opens, from the current values, as in React.
 */
import Button from '$/components/Button/Button.vue'
import Popover from '$/components/Dialog/Popover.vue'
import { DIALOG_BACKGROUND } from '$/components/Dialog/variants'
import Form from '$/components/Form/Form.vue'
import Input from '$/components/Inputs/Input.vue'
import Radio from '$/components/Radio/Radio.vue'
import RadioGroup from '$/components/Radio/RadioGroup.vue'
import Separator from '$/components/Separator/Separator.vue'
import Switch from '$/components/Switch/Switch.vue'
import Text from '$/components/Text/Text.vue'
import { useIsFeatureUnderPaywall } from '$/composables/paywall'
import {
  getFeatureConfiguration,
  PAYWALL_FEATURES,
  type PaywallFeatureName,
} from '$/composables/paywall/FeaturesConfiguration'
import { useAuth } from '$/providers/auth'
import { useDevtoolsStore } from '$/providers/devTools'
import {
  FEATURE_FLAGS_SCHEMA,
  flagsStore,
  setFeatureFlag,
  type FeatureFlags,
} from '$/providers/featureFlags'
import { useText } from '$/providers/text'
import { useQueryClient } from '@tanstack/vue-query'
import { isPlan, Plan } from 'enso-common/src/services/Backend'
import { unsafeKeys } from 'enso-common/src/utilities/data/object'
import { IS_DEV_MODE } from 'enso-common/src/utilities/detect'
import { z } from 'zod'
import LocalStorageSection from './LocalStorageSection.vue'

const { getText } = useText()
const auth = useAuth()
const queryClient = useQueryClient()
const devtools = useDevtoolsStore()
const isFeatureUnderPaywall = useIsFeatureUnderPaywall()

const PLANS = [Plan.free, Plan.solo, Plan.team, Plan.enterprise] as const
const PAYWALL_FEATURE_NAMES = unsafeKeys(PAYWALL_FEATURES)

/** The feature flags set with a number input, after the switches. */
const NUMBER_FLAGS = [
  {
    name: 'listDirectoryPageSize',
    label: 'ensoDevtoolsFeatureFlags.listDirectoryPageSize',
    description: 'ensoDevtoolsFeatureFlags.listDirectoryPageSizeDescription',
  },
  {
    name: 'getLogEventsPageSize',
    label: 'ensoDevtoolsFeatureFlags.getLogEventsPageSize',
    description: 'ensoDevtoolsFeatureFlags.getLogEventsPageSizeDescription',
  },
  {
    name: 'fileChunkUploadPoolSize',
    label: 'ensoDevtoolsFeatureFlags.fileChunkUploadPoolSize',
    description: 'ensoDevtoolsFeatureFlags.fileChunkUploadPoolSizeDescription',
  },
] as const

async function clearCacheAndReload() {
  await queryClient.clearWithPersister()
  location.reload()
}

function onPlanChange(_name: string, value: unknown) {
  if (isPlan(value)) setFeatureFlag('developerPlanOverride', value)
}

function featureFlagDefaults() {
  const flags = flagsStore.getState().featureFlags
  return Object.fromEntries(unsafeKeys(FEATURE_FLAGS_SCHEMA.shape).map((key) => [key, flags[key]]))
}

/** Write a feature flag as soon as it changes, unless the new value is invalid (an emptied number). */
function onFeatureFlagChange(name: string, value: unknown) {
  if (!(name in FEATURE_FLAGS_SCHEMA.shape)) return
  const key = name as keyof FeatureFlags
  const parsed = FEATURE_FLAGS_SCHEMA.shape[key].safeParse(value)
  if (parsed.success) setFeatureFlag(key, parsed.data)
}

const paywallSchema = z.object(
  Object.fromEntries(PAYWALL_FEATURE_NAMES.map((feature) => [feature, z.boolean()])),
)

function paywallDefaults() {
  return Object.fromEntries(
    PAYWALL_FEATURE_NAMES.map((feature) => [
      feature,
      devtools.paywallFeatures[feature].isForceEnabled ?? false,
    ]),
  )
}

function onPaywallFeatureChange(name: string, value: unknown) {
  // On means forced on; off leaves the feature to the plan, as in React.
  devtools.setPaywallFeature(name as PaywallFeatureName, value === true ? true : null)
}
</script>

<template>
  <div :class="DIALOG_BACKGROUND({ className: 'fixed bottom-3 left-3 z-50 rounded-full' })">
    <!-- React's popover was as tall as the window let it be, and scrolled; Reka's is as tall as its
    content unless limited. -->
    <Popover
      testId="enso-devtools"
      :aria-label="getText('ensoDevtoolsPopoverHeading')"
      class="max-h-[var(--reka-popover-content-available-height)] overflow-y-auto"
    >
      <template #trigger>
        <Button
          icon="enso_logo"
          :aria-label="getText('ensoDevtoolsButtonLabel')"
          variant="icon"
          rounded="full"
          size="hero"
          data-ignore-click-outside
        />
      </template>

      <div class="flex items-center justify-between">
        <Text elementType="h1" variant="h1" balance disableLineHeightCompensation>
          {{ getText('ensoDevtoolsPopoverHeading') }}
        </Text>
        <Button variant="icon" @press="devtools.showEnsoDevtools = !devtools.showEnsoDevtools">
          {{ getText('hideDevtools') }}
        </Button>
      </div>

      <Separator orientation="horizontal" class="my-3" />

      <Button variant="outline" @press="clearCacheAndReload">
        {{ getText('clearCacheAndReload') }}
      </Button>

      <Separator orientation="horizontal" class="my-3" />

      <template v-if="auth.session != null">
        <Text variant="subtitle">{{ getText('ensoDevtoolsPlanSelectSubtitle') }}</Text>
        <Form
          gap="small"
          :schema="(schema) => schema.object({ plan: schema.nativeEnum(Plan) })"
          :defaultValues="{ plan: auth.session.user.plan }"
          :onChange="onPlanChange"
        >
          <RadioGroup name="plan">
            <Radio v-for="plan in PLANS" :key="plan" :value="plan" :label="getText(plan)" />
          </RadioGroup>
          <Button
            size="small"
            variant="outline"
            @press="setFeatureFlag('developerPlanOverride', undefined)"
          >
            {{ getText('reset') }}
          </Button>
        </Form>

        <Separator orientation="horizontal" class="my-3" />
      </template>

      <Text variant="subtitle" class="mb-2">{{ getText('productionOnlyFeatures') }}</Text>
      <Form
        :schema="(schema) => schema.object({ enableVersionChecker: schema.boolean() })"
        :defaultValues="{ enableVersionChecker: devtools.showVersionChecker ?? !IS_DEV_MODE }"
        :onChange="(_name, value) => (devtools.showVersionChecker = value === true)"
      >
        <Switch
          name="enableVersionChecker"
          :label="getText('enableVersionChecker')"
          :description="getText('enableVersionCheckerDescription')"
        />
      </Form>

      <Separator orientation="horizontal" class="my-3" />

      <Text variant="subtitle" class="mb-2">{{ getText('ensoDevtoolsFeatureFlags') }}</Text>
      <Form
        gap="small"
        :schema="FEATURE_FLAGS_SCHEMA"
        :formOptions="{ mode: 'onChange' }"
        :defaultValues="featureFlagDefaults"
        :onChange="onFeatureFlagChange"
        testId="devtools-feature-flags"
      >
        <Switch
          name="debugHoverAreas"
          label="Debug hover areas"
          description="Make all mouse hoverable areas visible on the graph."
        />
        <Switch
          name="showDeveloperIds"
          :label="getText('ensoDevtoolsFeatureFlags.showDeveloperIds')"
          :description="getText('ensoDevtoolsFeatureFlags.showDeveloperIdsDescription')"
        />
        <Switch
          name="enableMultitabs"
          :label="getText('ensoDevtoolsFeatureFlags.enableMultitabs')"
          :description="getText('ensoDevtoolsFeatureFlags.enableMultitabsDescription')"
        />
        <div>
          <Switch
            name="enableAssetsTableBackgroundRefresh"
            :label="getText('ensoDevtoolsFeatureFlags.enableAssetsTableBackgroundRefresh')"
            :description="
              getText('ensoDevtoolsFeatureFlags.enableAssetsTableBackgroundRefreshDescription')
            "
          />
          <Input
            type="number"
            inputmode="numeric"
            name="assetsTableBackgroundRefreshInterval"
            :label="getText('ensoDevtoolsFeatureFlags.assetsTableBackgroundRefreshInterval')"
            :description="
              getText('ensoDevtoolsFeatureFlags.assetsTableBackgroundRefreshIntervalDescription')
            "
          />
          <Switch
            name="unsafeDarkTheme"
            label="Developer Dark Theme"
            description="Enable quick-and-dirty dark theme for developer use only"
          />
        </div>
        <Switch
          name="enableCloudExecution"
          label="Enable Cloud Execution"
          description="Enable Cloud Execution"
        />
        <Switch
          name="enableAdvancedProjectExecutionOptions"
          label="Enable Advanced Project Execution Options"
          description="Enable Advanced Project Execution Options"
        />
        <Input
          v-for="flag in NUMBER_FLAGS"
          :key="flag.name"
          type="number"
          inputmode="numeric"
          :name="flag.name"
          :label="getText(flag.label)"
          :description="getText(flag.description)"
        />
      </Form>

      <Separator orientation="horizontal" class="my-3" />

      <Text variant="subtitle" class="mb-2">
        {{ getText('ensoDevtoolsPaywallFeaturesToggles') }}
      </Text>
      <Form
        gap="small"
        :schema="paywallSchema"
        :defaultValues="paywallDefaults"
        :onChange="onPaywallFeatureChange"
        testId="devtools-paywall-features"
      >
        <Switch
          v-for="feature in PAYWALL_FEATURE_NAMES"
          :key="feature"
          :name="feature"
          :label="getText(getFeatureConfiguration(feature).label)"
          :description="getText(getFeatureConfiguration(feature).descriptionTextId)"
          :halfway="!isFeatureUnderPaywall(feature, true)"
        />
      </Form>

      <Separator orientation="horizontal" class="my-3" />

      <LocalStorageSection />
    </Popover>
  </div>
</template>
