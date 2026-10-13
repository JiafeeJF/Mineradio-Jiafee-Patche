var playbackStarted = opts.startPaused === true
        ? true
        : await playAudio({ manual: !!opts.manual, silent: isQQPlayback || !!opts.startupAutoplay || !opts.manual, startupAutoplay: !!opts.startupAutoplay, trackSwitch: true, resumeRecovery: !!opts.resumeRecovery, fade: albumGaplessHandoff ? false : opts.fade, preserveGain: albumGaplessMixed, expectedMedia: playbackMedia, expectedToken: token });
      if (opts.startPaused === true) {
        if (!audio.paused) audio.pause();
        playing = false;
        setPlayIcon(false);
        hideLoading();
      }
