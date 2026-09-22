export type PanoramaType = 'cylindrical' | 'spherical'

export type OutputFormat = 'jpeg' | 'png' | 'avif'

export type ImageFormat = 'jpeg' | 'png' | 'avif'

export type ImageItem = {
  id: string
  path: string
  name: string
  format: ImageFormat
}

export type DecodedImage = {
  width: number
  height: number
  data: Uint8Array
}
