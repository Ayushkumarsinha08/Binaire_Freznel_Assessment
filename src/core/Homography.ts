type CvMat = any
type CvModule = any

import type { FeatureMatch } from './FeatureMatcher'

export const HOMOGRAPHY_CONFIG = {
  minGoodMatches: 20,
  minInlierRatio: 0.35,
  maxReprojectionError: 8,
}

export type HomographyEstimate = {
  matrix: CvMat
  inliers: number
  inlierRatio: number
  reprojectionError: number
}

export class HomographyEstimator {
  private readonly cv: CvModule

  constructor(cv: CvModule) {
    this.cv = cv
  }

  estimateFromMatches(matches: FeatureMatch[]): HomographyEstimate {
    if (matches.length < HOMOGRAPHY_CONFIG.minGoodMatches) {
      throw new Error(
        `Only ${matches.length} good matches were found; at least ${HOMOGRAPHY_CONFIG.minGoodMatches} are required.`,
      )
    }

    const sourcePoints = new this.cv.Mat(matches.length, 1, this.cv.CV_32FC2)
    const destinationPoints = new this.cv.Mat(matches.length, 1, this.cv.CV_32FC2)
    const inlierMask = new this.cv.Mat()

    try {
      for (let index = 0; index < matches.length; index += 1) {
        const match = matches[index]
        sourcePoints.data32F[index * 2] = match.imageTwoPoint.x
        sourcePoints.data32F[index * 2 + 1] = match.imageTwoPoint.y
        destinationPoints.data32F[index * 2] = match.imageOnePoint.x
        destinationPoints.data32F[index * 2 + 1] = match.imageOnePoint.y
      }

      const homography = this.cv.findHomography(
        sourcePoints,
        destinationPoints,
        this.cv.RANSAC,
        4,
        inlierMask,
      )

      if (!homography || homography.empty()) {
        homography?.delete()
        throw new Error('The image transformation could not be calculated.')
      }

      let inliers = 0
      for (let index = 0; index < inlierMask.rows; index += 1) {
        if (inlierMask.ucharPtr(index, 0)[0] !== 0) {
          inliers += 1
        }
      }

      const inlierRatio = inliers / matches.length
      let reprojectionError = 0
      let reprojectionSamples = 0
      for (let index = 0; index < matches.length; index += 1) {
        if (inlierMask.ucharPtr(index, 0)[0] === 0) {
          continue
        }

        const match = matches[index]
        const projected = transformPoint(this.cv, match.imageTwoPoint, homography)
        reprojectionError += Math.hypot(
          projected.x - match.imageOnePoint.x,
          projected.y - match.imageOnePoint.y,
        )
        reprojectionSamples += 1
      }
      reprojectionError = reprojectionSamples > 0
        ? reprojectionError / reprojectionSamples
        : Number.POSITIVE_INFINITY

      if (
        inliers < 4 ||
        inlierRatio < HOMOGRAPHY_CONFIG.minInlierRatio ||
        reprojectionError > HOMOGRAPHY_CONFIG.maxReprojectionError
      ) {
        homography.delete()
        throw new Error(
          `Homography quality failed: ${inliers} inliers, ${(inlierRatio * 100).toFixed(1)}% inlier ratio, ${reprojectionError.toFixed(2)}px reprojection error.`,
        )
      }

      return { matrix: homography, inliers, inlierRatio, reprojectionError }
    } finally {
      sourcePoints.delete()
      destinationPoints.delete()
      inlierMask.delete()
    }
  }
}

export function transformPoint(
  cv: CvModule,
  point: { x: number; y: number },
  matrix: CvMat,
) {
  const source = new cv.Mat(1, 1, cv.CV_32FC2)
  const destination = new cv.Mat()
  try {
    source.data32F[0] = point.x
    source.data32F[1] = point.y
    cv.perspectiveTransform(source, destination, matrix)
    return { x: destination.data32F[0], y: destination.data32F[1] }
  } finally {
    source.delete()
    destination.delete()
  }
}
