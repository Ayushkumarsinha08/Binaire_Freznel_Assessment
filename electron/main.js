import { app, BrowserWindow, dialog, ipcMain, nativeImage } from 'electron'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const isDev = !app.isPackaged

const imageFormats = new Map([
  ['jpg', 'jpeg'],
  ['jpeg', 'jpeg'],
  ['png', 'png'],
  ['avif', 'avif'],
])
const selectedImagePaths = new Set()

ipcMain.handle('images:open', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Add images',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'avif'] }],
  })

  if (result.canceled) {
    return []
  }

  return result.filePaths.flatMap((filePath) => {
    const extension = path.extname(filePath).slice(1).toLowerCase()
    const format = imageFormats.get(extension)

    if (!format) {
      return []
    }

    selectedImagePaths.add(filePath)

    return [{
      id: randomUUID(),
      path: filePath,
      name: path.basename(filePath),
      format,
    }]
  })
})

ipcMain.handle('images:thumbnail', async (_event, filePath) => {
  if (typeof filePath !== 'string' || !selectedImagePaths.has(filePath)) {
    return null
  }

  const extension = path.extname(filePath).slice(1).toLowerCase()
  if (!imageFormats.has(extension)) {
    return null
  }

  try {
    const sourceImage = nativeImage.createFromPath(filePath)

    if (sourceImage.isEmpty()) {
      return null
    }

    const thumbnail = sourceImage.resize({
      width: 260,
      height: 180,
      quality: 'best',
    })

    if (thumbnail.isEmpty()) {
      return null
    }

    return thumbnail.toDataURL()
  } catch {
    return null
  }
})

ipcMain.handle('images:pixels', async (_event, filePath) => {
  if (typeof filePath !== 'string' || !selectedImagePaths.has(filePath)) {
    return null
  }

  const extension = path.extname(filePath).slice(1).toLowerCase()
  if (!imageFormats.has(extension)) {
    return null
  }

  try {
    const sourceImage = nativeImage.createFromPath(filePath)
    if (sourceImage.isEmpty()) {
      return null
    }

    const sourceSize = sourceImage.getSize()
    const scale = Math.min(1, 1600 / Math.max(sourceSize.width, sourceSize.height))
    const image = scale < 1
      ? sourceImage.resize({
          width: Math.max(1, Math.round(sourceSize.width * scale)),
          height: Math.max(1, Math.round(sourceSize.height * scale)),
          quality: 'best',
        })
      : sourceImage
    const size = image.getSize()
    const bitmap = image.toBitmap()
    const rgba = new Uint8Array(bitmap.length)

    for (let index = 0; index < bitmap.length; index += 4) {
      rgba[index] = bitmap[index + 2]
      rgba[index + 1] = bitmap[index + 1]
      rgba[index + 2] = bitmap[index]
      rgba[index + 3] = bitmap[index + 3]
    }

    return { width: size.width, height: size.height, data: rgba }
  } catch {
    return null
  }
})

ipcMain.handle('panorama:export', async (_event, request) => {
  if (!request || !['jpeg', 'png', 'avif'].includes(request.format)) {
    return { success: false, error: 'Choose a supported export format.' }
  }

  const { width, height, data, format } = request
  if (!Number.isInteger(width) || !Number.isInteger(height) || !data || data.length !== width * height * 4) {
    return { success: false, error: 'The stitched panorama data is invalid.' }
  }

  const extension = format === 'jpeg' ? 'jpg' : format
  const result = await dialog.showSaveDialog({
    title: 'Export panorama',
    defaultPath: `panorama.${extension}`,
    filters: format === 'jpeg'
      ? [{ name: 'JPEG image', extensions: ['jpg', 'jpeg'] }]
      : [{ name: `${format.toUpperCase()} image`, extensions: [extension] }],
  })

  if (result.canceled || !result.filePath) {
    return { canceled: true }
  }

  try {
    let encoder = sharp(Buffer.from(data), { raw: { width, height, channels: 4 } })
    if (format === 'jpeg') {
      encoder = encoder.jpeg({ quality: 90 })
    } else if (format === 'png') {
      encoder = encoder.png()
    } else {
      encoder = encoder.avif({ quality: 80 })
    }
    await encoder.toFile(result.filePath)
    return { success: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The panorama could not be exported.'
    return { success: false, error: message }
  }
})

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 1500,
    height: 980,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#0f172a',
    title: 'Panorama Studio',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      devTools: true,
    },
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
