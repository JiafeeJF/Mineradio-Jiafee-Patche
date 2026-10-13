contextBridge.exposeInMainWorld('togetherListen', {
  getStatus: () => ipcRenderer.invoke('mineradio-together-status'),
  createRoom: (payload) => ipcRenderer.invoke('mineradio-together-create-room', payload || {}),
  discover: () => ipcRenderer.invoke('mineradio-together-discover'),
  probeServer: (address) => ipcRenderer.invoke('mineradio-together-probe', String(address || '')),
  diagnoseConnection: (address, options) => ipcRenderer.invoke('mineradio-together-diagnose', String(address || ''), options || {}),
  connect: (address, options) => ipcRenderer.invoke('mineradio-together-connect', String(address || ''), options || {}),
  leave: (stopHost) => ipcRenderer.invoke('mineradio-together-leave', stopHost === true),
  sendOperation: (type, payload, source, operationId) => ipcRenderer.invoke('mineradio-together-operation', String(type || ''), payload || {}, String(source || 'local'), String(operationId || '')),
  getProfile: () => ipcRenderer.invoke('mineradio-together-profile-get'),
  saveProfile: (payload) => ipcRenderer.invoke('mineradio-together-profile-save', payload || {}),
  listSavedServers: () => ipcRenderer.invoke('mineradio-together-saved-list'),
  saveServer: (payload) => ipcRenderer.invoke('mineradio-together-saved-upsert', payload || {}),
  deleteServer: (id) => ipcRenderer.invoke('mineradio-together-saved-delete', String(id || '')),
  getDebugLog: () => ipcRenderer.invoke('mineradio-together-debug-log'),
  setDebugMode: (enabled) => ipcRenderer.invoke('mineradio-together-debug-mode', enabled === true),
  copyText: (value) => { clipboard.writeText(String(value || '')); return true; },
  onEvent: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload || {});
    ipcRenderer.on('mineradio-together-event', listener);
    return () => ipcRenderer.removeListener('mineradio-together-event', listener);
  },
});
