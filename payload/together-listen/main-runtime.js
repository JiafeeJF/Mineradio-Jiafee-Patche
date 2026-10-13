const togetherListenManager = new TogetherListenManager({ userDataPath: STABLE_USER_DATA_PATH });
togetherListenManager.on('event', (payload) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('mineradio-together-event', payload);
});
