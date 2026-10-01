/** @file A component that adds scroll shadows to a container. */
import type { TestIdProps } from '#/components/types'
import { useEventCallback } from '#/hooks/eventCallbackHooks'
import { useEventListener } from '#/hooks/eventListenerHooks'
import { useMeasureCallback } from '#/hooks/measureHooks'
import { mergeRefs } from '#/utilities/mergeRefs'
import { SCROLLER_STYLES } from '$/components/Scroller/variants'
import type { VariantProps } from '$/utils/style/tailwindVariants'
import {
  forwardRef,
  startTransition,
  useCallback,
  useRef,
  useState,
  type ForwardedRef,
  type HTMLAttributes,
  type PropsWithChildren,
} from 'react'

/** Props for {@link Scroller}. */
export interface ScrollerProps
  extends
    HTMLAttributes<HTMLDivElement>,
    PropsWithChildren,
    TestIdProps,
    Omit<VariantProps<typeof SCROLLER_STYLES>, 'endHidden' | 'startHidden'> {
  readonly shadowStartClassName?: string
}

/** A component that adds scroll shadows to a container. */
export const Scroller = forwardRef(function ScrollerImpl(
  props: ScrollerProps,
  ref: ForwardedRef<HTMLDivElement>,
) {
  const {
    className,
    shadowStartClassName,
    scrollbar = false,
    snap = false,
    variants = SCROLLER_STYLES,
    orientation = 'horizontal',
    showShadows = true,
    testId,
    onScroll,
    background = 'primary',
    fullSize,
    ...rest
  } = props

  const containerRef = useRef<HTMLDivElement>(null)

  const [startHidden, setStartHidden] = useState(true)
  const [endHidden, setEndHidden] = useState(true)

  const setHidden = useEventCallback((start: boolean, end: boolean) => {
    startTransition(() => {
      setStartHidden(start)
      setEndHidden(end)
    })
  })

  const calculateShadows = useEventCallback((element: HTMLDivElement) => {
    const { scrollLeft, clientWidth, scrollTop, clientHeight, scrollWidth, scrollHeight } = element

    const scrollStart = orientation === 'horizontal' ? scrollLeft : scrollTop
    const size = orientation === 'horizontal' ? clientWidth : clientHeight
    const scrollSize = orientation === 'horizontal' ? scrollWidth : scrollHeight

    const isAtStart = scrollStart === 0
    const isAtEnd = Math.ceil(scrollStart + size) >= scrollSize

    return { isAtStart, isAtEnd }
  })

  const updateShadows = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el) return
      const { isAtStart, isAtEnd } = calculateShadows(el)
      setHidden(isAtStart, isAtEnd)
    },
    [calculateShadows, setHidden],
  )

  const [measureRef] = useMeasureCallback({
    isDisabled: !showShadows,
    onResize: () => {
      updateShadows(containerRef.current)
    },
  })

  useEventListener(
    'scroll',
    () => {
      updateShadows(containerRef.current)
    },
    containerRef,
    { passive: true, isDisabled: !showShadows },
  )

  const styles = variants({
    scrollbar,
    snap,
    orientation,
    startHidden,
    endHidden,
    showShadows,
    background,
    fullSize,
  })

  return (
    <div className={styles.base({ className })} data-testid={testId} {...rest}>
      <div
        ref={(el) => {
          mergeRefs(ref, updateShadows, measureRef, containerRef)(el)
        }}
        onScroll={onScroll}
        className={styles.content()}
      >
        {props.children}
      </div>

      <div aria-hidden className={styles.shadowStart({ className: shadowStartClassName })} />
      <div aria-hidden className={styles.shadowEnd()} />
    </div>
  )
})

export { SCROLLER_STYLES } from '$/components/Scroller/variants'
