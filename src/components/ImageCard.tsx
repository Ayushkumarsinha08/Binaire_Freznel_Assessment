import { ActionButton, Flex, Text, View } from '@adobe/react-spectrum'
import { useEffect, useState, type SyntheticEvent } from 'react'

import type { ImageItem } from '../types'

type ImageCardProps = {
  image: ImageItem
  index: number
  onRemove: (id: string) => void
}

export default function ImageCard({ image, index, onRemove }: ImageCardProps) {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null)
  const [thumbnailFailed, setThumbnailFailed] = useState(false)

  useEffect(() => {
    let isCurrent = true

    setThumbnailUrl(null)
    setThumbnailFailed(false)

    void window.electronAPI.getImageThumbnail(image.path).then((url) => {
      if (isCurrent) {
        setThumbnailUrl(url)
        setThumbnailFailed(!url)
      }
    })

    return () => {
      isCurrent = false
    }
  }, [image.path])

  const handleThumbnailError = (_event: SyntheticEvent<HTMLImageElement>) => {
    setThumbnailFailed(true)
  }

  return (
    <View UNSAFE_className="image-card">
      <div className="image-card-thumb-fallback">
        {thumbnailUrl && !thumbnailFailed ? (
          <img
            className="image-card-thumb"
            src={thumbnailUrl}
            alt={`${image.name} thumbnail`}
            onError={handleThumbnailError}
          />
        ) : (
          <span className="thumbnail-failure">{thumbnailFailed ? 'Preview unavailable' : 'Loading preview...'}</span>
        )}
      </div>
      <Flex direction="column" justifyContent="space-between" gap="size-50" UNSAFE_className="image-card-body">
        <Text UNSAFE_className="image-card-index">#{index + 1}</Text>
        <Text UNSAFE_className="image-card-name">{image.name}</Text>
        <ActionButton
          aria-label={`Remove ${image.name}`}
          onPress={() => onRemove(image.id)}
          isQuiet
          UNSAFE_className="image-card-remove"
        >
          Remove
        </ActionButton>
      </Flex>
    </View>
  )
}
