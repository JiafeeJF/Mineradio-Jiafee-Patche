const TOGETHER_CONTROL_TYPES = new Set([
  TOGETHER_MESSAGE_TYPES.PLAY,
  TOGETHER_MESSAGE_TYPES.PAUSE,
  TOGETHER_MESSAGE_TYPES.SEEK,
  TOGETHER_MESSAGE_TYPES.NEXT,
  TOGETHER_MESSAGE_TYPES.PREVIOUS,
  TOGETHER_MESSAGE_TYPES.QUEUE_ADD,
  TOGETHER_MESSAGE_TYPES.QUEUE_REMOVE,
  TOGETHER_MESSAGE_TYPES.SET_MODE,
  TOGETHER_MESSAGE_TYPES.READY,
  TOGETHER_MESSAGE_TYPES.PRESENCE,
  TOGETHER_MESSAGE_TYPES.MESSAGE_SEND,
  TOGETHER_MESSAGE_TYPES.RESYNC,
]);

function requireTrustedTogetherIpc(event) {
  if (!isTrustedMainWindowIpc(event)) throw new Error('UNTRUSTED_RENDERER');
}

ipcMain.handle('mineradio-together-status', (event) => {
  requireTrustedTogetherIpc(event);
  return togetherListenManager.status();
});
ipcMain.handle('mineradio-together-create-room', async (event, payload = {}) => {
  requireTrustedTogetherIpc(event);
  return togetherListenManager.createRoom({ name: String(payload.name || ''), port: payload.port });
});
ipcMain.handle('mineradio-together-discover', async (event) => {
  requireTrustedTogetherIpc(event);
  return togetherListenManager.discover();
});
ipcMain.handle('mineradio-together-probe', async (event, address) => {
  requireTrustedTogetherIpc(event);
  return togetherListenManager.probe(String(address || ''));
});
ipcMain.handle('mineradio-together-diagnose', async (event, address, options = {}) => {
  requireTrustedTogetherIpc(event);
  return togetherListenManager.diagnose(String(address || ''), { authorizationCode: String(options.authorizationCode || '') });
});
ipcMain.handle('mineradio-together-connect', async (event, address, options = {}) => {
  requireTrustedTogetherIpc(event);
  return togetherListenManager.connect(String(address || ''), {
    savedServerId: String(options.savedServerId || ''),
    authorizationCode: String(options.authorizationCode || ''),
  });
});
ipcMain.handle('mineradio-together-leave', async (event, stopHost) => {
  requireTrustedTogetherIpc(event);
  return togetherListenManager.leave({ stopHost: stopHost === true });
});
ipcMain.handle('mineradio-together-operation', (event, type, payload = {}, source = 'local', operationId = '') => {
  requireTrustedTogetherIpc(event);
  const normalizedType = String(type || '').toUpperCase();
  if (!TOGETHER_CONTROL_TYPES.has(normalizedType)) throw new Error('INVALID_OPERATION_TYPE');
  const normalizedSource = source === 'system' ? 'system' : 'local';
  return togetherListenManager.request(normalizedType, payload && typeof payload === 'object' ? payload : {}, normalizedSource, String(operationId || ''));
});
ipcMain.handle('mineradio-together-saved-list', (event) => {
  requireTrustedTogetherIpc(event);
  return togetherListenManager.listSaved();
});
ipcMain.handle('mineradio-together-profile-get', (event) => {
  requireTrustedTogetherIpc(event);
  return togetherListenManager.getProfile();
});
ipcMain.handle('mineradio-together-profile-save', (event, payload = {}) => {
  requireTrustedTogetherIpc(event);
  return togetherListenManager.saveProfile({ name: String(payload.name || ''), avatar: String(payload.avatar || '') });
});
ipcMain.handle('mineradio-together-saved-upsert', (event, payload = {}) => {
  requireTrustedTogetherIpc(event);
  return togetherListenManager.saveServer(payload);
});
ipcMain.handle('mineradio-together-saved-delete', (event, id) => {
  requireTrustedTogetherIpc(event);
  return togetherListenManager.deleteServer(String(id || ''));
});
ipcMain.handle('mineradio-together-debug-log', (event) => {
  requireTrustedTogetherIpc(event);
  return togetherListenManager.getDebugLog();
});
ipcMain.handle('mineradio-together-debug-mode', (event, enabled) => {
  requireTrustedTogetherIpc(event);
  return togetherListenManager.setDebugMode(enabled === true);
});
