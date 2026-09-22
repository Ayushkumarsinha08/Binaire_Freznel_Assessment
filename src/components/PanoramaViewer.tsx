import { ActionButton, Flex, Slider, Text, View } from '@adobe/react-spectrum'
import { useEffect, useRef, useState } from 'react'

import type { PanoramaResult } from '../core/StitchingPipeline'

type PanoramaViewerProps = {
  zoom: number
  rotation: number
  onZoomIn: () => void
  onZoomOut: () => void
  onReset: () => void
  onRotationChange: (value: number) => void
  panorama: PanoramaResult | null
}

export default function PanoramaViewer({
  zoom,
  rotation,
  onZoomIn,
  onZoomOut,
  onReset,
  onRotationChange,
  panorama,
}: PanoramaViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const dragStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 })

  useEffect(() => {
    if (!panorama || !canvasRef.current) {
      return
    }

    const canvas = canvasRef.current
    canvas.width = panorama.width
    canvas.height = panorama.height
    const context = canvas.getContext('2d')
    if (!context) {
      return
    }

    const pixels = new Uint8ClampedArray(panorama.data)
    context.putImageData(new ImageData(pixels as ImageDataArray, panorama.width, panorama.height), 0, 0)
  }, [panorama])

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (event.deltaY < 0) onZoomIn()
    if (event.deltaY > 0) onZoomOut()
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!panorama) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragStartRef.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y }
    setIsDragging(true)
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return
    setPan({
      x: dragStartRef.current.panX + event.clientX - dragStartRef.current.x,
      y: dragStartRef.current.panY + event.clientY - dragStartRef.current.y,
    })
  }

  const stopDragging = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    setIsDragging(false)
  }

  const handleReset = () => {
    setPan({ x: 0, y: 0 })
    onReset()
  }

  return (
    <View UNSAFE_className="viewer-panel">
      <div
        className={`viewer-canvas${isDragging ? ' is-dragging' : ''}`}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopDragging}
        onPointerCancel={stopDragging}
      >
        {panorama ? (
          <canvas
            ref={canvasRef}
            className="panorama-output"
            aria-label="Stitched panorama"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom}) rotate(${rotation}deg)`,
            }}
          />
        ) : (
          <Flex
            direction="column"
            justifyContent="center"
            alignItems="center"
            gap="size-200"
            UNSAFE_className="viewer-empty"
          >
            <View UNSAFE_className="viewer-placeholder-icon" aria-hidden="true">
              <Text>◉</Text>
            </View>
            <Text UNSAFE_className="viewer-empty-title">Your panorama will appear here</Text>
            <Text UNSAFE_className="viewer-empty-text">Add images and stitch them to get started</Text>
          </Flex>
        )}
      </div>

      <Flex alignItems="center" justifyContent="space-between" gap="size-200" UNSAFE_className="viewer-toolbar">
        <Flex alignItems="center" gap="size-100">
          <ActionButton aria-label="Zoom out" onPress={onZoomOut} isQuiet>
            −
          </ActionButton>
          <Text UNSAFE_className="zoom-readout">{Math.round(zoom * 100)}%</Text>
          <ActionButton aria-label="Zoom in" onPress={onZoomIn} isQuiet>
            +
          </ActionButton>
        </Flex>

        <Flex alignItems="center" gap="size-100">
          <ActionButton aria-label="Pan left" onPress={() => setPan((current) => ({ ...current, x: current.x - 40 }))} isQuiet>
            ←
          </ActionButton>
          <ActionButton aria-label="Reset view" onPress={handleReset} isQuiet>
            Reset
          </ActionButton>
          <ActionButton aria-label="Pan right" onPress={() => setPan((current) => ({ ...current, x: current.x + 40 }))} isQuiet>
            →
          </ActionButton>
        </Flex>
      </Flex>

      <View UNSAFE_className="rotation-control">
        <Text UNSAFE_className="rotation-label">Rotation</Text>
        <Slider
          label="Rotation"
          minValue={-180}
          maxValue={180}
          step={1}
          value={rotation}
          onChange={onRotationChange}
        />
        <Text UNSAFE_className="rotation-value">{Math.round(rotation)}°</Text>
      </View>
    </View>
  )
}
