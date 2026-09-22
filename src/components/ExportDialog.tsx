import {
  Button,
  ButtonGroup,
  Content,
  Dialog,
  DialogContainer,
  Divider,
  Heading,
  Item,
  Picker,
  Text,
  View,
} from '@adobe/react-spectrum'

import type { OutputFormat } from '../types'

type ExportDialogProps = {
  isOpen: boolean
  selectedFormat: OutputFormat
  onClose: () => void
  onFormatChange: (value: OutputFormat) => void
  onExport: () => void
  errorMessage?: string
}

export default function ExportDialog({
  isOpen,
  selectedFormat,
  onClose,
  onFormatChange,
  onExport,
  errorMessage,
}: ExportDialogProps) {
  return (
    <DialogContainer onDismiss={onClose}>
      {isOpen ? (
        <Dialog>
          <Heading>Export Panorama</Heading>
          <Divider />
          <Content>
            <View UNSAFE_className="export-dialog-body">
              <Picker
                label="Format"
                selectedKey={selectedFormat}
                onSelectionChange={(key) => onFormatChange(String(key) as OutputFormat)}
                width="size-2400"
              >
                <Item key="jpeg">JPEG</Item>
                <Item key="png">PNG</Item>
                <Item key="avif">AVIF</Item>
              </Picker>
              {errorMessage ? <Text UNSAFE_className="stitch-error-title">{errorMessage}</Text> : null}
            </View>
          </Content>
          <ButtonGroup>
            <Button variant="secondary" onPress={onClose}>
              Cancel
            </Button>
            <Button variant="accent" onPress={onExport}>
              Export
            </Button>
          </ButtonGroup>
        </Dialog>
      ) : null}
    </DialogContainer>
  )
}
