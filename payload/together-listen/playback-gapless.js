function albumGaplessQueueCanAdvance(idx) {
  if (window.MineradioTogetherAdapter && window.MineradioTogetherAdapter.getRuntime().connected) return false;
