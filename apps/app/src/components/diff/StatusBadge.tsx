import type { FC } from 'react'
import { Badge, type BadgeProps } from '@pikku/mantine/core'
import { verdictOf } from './status'

/** A verdict, in the colour it has on every screen. */
export const StatusBadge: FC<{ status: string; size?: BadgeProps['size']; testId?: string }> = ({
  status,
  size = 'sm',
  testId,
}) => {
  const verdict = verdictOf(status)
  return (
    <Badge
      size={size}
      color={verdict.color}
      variant="light"
      data-testid={testId}
      data-status={status}
      style={{ flex: 'none' }}
    >
      {verdict.label()}
    </Badge>
  )
}
