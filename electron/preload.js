import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  appVersion: '1.0.0',
  isElectron: true,
  openImages: () => ipcRenderer.invoke('images:open'),
  getImageThumbnail: (filePath) => ipcRenderer.invoke('images:thumbnail', filePath),
  getImagePixels: (filePath) => ipcRenderer.invoke('images:pixels', filePath),
  exportPanorama: (request) => ipcRenderer.invoke('panorama:export', request),
})
