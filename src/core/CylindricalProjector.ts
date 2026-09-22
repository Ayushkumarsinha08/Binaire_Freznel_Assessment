import type { DecodedImage } from '../types'

export type CylindricalImage = {
  width: number
  height: number
  data: Uint8Array
  mask: Uint8Array
}

export class CylindricalProjector {
  private readonly focalLengthFactor: number

  constructor(focalLengthFactor = 0.8) {
    this.focalLengthFactor = focalLengthFactor
  }

  project(image: DecodedImage): CylindricalImage {
    const { width, height } = image
    const focalLength = width * this.focalLengthFactor
    const centerX = width / 2
    const centerY = height / 2
    const data = new Uint8Array(width * height * 4)
    const mask = new Uint8Array(width * height)

    console.log({
      sourceWidth: width,
      sourceHeight: height,
      projectedWidth: width,
      projectedHeight: height,
      focalLength,
    })

    for (let destinationY = 0; destinationY < height; destinationY += 1) {
      for (let destinationX = 0; destinationX < width; destinationX += 1) {
        const theta = (destinationX - centerX) / focalLength
        const sourceX = centerX + focalLength * Math.tan(theta)
        const sourceY = centerY + (destinationY - centerY) * Math.cos(theta)
        const sourceX0 = Math.floor(sourceX)
        const sourceY0 = Math.floor(sourceY)
        const sourceX1 = sourceX0 + 1
        const sourceY1 = sourceY0 + 1

        if (
          sourceX0 < 0 ||
          sourceY0 < 0 ||
          sourceX1 >= width ||
          sourceY1 >= height
        ) {
          continue
        }

        const xWeight = sourceX - sourceX0
        const yWeight = sourceY - sourceY0
        const destinationIndex = (destinationY * width + destinationX) * 4
        const topLeft = (sourceY0 * width + sourceX0) * 4
        const topRight = (sourceY0 * width + sourceX1) * 4
        const bottomLeft = (sourceY1 * width + sourceX0) * 4
        const bottomRight = (sourceY1 * width + sourceX1) * 4

        for (let channel = 0; channel < 4; channel += 1) {
          const top = image.data[topLeft + channel] * (1 - xWeight) + image.data[topRight + channel] * xWeight
          const bottom = image.data[bottomLeft + channel] * (1 - xWeight) + image.data[bottomRight + channel] * xWeight
          data[destinationIndex + channel] = Math.round(top * (1 - yWeight) + bottom * yWeight)
        }
        const sourceAlpha = (
          image.data[topLeft + 3] * (1 - xWeight) + image.data[topRight + 3] * xWeight
          + image.data[bottomLeft + 3] * (1 - xWeight) + image.data[bottomRight + 3] * xWeight
        ) / 2
        if (sourceAlpha >= 254) {
          mask[destinationY * width + destinationX] = 255
        }
      }
    }

    return { width, height, data, mask }
  }
}
