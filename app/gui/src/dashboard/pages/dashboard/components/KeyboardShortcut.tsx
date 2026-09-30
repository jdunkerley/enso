/** @file A visual representation of a keyboard shortcut. */
import { Icon } from '#/components/Icon'
import { Text } from '#/components/Text'
import { useInputBindings } from '#/providers/InputBindingsProvider'
import type { DashboardBindingKey } from '$/configurations/inputBindings'
import { useText } from '$/providers/react'
import type { GetText } from '$/providers/text'
import { toModifierKey } from '$/utils/inputBindings'
import { twMerge } from '$/utils/style/tailwindMerge'
import { type ModifierKey, parseKeybindString } from '@/util/shortcuts'
import type * as text from 'enso-common/src/text'
import * as detect from 'enso-common/src/utilities/detect'
import * as React from 'react'

/** The size (both width and height) and offset of key icons. */
const ICON_CLASS_NAME = 'h-[1.5cap] w-[1.5cap] mt-[0.1cap]'

/** Props for values of {@link MODIFIER_JSX}. */
interface InternalModifierProps {
  readonly getText: GetText
}

/** Icons for modifier keys (if they exist). */
const MODIFIER_JSX: Readonly<
  Record<
    detect.Platform,
    Partial<Record<ModifierKey, (props: InternalModifierProps) => React.ReactNode>>
  >
> = {
  // The names are intentionally not in `camelCase`, as they are case-sensitive.
  /* eslint-disable @typescript-eslint/naming-convention */
  [detect.Platform.macOS]: {
    Meta: () => <Icon className={ICON_CLASS_NAME} key="Meta" icon="keyboard_command" />,
    Shift: () => <Icon className={ICON_CLASS_NAME} key="Shift" icon="keyboard_shift" />,
    Alt: () => <Icon className={ICON_CLASS_NAME} key="Alt" icon="keyboard_option" />,
    Ctrl: () => <Icon className={ICON_CLASS_NAME} key="Ctrl" icon="chevron_up" />,
  },
  [detect.Platform.windows]: {
    Meta: () => <Icon className={ICON_CLASS_NAME} key="Meta" icon="keyboard_windows" />,
  },
  [detect.Platform.linux]: {
    Meta: (props) => (
      <Text key="Meta" className="text">
        {props.getText('superModifier')}
      </Text>
    ),
  },
  [detect.Platform.unknown]: {
    // Assume the system is Unix-like and calls the key that triggers `event.metaKey`
    // the "Super" key.
    Meta: (props) => (
      <Text key="Meta" className="text">
        {props.getText('superModifier')}
      </Text>
    ),
  },
  [detect.Platform.iPhoneOS]: {},
  [detect.Platform.android]: {},
  [detect.Platform.windowsPhone]: {},
  /* eslint-enable @typescript-eslint/naming-convention */
}

const KEY_CHARACTER: Readonly<Record<string, string>> = {
  // The names come from a third-party API (the DOM spec) and cannot be changed.
  /* eslint-disable @typescript-eslint/naming-convention */
  ArrowDown: '↓',
  ArrowUp: '↑',
  ArrowLeft: '←',
  ArrowRight: '→',
  /* eslint-enable @typescript-eslint/naming-convention */
}

const MODIFIER_TO_TEXT_ID: Readonly<Record<ModifierKey, text.TextId>> = {
  // The names come from a third-party API and cannot be changed.
  /* eslint-disable @typescript-eslint/naming-convention */
  Ctrl: 'ctrlModifier',
  Alt: 'altModifier',
  Meta: 'metaModifier',
  Shift: 'shiftModifier',
  /* eslint-enable @typescript-eslint/naming-convention */
} satisfies { [K in ModifierKey]: `${Lowercase<K>}Modifier` }

/** Props for a {@link KeyboardShortcut}, specifying the keyboard action. */
export interface KeyboardShortcutActionProps {
  readonly action: DashboardBindingKey
  readonly className?: string
}

/** Props for a {@link KeyboardShortcut}, specifying the shortcut string. */
export interface KeyboardShortcutShortcutProps {
  readonly shortcut: string
  readonly className?: string
}

/** Props for a {@link KeyboardShortcut}. */
export type KeyboardShortcutProps = KeyboardShortcutActionProps | KeyboardShortcutShortcutProps

/** A visual representation of a keyboard shortcut. */
export default function KeyboardShortcut(props: KeyboardShortcutProps) {
  const { className } = props
  const { getText } = useText()
  const inputBindings = useInputBindings()
  const shortcutString =
    'shortcut' in props ? props.shortcut : inputBindings.metadata[props.action].bindings[0]

  if (shortcutString == null) {
    return null
  } else {
    const shortcut = parseKeybindString(shortcutString).info
    const modifiers = shortcut.modifiers.map(toModifierKey)
    return (
      <div
        className={twMerge(
          'flex items-center',
          className,
          detect.isOnMacOS() ? 'gap-[3px]' : 'gap-0.5',
        )}
      >
        {modifiers.map(
          (modifier) =>
            MODIFIER_JSX[detect.platform()][modifier]?.({ getText }) ?? (
              <Text key={modifier}>{getText(MODIFIER_TO_TEXT_ID[modifier])}</Text>
            ),
        )}
        <Text>
          {shortcut.key === ' ' ? 'Space' : (KEY_CHARACTER[shortcut.key] ?? shortcut.key)}
        </Text>
      </div>
    )
  }
}
