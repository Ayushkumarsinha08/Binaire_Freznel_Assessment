import type { DecodedImage, ImageItem, PanoramaType } from '../types'
import { CylindricalProjector, type CylindricalImage } from './CylindricalProjector'
import { SphericalProjector, type PanoramaProjector } from './SphericalProjector'
import { FeatureMatcher } from './FeatureMatcher'


type CvModule = any
type CvMat = any

type Point = { x: number; y: number }

type Bounds = {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

export type StitchProgress = (progress: number, message: string) => void

export type PanoramaResult = {
  width: number
  height: number
  data: Uint8ClampedArray
}

export type CylindricalDiagnostic = {
  pairIndex: number
  imageA: string
  imageB: string
  keypointsA: number
  keypointsB: number
  rawMatches: number
  goodMatches: number
  ratioMatches: number
  mutualMatches: number
  translationInliers: number
  translationInlierRatio: number
  medianDx: number
  medianDy: number
  dxStandardDeviation: number
  dyStandardDeviation: number
  alignmentResidual: number
  failureReason?: string
}

export type StitchResult =
  | { success: true; panorama: PanoramaResult; diagnostics: CylindricalDiagnostic[] }
  | { success: false; error: string; diagnostics: CylindricalDiagnostic[] }

export type ImageLoader = (filePath: string) => Promise<DecodedImage | null>

export class StitchingPipeline {
  private readonly cv: CvModule
  private readonly loadImage: ImageLoader

  constructor(cv: CvModule, loadImage: ImageLoader) {
    this.cv = cv
    this.loadImage = loadImage
  }



  async stitchWithMode(
    images: ImageItem[],
    onProgress: StitchProgress,
    panoramaType: PanoramaType,
  ): Promise<StitchResult> {
    if (panoramaType === 'cylindrical') {
      return this.stitchCylindrical(images, onProgress)
    }
    if (panoramaType === 'spherical') {
      return this.stitchCylindrical(images, onProgress, (scale) => new SphericalProjector(scale))
    }
    return this.stitchTranslation(images, onProgress)
  }

  private async stitchTranslation(
    images: ImageItem[],
    onProgress: StitchProgress,
  ): Promise<StitchResult> {
    const originalMats: CvMat[] = []
    const positions: Array<{ x: number; y: number }> = [{ x: 0, y: 0 }]
    const diagnostics: CylindricalDiagnostic[] = []

    try {
      onProgress(0, 'Preparing images...')
      for (const image of images) {
        originalMats.push(await this.loadImageMat(image))
      }

      const matcher = new FeatureMatcher(this.cv)
      for (let index = 1; index < originalMats.length; index += 1) {
        onProgress(Math.round((index / images.length) * 60), 'Matching features...')
        const matchSet = matcher.findGoodMatches(originalMats[index - 1], originalMats[index])
        const displacement = this.estimateTranslation(matchSet.matches, originalMats[index].rows)
        const diagnostic: CylindricalDiagnostic = {
          pairIndex: index,
          imageA: `Image ${index}`,
          imageB: `Image ${index + 1}`,
          keypointsA: matchSet.keypointsImageOne,
          keypointsB: matchSet.keypointsImageTwo,
          rawMatches: matchSet.rawMatches,
          goodMatches: matchSet.matches.length,
          ratioMatches: matchSet.ratioMatches,
          mutualMatches: matchSet.mutualMatches,
          translationInliers: displacement.translationInliers,
          translationInlierRatio: displacement.translationInlierRatio,
          medianDx: displacement.dx,
          medianDy: displacement.dy,
          dxStandardDeviation: displacement.dxStandardDeviation,
          dyStandardDeviation: displacement.dyStandardDeviation,
          alignmentResidual: displacement.alignmentResidual,
          failureReason: displacement.failureReason,
        }
        diagnostics.push(diagnostic)
        if (displacement.failureReason) {
          return { success: false, error: displacement.failureReason, diagnostics }
        }
        positions.push({
          x: positions[index - 1].x - displacement.dx,
          y: positions[index - 1].y - displacement.dy,
        })
      }

      const bounds = this.calculateImageBounds(originalMats, positions)
      const canvasWidth = Math.ceil(bounds.maxX - bounds.minX)
      const canvasHeight = Math.ceil(bounds.maxY - bounds.minY)
      onProgress(80, 'Blending panorama...')
      const result = this.blendOriginalImages(originalMats, positions, bounds, canvasWidth, canvasHeight)

      onProgress(100, 'Panorama ready')
      return { success: true, panorama: result, diagnostics }
    } catch {
      return {
        success: false,
        error: 'Images do not have enough overlapping features. Please use images with more overlap.',
        diagnostics,
      }
    } finally {
      for (const mat of originalMats) {
        mat.delete()
      }
    }
  }

  private estimateTranslation(matches: Array<{ imageOnePoint: Point; imageTwoPoint: Point }>, imageHeight: number) {
    const threshold = 8
    const displacements = matches.map((match) => ({
      x: match.imageTwoPoint.x - match.imageOnePoint.x,
      y: match.imageTwoPoint.y - match.imageOnePoint.y,
    }))
    let best: typeof displacements = []
    for (let iteration = 0; iteration < 200 && displacements.length > 0; iteration += 1) {
      const candidate = displacements[Math.floor(Math.random() * displacements.length)]
      const inliers = displacements.filter((displacement) => (
        Math.hypot(displacement.x - candidate.x, displacement.y - candidate.y) <= threshold
      ))
      if (inliers.length > best.length) best = inliers
    }

    const median = (values: number[]) => {
      const sorted = [...values].sort((a, b) => a - b)
      return sorted[Math.floor(sorted.length / 2)] ?? 0
    }
    const dx = median(best.map((value) => value.x))
    const dy = median(best.map((value) => value.y))
    const translationInliers = displacements.filter((value) => Math.hypot(value.x - dx, value.y - dy) <= threshold)
    const dxStandardDeviation = this.standardDeviation(translationInliers.map((value) => value.x), dx)
    const dyStandardDeviation = this.standardDeviation(translationInliers.map((value) => value.y), dy)
    const alignmentResidual = Math.sqrt(translationInliers.reduce(
      (sum, value) => sum + (value.x - dx) ** 2 + (value.y - dy) ** 2,
      0,
    ) / Math.max(1, translationInliers.length))
    const translationInlierRatio = translationInliers.length / Math.max(1, matches.length)
    const failureReason = translationInliers.length < 20
      ? 'Images do not have enough overlapping features. Please use images with more overlap.'
      : translationInlierRatio < 0.2
        ? 'Images do not have enough overlapping features. Please use images with more overlap.'
        : Math.abs(dy) > Math.max(40, imageHeight * 0.15)
          ? 'Images do not have enough overlapping features. Please use images with more overlap.'
          : undefined

    return {
      dx,
      dy,
      translationInliers: translationInliers.length,
      translationInlierRatio,
      dxStandardDeviation,
      dyStandardDeviation,
      alignmentResidual,
      failureReason,
    }
  }

  private calculateImageBounds(images: CvMat[], positions: Array<{ x: number; y: number }>): Bounds {
    return images.reduce<Bounds>((bounds, image, index) => ({
      minX: Math.min(bounds.minX, positions[index].x),
      minY: Math.min(bounds.minY, positions[index].y),
      maxX: Math.max(bounds.maxX, positions[index].x + image.cols),
      maxY: Math.max(bounds.maxY, positions[index].y + image.rows),
    }), { minX: 0, minY: 0, maxX: 0, maxY: 0 })
  }

  private blendOriginalImages(
    images: CvMat[],
    positions: Array<{ x: number; y: number }>,
    bounds: Bounds,
    width: number,
    height: number,
  ): PanoramaResult {
    const accumulatedColor = new Float32Array(width * height * 3)
    const accumulatedWeight = new Float32Array(width * height)
    const offsetX = -bounds.minX
    const offsetY = -bounds.minY

    images.forEach((image, imageIndex) => {
      const mask = this.cv.Mat.ones(image.rows, image.cols, this.cv.CV_8UC1)
      const distance = new this.cv.Mat()
      try {
        mask.setTo(new this.cv.Scalar(255))
        this.cv.distanceTransform(mask, distance, this.cv.DIST_L2, 3)
        let maximumDistance = 0
        for (const value of distance.data32F) maximumDistance = Math.max(maximumDistance, value)
        const positionX = Math.round(positions[imageIndex].x + offsetX)
        const positionY = Math.round(positions[imageIndex].y + offsetY)

        for (let sourceY = 0; sourceY < image.rows; sourceY += 1) {
          for (let sourceX = 0; sourceX < image.cols; sourceX += 1) {
            const destinationX = positionX + sourceX
            const destinationY = positionY + sourceY
            if (destinationX < 0 || destinationY < 0 || destinationX >= width || destinationY >= height) continue
            const weight = distance.data32F[sourceY * image.cols + sourceX] / Math.max(1, maximumDistance)
            if (weight <= 0) continue
            const sourceIndex = (sourceY * image.cols + sourceX) * 4
            const destinationPixel = destinationY * width + destinationX
            const colorIndex = destinationPixel * 3
            accumulatedColor[colorIndex] += image.data[sourceIndex] * weight
            accumulatedColor[colorIndex + 1] += image.data[sourceIndex + 1] * weight
            accumulatedColor[colorIndex + 2] += image.data[sourceIndex + 2] * weight
            accumulatedWeight[destinationPixel] += weight
          }
        }
      } finally {
        mask.delete()
        distance.delete()
      }
    })

    let minX = width
    let minY = height
    let maxX = -1
    let maxY = -1
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (accumulatedWeight[y * width + x] <= 0.0001) continue
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
    }
    if (maxX < minX || maxY < minY) throw new Error('Images do not have enough overlapping features. Please use images with more overlap.')

    const outputWidth = maxX - minX + 1
    const outputHeight = maxY - minY + 1
    const output = new Uint8Array(outputWidth * outputHeight * 4)
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const sourcePixel = y * width + x
        const weight = accumulatedWeight[sourcePixel]
        if (weight <= 0.0001) continue
        const colorIndex = sourcePixel * 3
        const outputIndex = ((y - minY) * outputWidth + x - minX) * 4
        output[outputIndex] = Math.round(accumulatedColor[colorIndex] / weight)
        output[outputIndex + 1] = Math.round(accumulatedColor[colorIndex + 1] / weight)
        output[outputIndex + 2] = Math.round(accumulatedColor[colorIndex + 2] / weight)
        output[outputIndex + 3] = 255
      }
    }
    return { width: outputWidth, height: outputHeight, data: new Uint8ClampedArray(output) }
  }


  async stitchCylindrical(
    images: ImageItem[],
    onProgress: StitchProgress,
    createProjector: (scale: number) => PanoramaProjector = (scale) => new CylindricalProjector(scale),
  ): Promise<StitchResult> {
    const projector = createProjector(await this.pickFocalScale(images, createProjector))
    const projectedImages: CylindricalImage[] = []
    const projectedMats: CvMat[] = []
    const positions: Array<{ x: number; y: number }> = [{ x: 0, y: 0 }]
    const diagnostics: CylindricalDiagnostic[] = []

    try {
      onProgress(0, 'Preparing images...')
      for (const image of images) {
        const decoded = await this.loadImage(image.path)
        if (!decoded) {
          throw new Error(`Image could not be decoded: ${image.name}`)
        }
        const projected = projector.project(decoded)
        projectedImages.push(projected)
        projectedMats.push(this.imageDataToMat({
          width: projected.width,
          height: projected.height,
          data: projected.data,
        }))
      }

      const matcher = new FeatureMatcher(this.cv)

      for (let index = 1; index < projectedMats.length; index += 1) {
        onProgress(Math.round((index / images.length) * 60), 'Detecting features...')
        let matchSet
        try {
          matchSet = matcher.findGoodMatches(projectedMats[index - 1], projectedMats[index])
        } catch (error) {
          const reason = error instanceof Error ? error.message : 'Feature matching failed.'
          const diagnostic: CylindricalDiagnostic = {
            pairIndex: index,
            imageA: `Image ${index}`,
            imageB: `Image ${index + 1}`,
            keypointsA: 0,
            keypointsB: 0,
            rawMatches: 0,
            goodMatches: 0,
            ratioMatches: 0,
            mutualMatches: 0,
            translationInliers: 0,
            translationInlierRatio: 0,
            medianDx: 0,
            medianDy: 0,
            dxStandardDeviation: 0,
            dyStandardDeviation: 0,
            alignmentResidual: 0,
            failureReason: reason,
          }
          diagnostics.push(diagnostic)
          return { success: false, error: reason, diagnostics }
        }
        const displacement = this.estimateCylindricalDisplacement(
          matchSet.matches,
          projectedImages[index].height,
        )
        const diagnostic: CylindricalDiagnostic = {
          pairIndex: index,
          imageA: `Image ${index}`,
          imageB: `Image ${index + 1}`,
          keypointsA: matchSet.keypointsImageOne,
          keypointsB: matchSet.keypointsImageTwo,
          rawMatches: matchSet.rawMatches,
          goodMatches: matchSet.matches.length,
          ratioMatches: matchSet.ratioMatches,
          mutualMatches: matchSet.mutualMatches,
          translationInliers: displacement.translationInliers,
          translationInlierRatio: displacement.translationInlierRatio,
          medianDx: displacement.medianDx,
          medianDy: displacement.medianDy,
          dxStandardDeviation: displacement.dxStandardDeviation,
          dyStandardDeviation: displacement.dyStandardDeviation,
          alignmentResidual: displacement.alignmentResidual,
          failureReason: displacement.failureReason,
        }
        diagnostics.push(diagnostic)
        if (displacement.failureReason) {
          return {
            success: false,
            error: displacement.failureReason,
            diagnostics,
          }
        }
        positions.push({
          x: positions[index - 1].x - displacement.x,
          y: positions[index - 1].y - displacement.y,
        })
      }

      onProgress(75, 'Calculating transformation...')
      const bounds = this.calculateCylindricalBounds(projectedImages, positions)
      for (let index = 1; index < projectedImages.length; index += 1) {
        const prevRight = positions[index - 1].x + projectedImages[index - 1].width
        const currLeft = positions[index].x
        if (Math.min(prevRight, positions[index].x + projectedImages[index].width) <= Math.max(positions[index - 1].x, currLeft)) {
          return {
            success: false,
            error: `Cylindrical images ${index} and ${index + 1} do not overlap after translation.`,
            diagnostics,
          }
        }
      }
      const width = Math.ceil(bounds.maxX - bounds.minX)
      const height = Math.ceil(bounds.maxY - bounds.minY)

      if (width <= 0 || height <= 0 || width > 50000 || height > 10000) {
        throw new Error('The cylindrical panorama bounds are invalid. Try images with more horizontal overlap.')
      }

      onProgress(85, 'Warping images...')
      const result = this.blendCylindricalImages(projectedImages, positions, bounds, width, height)
      onProgress(100, 'Panorama ready')
      return { success: true, panorama: result, diagnostics }
    } finally {
      for (const mat of projectedMats) {
        mat.delete()
      }
    }
  }

  private estimateCylindricalDisplacement(
    matches: Array<{ imageOnePoint: Point; imageTwoPoint: Point }>,
    imageHeight: number,
  ) {
    const translationRansacThreshold = 8
    const ransacIterations = 200
    const displacements = matches.map((match) => ({
      x: match.imageTwoPoint.x - match.imageOnePoint.x,
      y: match.imageTwoPoint.y - match.imageOnePoint.y,
    }))
    let bestConsensus: typeof displacements = []

    for (let iteration = 0; iteration < ransacIterations && displacements.length > 0; iteration += 1) {
      const candidate = displacements[Math.floor(Math.random() * displacements.length)]
      const consensus = displacements.filter((displacement) => (
        Math.hypot(displacement.x - candidate.x, displacement.y - candidate.y) <= translationRansacThreshold
      ))
      if (consensus.length > bestConsensus.length) {
        bestConsensus = consensus
      }
    }

    const consensusX = bestConsensus.map((displacement) => displacement.x).sort((left, right) => left - right)
    const consensusY = bestConsensus.map((displacement) => displacement.y).sort((left, right) => left - right)
    const dx = consensusX[Math.floor(consensusX.length / 2)]
    const dy = consensusY[Math.floor(consensusY.length / 2)]
    const translationInliers = displacements.filter((displacement) => (
      Math.hypot(displacement.x - dx, displacement.y - dy) <= translationRansacThreshold
    ))
    const inlierCount = translationInliers.length
    const verticalLimit = Math.max(40, imageHeight * 0.15)
    const dxStandardDeviation = this.standardDeviation(translationInliers.map((displacement) => displacement.x), dx)
    const dyStandardDeviation = this.standardDeviation(translationInliers.map((displacement) => displacement.y), dy)
    const residuals = translationInliers.map((displacement) => ({
      x: displacement.x - dx,
      y: displacement.y - dy,
    }))
    const alignmentResidual = Math.sqrt(
      residuals.reduce((sum, residual) => sum + residual.x ** 2 + residual.y ** 2, 0) / residuals.length,
    )



    return {
      x: dx,
      y: dy,
      translationInliers: inlierCount,
      translationInlierRatio: inlierCount / matches.length,
      medianDx: dx,
      medianDy: dy,
      dxStandardDeviation,
      dyStandardDeviation,
      alignmentResidual,
      failureReason: inlierCount < 20
        ? 'Adjacent images have an unreasonable cylindrical displacement.'
        : Math.abs(dy) > verticalLimit
          ? 'Adjacent images have too much vertical displacement for a horizontal sweep.'
          : Math.abs(dx) < 5
            ? 'Adjacent images do not have enough horizontal movement.'
            : alignmentResidual > translationRansacThreshold
              ? 'Adjacent images have excessive cylindrical alignment residual.'
              : undefined,
    }
  }

  private standardDeviation(values: number[], mean: number) {
    return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length)
  }

  private calculateCylindricalBounds(images: CylindricalImage[], positions: Array<{ x: number; y: number }>): Bounds {
    return images.reduce<Bounds>((bounds, image, index) => ({
      minX: Math.min(bounds.minX, positions[index].x),
      maxX: Math.max(bounds.maxX, positions[index].x + image.width),
      minY: Math.min(bounds.minY, positions[index].y),
      maxY: Math.max(bounds.maxY, positions[index].y + image.height),
    }), { minX: 0, maxX: 0, minY: 0, maxY: 0 })
  }

  private blendCylindricalImages(
    images: CylindricalImage[],
    positions: Array<{ x: number; y: number }>,
    bounds: Bounds,
    width: number,
    height: number,
  ): PanoramaResult {
    const accumulatedColor = new Float32Array(width * height * 3)
    const weights = new Float32Array(width * height)
    const offsetX = Math.floor(-bounds.minX)
    const offsetY = Math.floor(-bounds.minY)

    images.forEach((image, imageIndex) => {
      const startX = Math.round(positions[imageIndex].x + offsetX)
      const startY = Math.round(positions[imageIndex].y + offsetY)
      const featherWeights = this.createMaskFeatherWeights(image.mask, image.width, image.height)
      for (let sourceY = 0; sourceY < image.height; sourceY += 1) {
        for (let sourceX = 0; sourceX < image.width; sourceX += 1) {
          if (image.mask[sourceY * image.width + sourceX] === 0) {
            continue
          }

          const destinationX = startX + sourceX
          const destinationY = startY + sourceY
          if (destinationX < 0 || destinationY < 0 || destinationX >= width || destinationY >= height) {
            continue
          }

          const sourceIndex = (sourceY * image.width + sourceX) * 4
          const destinationPixel = destinationY * width + destinationX
          const incomingWeight = featherWeights[sourceY * image.width + sourceX]
          if (incomingWeight <= 0) {
            continue
          }

          const colorIndex = destinationPixel * 3
          accumulatedColor[colorIndex] += image.data[sourceIndex] * incomingWeight
          accumulatedColor[colorIndex + 1] += image.data[sourceIndex + 1] * incomingWeight
          accumulatedColor[colorIndex + 2] += image.data[sourceIndex + 2] * incomingWeight
          weights[destinationPixel] += incomingWeight
        }
      }
    })

    const rowCoverage = new Uint32Array(height)
    const columnCoverage = new Uint32Array(width)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (weights[y * width + x] <= 0.0001) {
          continue
        }
        rowCoverage[y] += 1
        columnCoverage[x] += 1
      }
    }

    const columnThreshold = 1 // keep any column that has data
    const rowThreshold = Math.max(1, columnCoverage.filter((count) => count > 0).length) // keep only rows valid across every covered column
    let validMinX = columnCoverage.findIndex((coverage) => coverage >= columnThreshold)
    let validMinY = rowCoverage.findIndex((coverage) => coverage >= rowThreshold)
    let validMaxX = columnCoverage.length - 1 - [...columnCoverage].reverse().findIndex((coverage) => coverage >= columnThreshold)
    let validMaxY = rowCoverage.length - 1 - [...rowCoverage].reverse().findIndex((coverage) => coverage >= rowThreshold)

    if (validMinX < 0 || validMinY < 0 || validMaxX < validMinX || validMaxY < validMinY) {
      throw new Error('The cylindrical panorama contains no valid projected pixels.')
    }

    const croppedWidth = validMaxX - validMinX + 1
    const croppedHeight = validMaxY - validMinY + 1
    const croppedData = new Uint8Array(croppedWidth * croppedHeight * 4)
    for (let y = 0; y < croppedHeight; y += 1) {
      for (let x = 0; x < croppedWidth; x += 1) {
        const sourcePixel = (validMinY + y) * width + validMinX + x
        const destinationIndex = (y * croppedWidth + x) * 4
        const colorIndex = sourcePixel * 3
        const weight = weights[sourcePixel]
        if (weight <= 0.0001) {
          continue
        }
        croppedData[destinationIndex] = Math.round(accumulatedColor[colorIndex] / weight)
        croppedData[destinationIndex + 1] = Math.round(accumulatedColor[colorIndex + 1] / weight)
        croppedData[destinationIndex + 2] = Math.round(accumulatedColor[colorIndex + 2] / weight)
        croppedData[destinationIndex + 3] = 255
      }
    }

    return { width: croppedWidth, height: croppedHeight, data: new Uint8ClampedArray(croppedData) }
  }

  private createMaskFeatherWeights(mask: Uint8Array, width: number, height: number) {
    const distances = new Float32Array(width * height)
    distances.fill(Number.POSITIVE_INFINITY)

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x
        if (mask[index] === 0) {
          distances[index] = 0
          continue
        }
        if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
          distances[index] = 1
        }
        if (x > 0) distances[index] = Math.min(distances[index], distances[index - 1] + 1)
        if (y > 0) distances[index] = Math.min(distances[index], distances[index - width] + 1)
      }
    }

    for (let y = height - 1; y >= 0; y -= 1) {
      for (let x = width - 1; x >= 0; x -= 1) {
        const index = y * width + x
        if (mask[index] === 0) continue
        if (x + 1 < width) distances[index] = Math.min(distances[index], distances[index + 1] + 1)
        if (y + 1 < height) distances[index] = Math.min(distances[index], distances[index + width] + 1)
      }
    }

    let maximumDistance = 0
    for (const distance of distances) {
      if (Number.isFinite(distance)) maximumDistance = Math.max(maximumDistance, distance)
    }
    if (maximumDistance === 0) return distances
    for (let index = 0; index < distances.length; index += 1) {
      distances[index] = Number.isFinite(distances[index])
        ? distances[index] / maximumDistance
        : 0
    }

    return distances
  }

  private async pickFocalScale(
    images: ImageItem[],
    createProjector: (scale: number) => PanoramaProjector,
  ): Promise<number> {
    const [a, b] = await Promise.all([this.loadImage(images[0].path), this.loadImage(images[1].path)])
    if (!a || !b) return 0.8
    const matcher = new FeatureMatcher(this.cv)
    let best = { scale: 0.8, inliers: -1 }
    for (const scale of [0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.25, 1.4]) {
      const projector = createProjector(scale)
      const pa = projector.project(a)
      const pb = projector.project(b)
      const matA = this.imageDataToMat({ width: pa.width, height: pa.height, data: pa.data })
      const matB = this.imageDataToMat({ width: pb.width, height: pb.height, data: pb.data })
      try {
        const set = matcher.findGoodMatches(matA, matB)
        if (set.matches.length < 20) continue
        const d = this.estimateCylindricalDisplacement(set.matches, pb.height)
        if (d.translationInliers > best.inliers) best = { scale, inliers: d.translationInliers }
      } catch {
        /* skip this scale */
      } finally {
        matA.delete()
        matB.delete()
      }
    }
    return best.scale
  }

  private async loadImageMat(image: ImageItem): Promise<CvMat> {
    const decoded = await this.loadImage(image.path)
    if (!decoded) {
      throw new Error(`Image could not be decoded: ${image.name}`)
    }

    const imageData = new ImageData(
      new Uint8ClampedArray(decoded.data),
      decoded.width,
      decoded.height,
    )
    return this.cv.matFromImageData(imageData)
  }

  private imageDataToMat(image: DecodedImage): CvMat {
    const imageData = new ImageData(
      new Uint8ClampedArray(image.data),
      image.width,
      image.height,
    )
    return this.cv.matFromImageData(imageData)
  }
}