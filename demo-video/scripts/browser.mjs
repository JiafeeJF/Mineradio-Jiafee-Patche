import fs from "node:fs";
// Prefer an installed browser. If absent, Remotion manages its own headless browser.
export function findBrowser() {
  if (process.env.REMOTION_BROWSER_EXECUTABLE)
    return process.env.REMOTION_BROWSER_EXECUTABLE;
  return [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
  ].find((p) => fs.existsSync(p));
}
