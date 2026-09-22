import { ActionButton, Button, Flex, Text, View } from '@adobe/react-spectrum'

import type { ImageItem } from '../types'
import ImageCard from './ImageCard'

type ImageTrayProps = {
  images: ImageItem[]
  errorMessage?: string
  onAddImages: () => void
  onClearImages: () => void
  onRemoveImage: (id: string) => void
}

export default function ImageTray({
  images,
  errorMessage,
  onAddImages,
  onClearImages,
  onRemoveImage,
}: ImageTrayProps) {
  return (
    <View UNSAFE_className="images-panel">
      {images.length === 0 ? (
        <Flex
          direction="column"
          gap="size-200"
          alignItems="center"
          justifyContent="center"
          UNSAFE_className="images-empty"
        >
          <Text UNSAFE_className="empty-text">No images selected</Text>
          <Button variant="accent" onPress={onAddImages}>
            Add Images
          </Button>
        </Flex>
      ) : (
        <>
          <Flex gap="size-200" wrap="wrap" UNSAFE_className="image-list">
            {images.map((image, index) => (
              <ImageCard key={image.id} image={image} index={index} onRemove={onRemoveImage} />
            ))}
            <ActionButton aria-label="Add images" onPress={onAddImages} UNSAFE_className="add-button-card">
              <Flex direction="column" justifyContent="center" alignItems="center" gap="size-100">
                <Text UNSAFE_className="add-icon">+</Text>
                <Text>Add Images</Text>
              </Flex>
            </ActionButton>
          </Flex>
          <Button variant="secondary" onPress={onClearImages} UNSAFE_className="clear-images-button">
            Clear All
          </Button>
        </>
      )}
      {errorMessage ? <Text UNSAFE_className="image-error-message">{errorMessage}</Text> : null}
    </View>
  )
}
