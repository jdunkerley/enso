/** @file Common types for WAI-ARIA components. */
import type { Icon as PossibleIcon } from '@/util/iconMetadata/iconName'
import type { ReactElement } from 'react'
export type { Placement } from 'react-aria'

/** Props for adding a test id to a component */
export interface TestIdProps {
  /** @deprecated Use `testId` instead. */
  readonly 'data-testid'?: string | undefined
  readonly testId?: string | undefined
}

/**
 * Any icon: an `icons.svg` name or an element.
 *
 * `_Icon` is vestigial: it used to widen the prop to the URLs of standalone SVG files, and is
 * kept only so that the components which thread it through (`ButtonProps<IconType>`, ...) need no
 * change.
 */
export type IconProp<_Icon extends string = string, Render = never> = IconPropSvgUse<Render>

/** The possible return values for an icon. */
export type AvailableIconReturn = ReactElement | SvgUseIcon | false | null | undefined

/** Generic type for imported from figma icons. */
export type IconPropSvgUse<Render> = AvailableIconReturn | ((render: Render) => AvailableIconReturn)

/** Any icon imported from Figma. */
export type SvgUseIcon = PossibleIcon

/** Any addon. */
export type Addon<Render> =
  | ReactElement
  | string
  | false
  | ((render: Render) => ReactElement | string | false | null | undefined)
  | null
  | undefined
