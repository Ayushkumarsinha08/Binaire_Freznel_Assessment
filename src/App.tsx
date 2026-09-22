import { defaultTheme, Flex, Provider, Text } from '@adobe/react-spectrum'
import { useEffect, useState } from 'react'

import './App.css'
import EmptyState from './components/EmptyState'
import ExportDialog from './components/ExportDialog'
import Header from './components/Header'
import ImageTray from './components/ImageTray'
import PanoramaViewer from './components/PanoramaViewer'
import ProcessingProgress from './components/ProcessingProgress'
import StitchControls from './components/StitchControls'
import { openCVService } from './core/OpenCVService'
import {
  StitchingPipeline,
  type CylindricalDiagnostic,
  type PanoramaResult,
} from './core/StitchingPipeline'
import type { ImageItem, OutputFormat, PanoramaType } from './types'

const supportedExtensions = new Set(['jpg', 'jpeg', 'png', 'avif'])

const isSupportedImage = (image: ImageItem) => {
  const extension = image.name.split('.').pop()?.toLowerCase()
  return Boolean(extension && supportedExtensions.has(extension))
}

function App() {
  const [images, setImages] = useState<ImageItem[]>([])
  const [panoramaType, setPanoramaType] = useState<PanoramaType>('cylindrical')
  const [outputFormat, setOutputFormat] = useState<OutputFormat>('jpeg')
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [progressMessage, setProgressMessage] = useState('Loading images...')
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [imageError, setImageError] = useState('')
  const [opencvReady, setOpencvReady] = useState(false)
  const [opencvError, setOpencvError] = useState('')
  const [stitchError, setStitchError] = useState('')
  const [stitchDiagnostics, setStitchDiagnostics] = useState<CylindricalDiagnostic[]>([])
  const [panorama, setPanorama] = useState<PanoramaResult | null>(null)
  const [exportMessage, setExportMessage] = useState('')
  const [exportError, setExportError] = useState('')

  useEffect(() => {
    void openCVService.load()
      .then(() => setOpencvReady(true))
      .catch(() => setOpencvError('Computer vision could not be initialized.'))
  }, [])

  const handleAddImages = async () => {
    try {
      const selectedImages = await window.electronAPI.openImages()
      const existingPaths = new Set(images.map((image) => image.path))
      const newImages = selectedImages.filter((image) => {
        if (!isSupportedImage(image) || existingPaths.has(image.path)) {
          return false
        }

        existingPaths.add(image.path)
        return true
      })

      setImages((current) => [...current, ...newImages])
      setImageError(
        newImages.length < selectedImages.length
          ? 'Some files were unsupported or already added.'
          : '',
      )
    } catch {
      setImageError('Unable to open the image picker.')
    }
  }

  const handleRemoveImage = (id: string) => {
    setImages((current) => current.filter((image) => image.id !== id))
  }

  const handleClearImages = () => {
    setImages([])
    setImageError('')
  }

  const handleZoomIn = () => setZoom((current) => Math.min(current + 0.1, 3))
  const handleZoomOut = () => setZoom((current) => Math.max(current - 0.1, 0.25))
  const handleReset = () => {
    setZoom(1)
    setRotation(0)
  }

  const handleExport = async () => {
    if (!panorama) {
      setExportError('Create a panorama before exporting.')
      return
    }

    setExportMessage('')
    setExportError('')
    try {
      const result = await window.electronAPI.exportPanorama({
        width: panorama.width,
        height: panorama.height,
        data: panorama.data,
        format: outputFormat,
      })
      if (result.canceled) return
      if (!result.success) {
        setExportError(result.error || 'The panorama could not be exported.')
        return
      }
      setIsExportDialogOpen(false)
      setExportMessage('Panorama exported successfully.')
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'The panorama could not be exported.')
    }
  }

  const handleStitch = async () => {
    if (isProcessing || images.length < 2 || !opencvReady) {
      return
    }

    setIsProcessing(true)
    setStitchError('')
    setStitchDiagnostics([])

    try {
      const cv = await openCVService.load()
      const pipeline = new StitchingPipeline(cv, (filePath) => window.electronAPI.getImagePixels(filePath))
      const result = await pipeline.stitchWithMode(images, (value, message) => {
        setProgress(value)
        setProgressMessage(message)
      }, panoramaType)
      setStitchDiagnostics(result.diagnostics)
      if (result.success) {
        setPanorama(result.panorama)
      } else {
        setStitchError(result.error)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The panorama could not be created.'
      setStitchError(message)
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <Provider theme={defaultTheme} colorScheme="dark">
      <div className="app-shell">
        <Header onExportClick={() => setIsExportDialogOpen(true)} exportDisabled={!panorama} />

        <main className="workspace-layout">
          <aside className="sidebar-panel">
            <div className="panel-header-row">
              <h2>Images</h2>
              <button type="button" className="panel-action-button" onClick={handleAddImages}>
                + Add Images
              </button>
            </div>

            <ImageTray
              images={images}
              errorMessage={imageError}
              onAddImages={handleAddImages}
              onClearImages={handleClearImages}
              onRemoveImage={handleRemoveImage}
            />
          </aside>

          <section className="main-panel">
            <PanoramaViewer
              zoom={zoom}
              rotation={rotation}
              onZoomIn={handleZoomIn}
              onZoomOut={handleZoomOut}
              onReset={handleReset}
              onRotationChange={setRotation}
              panorama={panorama}
            />

            {exportMessage || exportError ? (
              <div className="stitch-error" role={exportError ? 'alert' : 'status'}>
                <Text>{exportError || exportMessage}</Text>
              </div>
            ) : null}

            <ProcessingProgress
              isVisible={!opencvReady && !opencvError || isProcessing}
              progress={isProcessing ? progress : 0}
              message={isProcessing ? progressMessage : 'Loading computer vision engine...'}
            />
            {opencvError || stitchError ? (
              <div className="stitch-error" role="alert">
                <Flex direction="column" gap="size-50">
                  {opencvError ? <Text>{opencvError}</Text> : null}
                  {stitchError && !opencvError ? (
                    <>
                      <Text UNSAFE_className="stitch-error-title">Stitching failed</Text>
                      <Text>{stitchError}</Text>
                      {stitchDiagnostics.map((diagnostic) => (
                        <div key={diagnostic.pairIndex} className="diagnostic-card">
                          <Text UNSAFE_className="diagnostic-heading">
                            Pair {diagnostic.pairIndex}: {diagnostic.imageA} → {diagnostic.imageB}
                          </Text>
                          <Text>Keypoints: {diagnostic.keypointsA} / {diagnostic.keypointsB}</Text>
                          <Text>Raw matches: {diagnostic.rawMatches}</Text>
                          <Text>Good matches: {diagnostic.goodMatches}</Text>
                          <Text>Ratio matches: {diagnostic.ratioMatches}</Text>
                          <Text>Mutual matches: {diagnostic.mutualMatches}</Text>
                          <Text>Translation inliers: {diagnostic.translationInliers}</Text>
                          <Text>Translation inlier ratio: {(diagnostic.translationInlierRatio * 100).toFixed(1)}%</Text>
                          <Text>Median DX: {diagnostic.medianDx.toFixed(2)} px</Text>
                          <Text>Median DY: {diagnostic.medianDy.toFixed(2)} px</Text>
                          <Text>DX deviation: {diagnostic.dxStandardDeviation.toFixed(2)} px</Text>
                          <Text>DY deviation: {diagnostic.dyStandardDeviation.toFixed(2)} px</Text>
                          <Text>Alignment residual: {diagnostic.alignmentResidual.toFixed(2)} px</Text>
                          {diagnostic.failureReason ? <Text>Failure: {diagnostic.failureReason}</Text> : null}
                        </div>
                      ))}
                    </>
                  ) : null}
                </Flex>
              </div>
            ) : null}

            <div className="stitch-section">
              <StitchControls
                panoramaType={panoramaType}
                outputFormat={outputFormat}
                isProcessing={isProcessing}
                canStitch={images.length >= 2}
                opencvReady={opencvReady}
                onPanoramaTypeChange={setPanoramaType}
                onOutputFormatChange={setOutputFormat}
                onStitch={handleStitch}
              />
            </div>
          </section>
        </main>

        <ExportDialog
          isOpen={isExportDialogOpen}
          selectedFormat={outputFormat}
          onClose={() => setIsExportDialogOpen(false)}
          onFormatChange={setOutputFormat}
          onExport={handleExport}
          errorMessage={exportError}
        />

        {images.length === 0 && (
          <div className="floating-empty-state">
            <EmptyState
              title="Add images to create a panorama"
              description="JPEG, PNG, and AVIF are supported."
              actionLabel="Add Images"
              onAction={handleAddImages}
            />
          </div>
        )}
      </div>
    </Provider>
  )
}

export default App
