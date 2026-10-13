const runtimeCleanup = Promise.all([
  fullDesktopAndWallpaperEngineCleanup,
  togetherListenManager.close().catch((error) => console.warn('[TogetherListen] shutdown failed:', error && error.message || error)),
]);
