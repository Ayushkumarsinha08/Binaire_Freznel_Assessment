import { Button, Flex, Text, View } from '@adobe/react-spectrum'

type EmptyStateProps = {
  title: string
  description?: string
  actionLabel?: string
  onAction?: () => void
}

export default function EmptyState({
  title,
  description,
  actionLabel = 'Add Images',
  onAction,
}: EmptyStateProps) {
  return (
    <View width="100%" height="100%" UNSAFE_className="empty-state-panel">
      <Flex
        direction="column"
        justifyContent="center"
        alignItems="center"
        gap="size-200"
        height="100%"
      >
        <View UNSAFE_className="empty-state-icon" aria-hidden="true">
          <Text>◌</Text>
        </View>
        <Text UNSAFE_className="empty-state-title">{title}</Text>
        {description ? (
          <Text UNSAFE_className="empty-state-description">{description}</Text>
        ) : null}
        {actionLabel ? (
          <Button variant="accent" onPress={onAction}>
            {actionLabel}
          </Button>
        ) : null}
      </Flex>
    </View>
  )
}
