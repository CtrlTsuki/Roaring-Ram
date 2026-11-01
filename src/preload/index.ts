import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { RRApi } from './api'

const api: RRApi = {
  capabilities: () => ipcRenderer.invoke('rr:caps'),
  snapshot: () => ipcRenderer.invoke('rr:snapshot'),
  onSnapshot: (fn) => {
    const handler = (_e: IpcRendererEvent, s: Parameters<typeof fn>[0]) => fn(s)
    ipcRenderer.on('rr:snapshot', handler)
    return () => ipcRenderer.removeListener('rr:snapshot', handler)
  },
  appDetail: (key) => ipcRenderer.invoke('rr:detail', key),
  previewRoaring: () => ipcRenderer.invoke('rr:roaring:preview'),
  runRoaring: (req) => ipcRenderer.invoke('rr:roaring:run', req),
  runTitan: (key) => ipcRenderer.invoke('rr:titan', key),
  askToClose: (key) => ipcRenderer.invoke('rr:close', key),
  saveSeal: (input) => ipcRenderer.invoke('rr:seal:save', input),
  removeSeal: (key) => ipcRenderer.invoke('rr:seal:remove', key),
  setSealEnabled: (key, enabled) => ipcRenderer.invoke('rr:seal:enabled', key, enabled),
  setWaterline: (bytes) => ipcRenderer.invoke('rr:waterline', bytes),
  clearEchoes: () => ipcRenderer.invoke('rr:echoes:clear'),
  appIcon: (key) => ipcRenderer.invoke('rr:icon', key)
}

contextBridge.exposeInMainWorld('rr', api)
