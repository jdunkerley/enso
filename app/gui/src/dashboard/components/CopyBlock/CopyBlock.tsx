/** @file A block of text with a copy button. */
import { useCopy } from '#/hooks/copyHooks'
import { COPY_BLOCK_STYLES } from '$/components/CopyBlock/variants'
import { useText } from '$/providers/react'
import type { VariantProps } from '$/utils/style/tailwindVariants'
import type { ReactNode } from 'react'
import { Button } from '../Button'

/** Props for a {@link CopyBlock}. */
export interface CopyBlockProps extends VariantProps<typeof COPY_BLOCK_STYLES> {
  readonly title?: ReactNode
  readonly copyText: string
  readonly className?: string
  readonly onCopy?: () => void
}

/** A block of text with a copy button. */
export function CopyBlock(props: CopyBlockProps) {
  const { copyText, className, onCopy = () => {}, variants = COPY_BLOCK_STYLES } = props

  const { getText } = useText()
  const { mutateAsync, isSuccess } = useCopy({ onCopy })

  const styles = variants()

  return (
    <Button
      variant="custom"
      size="custom"
      onPress={() => mutateAsync(copyText)}
      tooltip={isSuccess ? getText('copied') : getText('copy')}
      className={styles.base({ className })}
    >
      <span className={styles.copyTextBlock()}>{copyText}</span>
    </Button>
  )
}
