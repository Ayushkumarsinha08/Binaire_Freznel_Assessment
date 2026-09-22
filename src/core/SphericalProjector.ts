import type { DecodedImage } from '../types'
import type { CylindricalImage } from './CylindricalProjector'

export interface PanoramaProjector {
  project(image: DecodedImage): CylindricalImage
}

export class SphericalProjector implements PanoramaProjector {
  private readonly focalScale: number

  constructor(focalScale = 0.8) {
    this.focalScale = focalScale
  }

  project(image: DecodedImage): CylindricalImage {
    const { width, height } = image
    const source = image.data
    const focal = this.focalScale * width
    const centerX = width / 2
    const centerY = height / 2

    // Extent of the image on the sphere: theta = atan(x / f), phi = atan(y / f) at the image centre column.
    const outWidth = Math.max(1, Math.ceil(2 * focal * Math.atan(centerX / focal)))
    const outHeight = Math.max(1, Math.ceil(2 * focal * Math.atan(centerY / focal)))
    const outCenterX = outWidth / 2
    const outCenterY = outHeight / 2

    const data = new Uint8Array(outWidth * outHeight * 4)
    const mask = new Uint8Array(outWidth * outHeight)

    const sinTheta = new Float64Array(outWidth)
    const cosTheta = new Float64Array(outWidth)
    for (let ox = 0; ox < outWidth; ox += 1) {
      const theta = (ox - outCenterX) / focal
      sinTheta[ox] = Math.sin(theta)
      cosTheta[ox] = Math.cos(theta)
    }

    for (let oy = 0; oy < outHeight; oy += 1) {
      const phi = (oy - outCenterY) / focal
      const sinPhi = Math.sin(phi)
      const cosPhi = Math.cos(phi)

      for (let ox = 0; ox < outWidth; ox += 1) {
        // Point on the unit sphere -> ray through the pinhole camera.
        const x = sinTheta[ox] * cosPhi
        const y = sinPhi
        const z = cosTheta[ox] * cosPhi
        if (z <= 1e-6) continue

        const sx = (focal * x) / z + centerX
        const sy = (focal * y) / z + centerY
        if (sx < 0 || sy < 0 || sx > width - 1 || sy > height - 1) continue

        // Bilinear sample.
        const x0 = Math.floor(sx)
        const y0 = Math.floor(sy)
        const x1 = Math.min(x0 + 1, width - 1)
        const y1 = Math.min(y0 + 1, height - 1)
        const fx = sx - x0
        const fy = sy - y0
        const i00 = (y0 * width + x0) * 4
        const i10 = (y0 * width + x1) * 4
        const i01 = (y1 * width + x0) * 4
        const i11 = (y1 * width + x1) * 4
        const out = (oy * outWidth + ox) * 4

        for (let c = 0; c < 3; c += 1) {
          const top = source[i00 + c] * (1 - fx) + source[i10 + c] * fx
          const bottom = source[i01 + c] * (1 - fx) + source[i11 + c] * fx
          data[out + c] = Math.round(top * (1 - fy) + bottom * fy)
        }
        data[out + 3] = 255
        mask[oy * outWidth + ox] = 255
      }
    }

    return { width: outWidth, height: outHeight, data, mask }
  }
}