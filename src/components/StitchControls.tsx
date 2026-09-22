import { Button, Flex, Item, Picker, Text, View } from '@adobe/react-spectrum'

import type { OutputFormat, PanoramaType } from '../types'

type StitchControlsProps = {
  panoramaType: PanoramaType
  outputFormat: OutputFormat
  isProcessing: boolean
  canStitch: boolean
  opencvReady: boolean
  onPanoramaTypeChange: (value: PanoramaType) => void
  onOutputFormatChange: (value: OutputFormat) => void
  onStitch: () => void
}

export default function StitchControls({
  panoramaType,
  outputFormat,
  isProcessing,
  canStitch,
  opencvReady,
  onPanoramaTypeChange,
  onOutputFormatChange,
  onStitch,
}: StitchControlsProps) {
  return (
    <View UNSAFE_className="stitch-panel">
      <Flex gap="size-300" wrap="wrap" alignItems="end">
        <Picker
          label="Panorama Type"
          selectedKey={panoramaType}
          onSelectionChange={(key) => onPanoramaTypeChange(String(key) as PanoramaType)}
          width="size-2400"
        >
          <Item key="cylindrical">Cylindrical</Item>
          <Item key="spherical">Spherical</Item>
        </Picker>

        <Picker
          label="Output Format"
          selectedKey={outputFormat}
          onSelectionChange={(key) => onOutputFormatChange(String(key) as OutputFormat)}
          width="size-2400"
        >
          <Item key="jpeg">JPEG</Item>
          <Item key="png">PNG</Item>
          <Item key="avif">AVIF</Item>
        </Picker>

        <Button
          variant="accent"
          onPress={onStitch}
          isDisabled={isProcessing || !canStitch || !opencvReady}
          UNSAFE_className="stitch-button"
        >
          {isProcessing ? 'Processing...' : 'Stitch Panorama'}
        </Button>
      </Flex>
      <Text UNSAFE_className="stitch-helper">Ready to process selected images</Text>
    </View>
  )
}
