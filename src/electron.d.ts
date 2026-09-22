import type { DecodedImage, ImageItem, OutputFormat } from './types'

declare global {
  interface Window {
    electronAPI: {
      platform: string
      appVersion: string
      isElectron: boolean
      openImages: () => Promise<ImageItem[]>
      getImageThumbnail: (filePath: string) => Promise<string | null>
      getImagePixels: (filePath: string) => Promise<DecodedImage | null>
      exportPanorama: (request: {
        width: number
        height: number
        data: Uint8ClampedArray
        format: OutputFormat
      }) => Promise<{ success?: boolean; canceled?: boolean; error?: string }>
    }
  }
}

export {}