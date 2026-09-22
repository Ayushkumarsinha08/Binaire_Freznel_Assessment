import cvModule from '@techstark/opencv-js'

type OpenCVModule = typeof import('@techstark/opencv-js')

let readyPromise: Promise<OpenCVModule> | undefined

const isReady = (value: unknown): value is OpenCVModule => {
  return Boolean(value && typeof value === 'object' && 'Mat' in value)
}

export class OpenCVService {
  load(): Promise<OpenCVModule> {
    if (readyPromise) {
      return readyPromise
    }

    readyPromise = new Promise<OpenCVModule>((resolve, reject) => {
      const candidate = cvModule as unknown as any

      if (isReady(candidate)) {
        resolve(candidate)
        return
      }

      if (candidate instanceof Promise) {
        candidate.then((module: OpenCVModule) => resolve(module)).catch(reject)
        return
      }

      candidate.onRuntimeInitialized = () => resolve(candidate)
    })

    return readyPromise
  }

}

export const openCVService = new OpenCVService()