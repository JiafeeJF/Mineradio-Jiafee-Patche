'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const listeners = new Map();
function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  const token = Symbol(channel);
  listeners.set(token, [channel, listener]);
  return () => {
    const item = listeners.get(token);
    if (!item) return;
    ipcRenderer.removeListener(item[0], item[1]);
    listeners.delete(token);
  };
}

contextBridge.exposeInMainWorld('relayControl', Object.freeze({
  bootstrap: () => ipcRenderer.invoke('control:bootstrap'),
  saveConfig: (config, authorizationCode) => ipcRenderer.invoke('control:save-config', config, authorizationCode),
  revealAuthorizationCode: () => ipcRenderer.invoke('control:reveal-code'),
  generateAuthorizationCode: () => ipcRenderer.invoke('control:generate-code'),
  start: () => ipcRenderer.invoke('control:start'),
  stop: () => ipcRenderer.invoke('control:stop'),
  restart: () => ipcRenderer.invoke('control:restart'),
  setAutoStart: (enabled) => ipcRenderer.invoke('control:set-auto-start', enabled),
  exportDiagnostics: () => ipcRenderer.invoke('control:export-diagnostics'),
  openDataDirectory: () => ipcRenderer.invoke('control:open-data-directory'),
  getFirewallCommand: (port) => ipcRenderer.invoke('control:firewall-command', port),
  clearLogs: () => ipcRenderer.invoke('control:clear-logs'),
  onState: (callback) => subscribe('control:state', callback),
  onLog: (callback) => subscribe('control:log', callback),
  onLogsCleared: (callback) => subscribe('control:logs-cleared', callback),
}));

