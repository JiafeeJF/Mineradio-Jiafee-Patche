// @ts-nocheck
/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/require-await */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jiafeePatch', {
  list: () => ipcRenderer.invoke('patch:list'),
  detect: (patchIds) => ipcRenderer.invoke('patch:detect', patchIds),
  inspect: (targetDir, patchIds) => ipcRenderer.invoke('patch:inspect', targetDir, patchIds),
  choose: (patchIds) => ipcRenderer.invoke('patch:choose', patchIds),
  install: (targetDir, patchIds) => ipcRenderer.invoke('patch:install', targetDir, patchIds),
  uninstall: (targetDir, patchIds) => ipcRenderer.invoke('patch:uninstall', targetDir, patchIds),
  openDir: (targetDir) => ipcRenderer.invoke('patch:openDir', targetDir),
});
