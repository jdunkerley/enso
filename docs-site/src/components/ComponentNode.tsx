/**
 * @file A function drawn as a graph-editor node. Each pill is a button whose tooltip shows on hover
 * (and while the pointer is over the tooltip), on keyboard focus, and on tap (a tap toggles it;
 * tapping elsewhere closes it); Escape closes it (WCAG 1.4.13). Before hydration, or without
 * JavaScript, CSS shows the tooltips on hover and focus.
 */
import useBaseUrl from '@docusaurus/useBaseUrl'
import type { ComponentNodeProps } from '@site/generator/src/componentNode'
import { useEffect, useId, useRef, useState, type CSSProperties, type JSX } from 'react'
import styles from './ComponentNode.module.css'

function Pill(props: { className: string; text: string; tooltip: string }): JSX.Element {
  const id = useId()
  const wrapper = useRef<HTMLSpanElement>(null)
  const [hydrated, setHydrated] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const open = !dismissed && (hovered || focused || pinned)

  useEffect(() => setHydrated(true), [])
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDismissed(true)
        setPinned(false)
      }
    }
    const onPointer = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setPinned(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [open])

  return (
    <span
      ref={wrapper}
      className={styles.pill}
      onPointerEnter={(event) => {
        if (event.pointerType !== 'mouse') return
        setDismissed(false)
        setHovered(true)
      }}
      onPointerLeave={() => setHovered(false)}
    >
      <button
        type="button"
        className={props.className}
        aria-describedby={id}
        onFocus={() => {
          setDismissed(false)
          setFocused(true)
        }}
        onBlur={() => setFocused(false)}
        onClick={() => {
          setDismissed(false)
          setPinned((was) => !was)
        }}
      >
        {props.text}
      </button>
      <span
        role="tooltip"
        id={id}
        className={styles.tooltip}
        data-open={hydrated ? String(open) : undefined}
      >
        {props.tooltip}
      </span>
    </span>
  )
}

/** The node at the top of a function page (`large`) or in a list of functions (`small`). */
export default function ComponentNode(props: ComponentNodeProps): JSX.Element {
  const iconHref = useBaseUrl(`/img/icons.svg#${props.icon}`)
  return (
    <div
      role="group"
      aria-label={props.label}
      className={`${styles.node} ${props.size === 'small' ? styles.small : ''}`}
      style={{ '--node-color': props.color } as CSSProperties}
    >
      <svg className={styles.icon} aria-hidden="true">
        <use href={iconHref} />
      </svg>
      <Pill className={styles.name!} text={props.name} tooltip={props.returns} />
      {props.params.map((param) => (
        <Pill
          key={param.name}
          className={`${styles.param} ${param.optional ? styles.optional : ''}`}
          text={param.name}
          tooltip={param.tooltip}
        />
      ))}
    </div>
  )
}
