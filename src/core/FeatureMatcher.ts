type CvMat = any
type CvModule = any

export type FeatureMatch = {
  imageOneIndex: number
  imageTwoIndex: number
  imageOnePoint: { x: number; y: number }
  imageTwoPoint: { x: number; y: number }
}

export type MatchSet = {
  matches: FeatureMatch[]
  keypointsImageOne: number
  keypointsImageTwo: number
  rawMatches: number
  ratioMatches: number
  mutualMatches: number
}

export class FeatureMatcher {
  private readonly cv: CvModule

  constructor(cv: CvModule) {
    this.cv = cv
  }

  findGoodMatches(imageOne: CvMat, imageTwo: CvMat): MatchSet {
    const grayOne = new this.cv.Mat()
    const grayTwo = new this.cv.Mat()
    const maskOne = new this.cv.Mat()
    const maskTwo = new this.cv.Mat()
    const keypointsOne = new this.cv.KeyPointVector()
    const keypointsTwo = new this.cv.KeyPointVector()
    const descriptorsOne = new this.cv.Mat()
    const descriptorsTwo = new this.cv.Mat()
    const matcher = new this.cv.BFMatcher(this.cv.NORM_HAMMING, false)
    const forwardMatches = new this.cv.DMatchVectorVector()
    const reverseMatches = new this.cv.DMatchVectorVector()

    try {
      this.cv.cvtColor(imageOne, grayOne, this.cv.COLOR_RGBA2GRAY)
      this.cv.cvtColor(imageTwo, grayTwo, this.cv.COLOR_RGBA2GRAY)

      const orb = new this.cv.ORB(5000)
      orb.detectAndCompute(grayOne, maskOne, keypointsOne, descriptorsOne)
      orb.detectAndCompute(grayTwo, maskTwo, keypointsTwo, descriptorsTwo)
      orb.delete()

      if (keypointsOne.size() < 4 || keypointsTwo.size() < 4 || descriptorsOne.empty() || descriptorsTwo.empty()) {
        throw new Error(
          `Insufficient keypoints: Image A ${keypointsOne.size()}, Image B ${keypointsTwo.size()}.`,
        )
      }

      matcher.knnMatch(descriptorsOne, descriptorsTwo, forwardMatches, 2)
      matcher.knnMatch(descriptorsTwo, descriptorsOne, reverseMatches, 2)
      const rawMatches = forwardMatches.size()
      const ratioMatches: Array<{ queryIdx: number; trainIdx: number }> = []

      for (let index = 0; index < rawMatches; index += 1) {
        const pair = forwardMatches.get(index)
        try {
          if (pair.size() < 2) {
            continue
          }

          const best = pair.get(0)
          const secondBest = pair.get(1)
          if (best.distance < secondBest.distance * 0.8) {
            ratioMatches.push({ queryIdx: best.queryIdx, trainIdx: best.trainIdx })
          }
        } finally {
          pair.delete()
        }
      }

      const reverseBest = new Map<number, number>()
      for (let index = 0; index < reverseMatches.size(); index += 1) {
        const pair = reverseMatches.get(index)
        try {
          if (pair.size() > 0) {
            const best = pair.get(0)
            reverseBest.set(best.queryIdx, best.trainIdx)
          }
        } finally {
          pair.delete()
        }
      }

      const matches: FeatureMatch[] = []
      for (const candidate of ratioMatches) {
        if (reverseBest.get(candidate.trainIdx) !== candidate.queryIdx) {
          continue
        }

        const pointOne = keypointsOne.get(candidate.queryIdx).pt
        const pointTwo = keypointsTwo.get(candidate.trainIdx).pt
        matches.push({
          imageOneIndex: candidate.queryIdx,
          imageTwoIndex: candidate.trainIdx,
          imageOnePoint: { x: pointOne.x, y: pointOne.y },
          imageTwoPoint: { x: pointTwo.x, y: pointTwo.y },
        })
      }

      return {
        matches,
        keypointsImageOne: keypointsOne.size(),
        keypointsImageTwo: keypointsTwo.size(),
        rawMatches,
        ratioMatches: ratioMatches.length,
        mutualMatches: matches.length,
      }
    } finally {
      grayOne.delete()
      grayTwo.delete()
      maskOne.delete()
      maskTwo.delete()
      keypointsOne.delete()
      keypointsTwo.delete()
      descriptorsOne.delete()
      descriptorsTwo.delete()
      matcher.delete()
      forwardMatches.delete()
      reverseMatches.delete()
    }
  }
}
