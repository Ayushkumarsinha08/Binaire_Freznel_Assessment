import { Button, Flex, Heading, Text, View } from '@adobe/react-spectrum'

type HeaderProps = {
  onExportClick: () => void
  exportDisabled?: boolean
}

export default function Header({ onExportClick, exportDisabled = true }: HeaderProps) {
  return (
    <header className="app-header">
      <Flex alignItems="center" gap="size-200">
        <View UNSAFE_className="app-logo" aria-label="Panorama Studio logo" />
        <Heading level={1} UNSAFE_className="app-title">
          Panorama Studio
        </Heading>
      </Flex>

      <Button variant="accent" isDisabled={exportDisabled} onPress={onExportClick}>
        <Text>Export</Text>
      </Button>
    </header>
  )
}
