import type { DecodedImage, ImageItem, PanoramaType } from '../types'
import { CylindricalProjector, type CylindricalImage } from './CylindricalProjector'
import { SphericalProjector, type PanoramaProjector } from './SphericalProjector'
import { FeatureMatcher } from './FeatureMatcher'
import { HomographyEstimator, transformPoint } from './Homography'

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

  async stitch(images: ImageItem[], onProgress: StitchProgress): Promise<StitchResult> {
    if (images.length < 2) {
      throw new Error('Select at least two images to create a panorama.')
    }

    return this.stitchWithMode(images, onProgress, 'cylindrical')
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
        console.log({
          pair: `${index} -> ${index + 1}`,
          goodMatches: matchSet.matches.length,
          translationInliers: displacement.translationInliers,
          translationInlierRatio: displacement.translationInlierRatio,
          dx: displacement.dx,
          dy: displacement.dy,
        })
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
      console.log({
        imageCount: images.length,
        canvasWidth,
        canvasHeight,
        outputWidth: result.width,
        outputHeight: result.height,
      })

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

  async stitchHomography(images: ImageItem[], onProgress: StitchProgress): Promise<StitchResult> {

    const originalMats: CvMat[] = []
    const cumulativeTransforms: CvMat[] = []

    try {
      onProgress(0, 'Preparing images...')
      for (const image of images) {
        originalMats.push(await this.loadImageMat(image))
      }

      cumulativeTransforms.push(this.identityTransform())
      const matcher = new FeatureMatcher(this.cv)
      const estimator = new HomographyEstimator(this.cv)

      for (let index = 1; index < originalMats.length; index += 1) {
        const pairNumber = index
        const progressBase = Math.round(((index - 1) / (images.length - 1)) * 55) + 20
        onProgress(progressBase, 'Detecting features...')
        const matchSet = matcher.findGoodMatches(originalMats[index - 1], originalMats[index])
        onProgress(progressBase + 5, 'Matching features...')
        console.debug(`Pair ${pairNumber}: Image${index} -> Image${index + 1} matching`, {
          keypointsA: matchSet.keypointsImageOne,
          keypointsB: matchSet.keypointsImageTwo,
          rawMatches: matchSet.rawMatches,
          goodMatches: matchSet.matches.length,
          ratioMatches: matchSet.ratioMatches,
          mutualMatches: matchSet.mutualMatches,
        })
        let estimate
        try {
          estimate = estimator.estimateFromMatches(matchSet.matches)
        } catch (error) {
          if (index === originalMats.length - 1) {
            const reason = error instanceof Error ? error.message : 'unknown homography failure'
            throw new Error(`Image ${index + 1} could not be reliably aligned with Image ${index}: ${reason}`)
          }
          throw error
        }

        console.debug(`Pair ${pairNumber}: Image${index} -> Image${index + 1}`, {
          keypointsA: matchSet.keypointsImageOne,
          keypointsB: matchSet.keypointsImageTwo,
          rawMatches: matchSet.rawMatches,
          goodMatches: matchSet.matches.length,
          inliers: estimate.inliers,
          inlierRatio: estimate.inlierRatio,
          reprojectionError: estimate.reprojectionError,
        })

        const sample = matchSet.matches[0]
        const directPoint = transformPoint(this.cv, sample.imageTwoPoint, estimate.matrix)
        const composedTransform = this.multiply(cumulativeTransforms[index - 1], estimate.matrix)
        let composedPoint
        try {
          composedPoint = transformPoint(this.cv, sample.imageTwoPoint, composedTransform)
        } finally {
          composedTransform.delete()
        }
        console.debug(`Pair ${pairNumber} direction check`, {
          sourceImagePoint: sample.imageTwoPoint,
          directImagePoint: directPoint,
          expectedImagePoint: sample.imageOnePoint,
          directError: Math.hypot(directPoint.x - sample.imageOnePoint.x, directPoint.y - sample.imageOnePoint.y),
          composedImage1Point: composedPoint,
        })

        const cumulative = this.multiply(cumulativeTransforms[index - 1], estimate.matrix)
        estimate.matrix.delete()
        cumulativeTransforms.push(cumulative)
      }

      onProgress(60, 'Calculating transformation...')
      this.logIntermediateBounds(originalMats, cumulativeTransforms)
      const bounds = this.calculateGlobalBounds(originalMats, cumulativeTransforms)
      console.debug('Global bounds:', bounds)

      const width = Math.ceil(bounds.maxX - bounds.minX)
      const height = Math.ceil(bounds.maxY - bounds.minY)
      const largestInputDimension = Math.max(...originalMats.flatMap((mat) => [mat.cols, mat.rows]))
      const maximumDimension = largestInputDimension * 8
      if (width <= 0 || height <= 0 || width > maximumDimension || height > maximumDimension) {
        throw new Error('The combined panorama bounds are invalid. Try images with more consistent overlap.')
      }
      console.debug('Final canvas:', { width, height })

      onProgress(80, 'Warping images...')
      const result = this.warpOriginalsToCommonCanvas(
        originalMats,
        cumulativeTransforms,
        bounds.minX,
        bounds.minY,
        width,
        height,
      )
      onProgress(100, 'Panorama ready')
      return { success: true, panorama: result, diagnostics: [] }
    } finally {
      for (const mat of originalMats) {
        mat.delete()
      }
      for (const transform of cumulativeTransforms) {
        transform.delete()
      }
    }
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
      console.log({ imageIndex: 1, dx: 0, dy: 0, positionX: 0, positionY: 0 })
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
          this.logCylindricalDiagnostic(diagnostic, [])
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
        this.logCylindricalDiagnostic(diagnostic, displacement.sampleDeltas)
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
        console.log({
          imageIndex: index + 1,
          dx: displacement.x,
          dy: displacement.y,
          positionX: positions[index].x,
          positionY: positions[index].y,
        })
      }

      onProgress(75, 'Calculating transformation...')
      const bounds = this.calculateCylindricalBounds(projectedImages, positions)
      console.log('CYLINDRICAL POSITIONS', positions)
      const rectangles = projectedImages.map((image, index) => ({
        image: index + 1,
        left: positions[index].x,
        right: positions[index].x + image.width,
        top: positions[index].y,
        bottom: positions[index].y + image.height,
      }))
      rectangles.forEach((rectangle) => console.log(rectangle))
      for (let index = 1; index < rectangles.length; index += 1) {
        const previous = rectangles[index - 1]
        const current = rectangles[index]
        if (Math.min(previous.right, current.right) <= Math.max(previous.left, current.left)) {
          return {
            success: false,
            error: `Cylindrical images ${index} and ${index + 1} do not overlap after translation.`,
            diagnostics,
          }
        }
      }
      console.debug('Cylindrical global bounds:', bounds)
      const width = Math.ceil(bounds.maxX - bounds.minX)
      const height = Math.ceil(bounds.maxY - bounds.minY)
      console.debug('Cylindrical final canvas:', { width, height })

      if (width <= 0 || height <= 0 || width > 50000 || height > 10000) {
        throw new Error('The cylindrical panorama bounds are invalid. Try images with more horizontal overlap.')
      }

      onProgress(85, 'Warping images...')
      const columnsWithNoCoverage = this.countUncoveredColumns(projectedImages, positions, bounds, width, height)
      console.log({
        minX: bounds.minX,
        maxX: bounds.maxX,
        columnsWithNoCoverage,
        imagePositions: positions,
        canvasWidth: width,
        canvasHeight: height,
      })
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
    let bestCandidate = displacements[0] ?? { x: 0, y: 0 }

    for (let iteration = 0; iteration < ransacIterations && displacements.length > 0; iteration += 1) {
      const candidate = displacements[Math.floor(Math.random() * displacements.length)]
      const consensus = displacements.filter((displacement) => (
        Math.hypot(displacement.x - candidate.x, displacement.y - candidate.y) <= translationRansacThreshold
      ))
      if (consensus.length > bestConsensus.length) {
        bestConsensus = consensus
        bestCandidate = candidate
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

    console.debug('Cylindrical displacement consensus', {
      candidate: bestCandidate,
      threshold: translationRansacThreshold,
      translationInliers: inlierCount,
      totalMatches: matches.length,
      dx,
      dy,
      dxStandardDeviation,
      dyStandardDeviation,
      alignmentResidual,
    })

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
      sampleDeltas: translationInliers.slice(0, 10),
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

  private logCylindricalDiagnostic(
    diagnostic: CylindricalDiagnostic,
    samples: Array<{ x: number; y: number }>,
  ) {
    console.group(`Cylindrical Pair ${diagnostic.pairIndex}`)
    console.log('keypointsA', diagnostic.keypointsA)
    console.log('keypointsB', diagnostic.keypointsB)
    console.log('rawMatches', diagnostic.rawMatches)
    console.log('goodMatches', diagnostic.goodMatches)
    console.log('ratioMatches', diagnostic.ratioMatches)
    console.log('mutualMatches', diagnostic.mutualMatches)
    console.log('translationInliers', diagnostic.translationInliers)
    console.log('translationInlierRatio', diagnostic.translationInlierRatio)
    console.log('medianDx', diagnostic.medianDx)
    console.log('medianDy', diagnostic.medianDy)
    console.log('dxStandardDeviation', diagnostic.dxStandardDeviation)
    console.log('dyStandardDeviation', diagnostic.dyStandardDeviation)
    console.log('alignmentResidual', diagnostic.alignmentResidual)
    console.log('failureReason', diagnostic.failureReason)
    samples.forEach((sample, index) => console.log(`match ${index + 1}: dx=${sample.x}, dy=${sample.y}`))
    console.groupEnd()
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

  private countUncoveredColumns(
    images: CylindricalImage[],
    positions: Array<{ x: number; y: number }>,
    bounds: Bounds,
    width: number,
    height: number,
  ) {
    const coverage = new Uint32Array(width)
    const offsetX = Math.floor(-bounds.minX)
    const offsetY = Math.floor(-bounds.minY)

    images.forEach((image, imageIndex) => {
      const startX = Math.round(positions[imageIndex].x + offsetX)
      const startY = Math.round(positions[imageIndex].y + offsetY)
      for (let y = 0; y < image.height; y += 1) {
        const destinationY = startY + y
        if (destinationY < 0 || destinationY >= height) continue
        for (let x = 0; x < image.width; x += 1) {
          if (image.mask[y * image.width + x] === 0) continue
          const destinationX = startX + x
          if (destinationX >= 0 && destinationX < width) coverage[destinationX] += 1
        }
      }
    })

    return Array.from(coverage).filter((count) => count === 0).length
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
      let validPixels = 0
      let maskMinX = image.width
      let maskMinY = image.height
      let maskMaxX = -1
      let maskMaxY = -1
      for (let maskY = 0; maskY < image.height; maskY += 1) {
        for (let maskX = 0; maskX < image.width; maskX += 1) {
          if (image.mask[maskY * image.width + maskX] === 0) continue
          validPixels += 1
          maskMinX = Math.min(maskMinX, maskX)
          maskMinY = Math.min(maskMinY, maskY)
          maskMaxX = Math.max(maskMaxX, maskX)
          maskMaxY = Math.max(maskMaxY, maskY)
        }
      }
      console.log({
        imageIndex: imageIndex + 1,
        projectedWidth: image.width,
        projectedHeight: image.height,
        validPixels,
        validPercentage: validPixels / (image.width * image.height),
        translatedMaskBounds: {
          x: maskMaxX >= 0 ? maskMinX + startX : -1,
          y: maskMaxY >= 0 ? maskMinY + startY : -1,
          width: maskMaxX >= 0 ? maskMaxX - maskMinX + 1 : 0,
          height: maskMaxY >= 0 ? maskMaxY - maskMinY + 1 : 0,
        },
      })
      if (validPixels === 0) {
        console.warn(`Cylindrical image ${imageIndex + 1} has no valid projected pixels.`)
      }
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
    let validPixelCount = 0
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (weights[y * width + x] <= 0.0001) {
          continue
        }
        validPixelCount += 1
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
    const cropRect = {
      x: validMinX,
      y: validMinY,
      width: croppedWidth,
      height: croppedHeight,
    }
    console.log({
      panoramaWidth: width,
      panoramaHeight: height,
      validPixelPercentage: (validPixelCount / (width * height)) * 100,
      cropRect,
    })
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

    console.debug('Cylindrical valid bounding box:', {
      minX: validMinX,
      minY: validMinY,
      maxX: validMaxX,
      maxY: validMaxY,
      width: croppedWidth,
      height: croppedHeight,
    })

    console.log({
      finalWidth: croppedWidth,
      finalHeight: croppedHeight,
      outputWidth: croppedWidth,
      outputHeight: croppedHeight,
      validPercentage: (validPixelCount / (width * height)) * 100,
      cropRect,
    })

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

  private identityTransform(): CvMat {
    const identity = new this.cv.Mat(3, 3, this.cv.CV_64F)
    identity.data64F.set([
      1, 0, 0,
      0, 1, 0,
      0, 0, 1,
    ])
    return identity
  }

  private multiply(left: CvMat, right: CvMat): CvMat {
    const result = new this.cv.Mat()
    const empty = new this.cv.Mat()

    try {
      this.cv.gemm(left, right, 1, empty, 0, result)
      return result
    } catch (error) {
      result.delete()
      throw error
    } finally {
      empty.delete()
    }
  }

  private calculateGlobalBounds(originalMats: CvMat[], transforms: CvMat[]): Bounds {
    let minX = 0
    let minY = 0
    let maxX = 0
    let maxY = 0

    originalMats.forEach((image, index) => {
      const corners = this.transformCorners(image, transforms[index])
      console.debug(`H${index + 1} transformed corners`, corners)
      this.validateTransformedCorners(image, corners, index)

      for (const corner of corners) {
        if (!Number.isFinite(corner.x) || !Number.isFinite(corner.y)) {
          throw new Error('A transformed image has invalid bounds. Try images with more consistent overlap.')
        }

        minX = Math.min(minX, corner.x)
        minY = Math.min(minY, corner.y)
        maxX = Math.max(maxX, corner.x)
        maxY = Math.max(maxY, corner.y)
      }
    })

    return { minX, maxX, minY, maxY }
  }

  private validateTransformedCorners(image: CvMat, corners: Point[], index: number) {
    const area = Math.abs(corners.reduce((sum, point, pointIndex) => {
      const next = corners[(pointIndex + 1) % corners.length]
      return sum + point.x * next.y - next.x * point.y
    }, 0) / 2)
    const sourceArea = image.cols * image.rows
    const areaRatio = area / sourceArea
    const edgeLengths = corners.map((point, pointIndex) => {
      const next = corners[(pointIndex + 1) % corners.length]
      return Math.hypot(next.x - point.x, next.y - point.y)
    })
    const shortestEdge = Math.min(...edgeLengths)
    const longestEdge = Math.max(...edgeLengths)

    if (
      areaRatio < 0.05 ||
      areaRatio > 20 ||
      shortestEdge <= 1 ||
      longestEdge / shortestEdge > 8
    ) {
      throw new Error(`Image ${index + 1} could not be reliably aligned with its adjacent image.`)
    }
  }

  private logIntermediateBounds(originalMats: CvMat[], transforms: CvMat[]) {
    for (let endIndex = 1; endIndex < originalMats.length; endIndex += 1) {
      const bounds = this.calculateGlobalBounds(
        originalMats.slice(0, endIndex + 1),
        transforms.slice(0, endIndex + 1),
      )
      console.debug(`panorama_1_${Array.from({ length: endIndex }, (_, index) => index + 2).join('_')} dimensions`, {
        width: Math.ceil(bounds.maxX - bounds.minX),
        height: Math.ceil(bounds.maxY - bounds.minY),
        bounds,
      })
    }
  }

  private transformCorners(image: CvMat, transform: CvMat): Point[] {
    const corners = new this.cv.Mat(4, 1, this.cv.CV_32FC2)
    const transformed = new this.cv.Mat()

    try {
      corners.data32F.set([
        0, 0,
        image.cols, 0,
        image.cols, image.rows,
        0, image.rows,
      ])
      this.cv.perspectiveTransform(corners, transformed, transform)

      const points: Point[] = []
      for (let index = 0; index < 4; index += 1) {
        points.push({
          x: transformed.data32F[index * 2],
          y: transformed.data32F[index * 2 + 1],
        })
      }
      return points
    } finally {
      corners.delete()
      transformed.delete()
    }
  }

  private warpOriginalsToCommonCanvas(
    originalMats: CvMat[],
    transforms: CvMat[],
    minX: number,
    minY: number,
    width: number,
    height: number,
  ): PanoramaResult {
    const translation = new this.cv.Mat(3, 3, this.cv.CV_64F)
    const panorama = new this.cv.Mat(height, width, this.cv.CV_8UC4)
    const empty = new this.cv.Mat()
    const zero = new this.cv.Scalar(0, 0, 0, 0)
    const weights = new Float32Array(width * height)

    try {
      translation.data64F.set([
        1, 0, -minX,
        0, 1, -minY,
        0, 0, 1,
      ])
      panorama.setTo(zero)

      originalMats.forEach((image, index) => {
        const finalTransform = new this.cv.Mat()
        const warped = new this.cv.Mat()
        const sourceMask = new this.cv.Mat(image.rows, image.cols, this.cv.CV_8UC1)
        const warpedMask = new this.cv.Mat()
        const feather = new this.cv.Mat()
        const size = new this.cv.Size(width, height)

        try {
          this.cv.gemm(translation, transforms[index], 1, empty, 0, finalTransform)
          sourceMask.setTo(new this.cv.Scalar(255))
          this.cv.warpPerspective(
            image,
            warped,
            finalTransform,
            size,
            this.cv.INTER_LINEAR,
            this.cv.BORDER_CONSTANT,
            zero,
          )
          this.cv.warpPerspective(
            sourceMask,
            warpedMask,
            finalTransform,
            size,
            this.cv.INTER_NEAREST,
            this.cv.BORDER_CONSTANT,
            new this.cv.Scalar(0),
          )
          this.cv.distanceTransform(warpedMask, feather, this.cv.DIST_L2, 3)
          this.blendPixels(panorama, warped, warpedMask, feather, weights)
        } finally {
          finalTransform.delete()
          warped.delete()
          sourceMask.delete()
          warpedMask.delete()
          feather.delete()
        }
      })

      return {
        width,
        height,
        data: new Uint8ClampedArray(panorama.data),
      }
    } finally {
      translation.delete()
      panorama.delete()
      empty.delete()
    }
  }

  private blendPixels(
    panorama: CvMat,
    warped: CvMat,
    mask: CvMat,
    feather: CvMat,
    weights: Float32Array,
  ) {
    const output = panorama.data as Uint8Array
    const overlay = warped.data as Uint8Array
    const validPixels = mask.data as Uint8Array
    const featherWeights = feather.data32F as Float32Array

    for (let pixelIndex = 0, index = 0; index < output.length; pixelIndex += 1, index += 4) {
      if (validPixels[pixelIndex] === 0 || overlay[index + 3] === 0) {
        continue
      }

      const incomingWeight = Math.max(1, featherWeights[pixelIndex])
      const existingWeight = weights[pixelIndex]
      const totalWeight = existingWeight + incomingWeight
      output[index] = Math.round((output[index] * existingWeight + overlay[index] * incomingWeight) / totalWeight)
      output[index + 1] = Math.round((output[index + 1] * existingWeight + overlay[index + 1] * incomingWeight) / totalWeight)
      output[index + 2] = Math.round((output[index + 2] * existingWeight + overlay[index + 2] * incomingWeight) / totalWeight)
      output[index + 3] = 255
      weights[pixelIndex] = totalWeight
    }
  }
}