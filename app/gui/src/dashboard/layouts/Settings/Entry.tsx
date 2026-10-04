/** @file Rendering for a {@link SettingsEntryData}. */
import { SettingsCustomEntry } from './CustomEntry'
import type { SettingsContext, SettingsEntryData } from './data'

/** Props for a {@link SettingsEntry}. */
export interface SettingsEntryProps {
  readonly context: SettingsContext
  readonly data: SettingsEntryData
}

/** Rendering for a {@link SettingsEntryData}. */
export default function SettingsEntry(props: SettingsEntryProps) {
  const { context, data } = props
  return <SettingsCustomEntry context={context} data={data} />
}
