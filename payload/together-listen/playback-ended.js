if (this && this.__mineradioCuefieldEndedRecoveryToken === token) return;
    if (window.MineradioTogetherPlaybackController && window.MineradioTogetherPlaybackController.isConnected()) {
      finalizeListenSession(true);
      nextTrack(false);
      return;
    }
