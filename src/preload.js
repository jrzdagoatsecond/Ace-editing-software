'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('ace', {
  importDialog: () => ipcRenderer.invoke('import:dialog'),
  probe: (paths) => ipcRenderer.invoke('media:probe', paths),
  pathFor: (file) => webUtils.getPathForFile(file),
  chooseOutput: (name) => ipcRenderer.invoke('export:choose', name),
  startExport: (job) => ipcRenderer.invoke('export:start', job),
  cancelExport: () => ipcRenderer.invoke('export:cancel'),
  onProgress: (cb) => ipcRenderer.on('export:progress', (_e, v) => cb(v)),
  saveProject: (args) => ipcRenderer.invoke('project:save', args),
  openProject: () => ipcRenderer.invoke('project:open'),
  showItem: (p) => ipcRenderer.invoke('shell:show', p)
});
