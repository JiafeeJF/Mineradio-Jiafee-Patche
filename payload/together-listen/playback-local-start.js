var playbackStarted = opts.startPaused === true
    ? true
    : await playAudio({ manual: !!opts.manual, silent: !!opts.startupAutoplay || !opts.manual, startupAutoplay: !!opts.startupAutoplay, trackSwitch: true, resumeRecovery: !!opts.resumeRecovery });
  if (opts.startPaused === true) {
    if (!audio.paused) audio.pause();
    playing = false;
    setPlayIcon(false);
    hideLoading();
  }
