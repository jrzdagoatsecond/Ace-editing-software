'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('ace', {
  importDialog: (kind) => ipcRenderer.invoke('import:dialog', kind),
  probe: (paths) => ipcRenderer.invoke('media:probe', paths),
  pathFor: (file) => webUtils.getPathForFile(file),
  chooseOutput: (name, ext, label) => ipcRenderer.invoke('export:choose', name, ext, label),
  startExport: (job) => ipcRenderer.invoke('export:start', job),
  cancelExport: () => ipcRenderer.invoke('export:cancel'),
  onProgress: (cb) => ipcRenderer.on('export:progress', (_e, v) => cb(v)),
  saveProject: (args) => ipcRenderer.invoke('project:save', args),
  openProject: () => ipcRenderer.invoke('project:open'),
  showItem: (p) => ipcRenderer.invoke('shell:show', p)
});
