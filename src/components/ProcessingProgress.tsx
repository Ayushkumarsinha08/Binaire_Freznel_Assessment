import { ProgressBar, Text, View } from '@adobe/react-spectrum'

type ProcessingProgressProps = {
  isVisible: boolean
  progress: number
  message: string
}

export default function ProcessingProgress({
  isVisible,
  progress,
  message,
}: ProcessingProgressProps) {
  if (!isVisible) {
    return null
  }

  return (
    <View width="100%" UNSAFE_className="processing-panel">
      <Text UNSAFE_className="progress-label">{message}</Text>
      <ProgressBar value={progress} label={message} size="L" />
    </View>
  )
}
