progressDragState.resumeAfterSeek = !!(audio && !audio.paused && !audio.ended && playing);
  var togetherSeekControlled = !!(window.MineradioTogetherPlaybackController && window.MineradioTogetherPlaybackController.isConnected());
