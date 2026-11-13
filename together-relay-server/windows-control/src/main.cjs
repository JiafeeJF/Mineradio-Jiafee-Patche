'use strict';

const { app, BrowserWindow, Menu, Tray, ipcMain, safeStorage, dialog, shell, clipboard, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const { ConfigStore } = require('./config-store.cjs');
const { RelayController } = require('./relay-controller.cjs');
const { generateAuthorizationCode } = require('./validation.cjs');

if (!app.requestSingleInstanceLock()) app.quit();

let window = null;
let tray = null;
let store = null;
let controller = null;
let quitting = false;
let shutdownStarted = false;

const root = path.resolve(__dirname, '..');
const runtimeDirectory = app.isPackaged
  ? path.join(process.resourcesPath, 'relay-runtime')
  : path.join(root, 'runtime');
const iconPath = path.join(root, 'build', 'icon.ico');

function send(channel, payload) {
  if (window && !window.isDestroyed()) window.webContents.send(channel, payload);
}

function runtimeConfig() {
  const config = store.getRuntime();
  return { ...config, restartOnCrash: config.restartOnCrash };
}

function trayMenu(state = controller.snapshot()) {
  return Menu.buildFromTemplate([
    { label: state.phase === 'running' ? `运行中 · ${state.members}/2 人` : '中转服务未运行', enabled: false },
    { type: 'separator' },
    { label: '打开控制台', click: showWindow },
    { label: '启动服务', enabled: state.phase === 'stopped' || state.phase === 'error', click: () => controller.start(runtimeConfig()).catch(() => {}) },
    { label: '停止服务', enabled: state.phase === 'running' || state.phase === 'starting', click: () => controller.stop() },
    { type: 'separator' },
    { label: '退出控制台并停止服务', click: () => { quitting = true; app.quit(); } },
  ]);
}

function showWindow() {
  if (!window) return;
  window.show();
  window.focus();
}

function createWindow() {
  window = new BrowserWindow({
    width: 1180, height: 760, minWidth: 900, minHeight: 640,
    show: false, backgroundColor: '#090b0e', icon: iconPath,
    title: 'Mineradio 一起听中转控制台',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  window.removeMenu();
  window.loadFile(path.join(root, 'renderer', 'index.html'));
  window.once('ready-to-show', () => {
    const config = store.getPublic();
    if (!config.startMinimized && !process.env.RELAY_CONTROL_TEST_MODE) window.show();
    if (process.env.RELAY_CONTROL_CAPTURE_PATH) {
      setTimeout(async () => {
        const image = await window.webContents.capturePage();
        fs.mkdirSync(path.dirname(process.env.RELAY_CONTROL_CAPTURE_PATH), { recursive: true });
        fs.writeFileSync(process.env.RELAY_CONTROL_CAPTURE_PATH, image.toPNG());
        quitting = true;
        app.quit();
      }, 900);
    }
  });
  window.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    window.hide();
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

function createTray() {
  const image = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
  tray = new Tray(image);
  tray.setToolTip('Mineradio 一起听中转控制台');
  tray.setContextMenu(trayMenu());
  tray.on('double-click', showWindow);
}

function setupIpc() {
  ipcMain.handle('control:bootstrap', () => ({ config: store.getPublic(), state: controller.snapshot(), logs: controller.getLogs() }));
  ipcMain.handle('control:save-config', (_event, config, authorizationCode) => {
    const result = store.update(config, String(authorizationCode || ''));
    if (result.ok) {
      app.setLoginItemSettings({ openAtLogin: result.config.autoStartApp, args: result.config.startMinimized ? ['--minimized'] : [] });
      controller.appendLog('info', '配置已保存；运行中的服务需重启后生效。');
    }
    return result;
  });
  ipcMain.handle('control:reveal-code', () => store.revealAuthorizationCode());
  ipcMain.handle('control:generate-code', () => generateAuthorizationCode());
  ipcMain.handle('control:start', () => controller.start(runtimeConfig()));
  ipcMain.handle('control:stop', () => controller.stop());
  ipcMain.handle('control:restart', () => controller.restart(runtimeConfig()));
  ipcMain.handle('control:set-auto-start', (_event, enabled) => {
    const next = { ...store.getPublic(), autoStartApp: !!enabled };
    const result = store.update(next);
    if (result.ok) app.setLoginItemSettings({ openAtLogin: !!enabled, args: next.startMinimized ? ['--minimized'] : [] });
    return result;
  });
  ipcMain.handle('control:open-data-directory', () => shell.openPath(app.getPath('userData')));
  ipcMain.handle('control:firewall-command', (_event, port) => {
    const safePort = Number(port);
    if (!Number.isInteger(safePort) || safePort < 1 || safePort > 65535) throw new Error('端口无效。');
    const command = `New-NetFirewallRule -DisplayName "Mineradio Together Relay ${safePort}" -Direction Inbound -Action Allow -Protocol TCP -LocalPort ${safePort}`;
    clipboard.writeText(command);
    return command;
  });
  ipcMain.handle('control:clear-logs', () => { controller.clearLogs(); return true; });
  ipcMain.handle('control:export-diagnostics', async () => {
    const result = await dialog.showSaveDialog(window, { title: '导出诊断', defaultPath: `mineradio-relay-diagnostics-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (result.canceled || !result.filePath) return { canceled: true };
    const payload = { generatedAt: new Date().toISOString(), appVersion: app.getVersion(), platform: process.platform, config: store.getPublic(), state: controller.snapshot(), logs: controller.getLogs(400) };
    fs.writeFileSync(result.filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    return { canceled: false, filePath: result.filePath };
  });
}

app.on('second-instance', showWindow);
app.whenReady().then(async () => {
  const userData = app.getPath('userData');
  store = new ConfigStore({ directory: userData, safeStorage });
  const config = store.load();
  controller = new RelayController({
    runtimeDirectory,
    logDirectory: path.join(userData, 'logs'),
    executable: path.join(runtimeDirectory, 'node.exe'),
    electronRuntime: false,
  });
  controller.on('state', (state) => { send('control:state', state); if (tray) tray.setContextMenu(trayMenu(state)); });
  controller.on('log', (entry) => send('control:log', entry));
  controller.on('logs-cleared', () => send('control:logs-cleared'));
  setupIpc();
  createWindow();
  createTray();
  if (config.autoStartService && !process.env.RELAY_CONTROL_TEST_MODE) controller.start(runtimeConfig()).catch((error) => controller.appendLog('error', error.message));
});

app.on('before-quit', (event) => {
  if (shutdownStarted || !controller || !controller.child) return;
  event.preventDefault();
  shutdownStarted = true;
  quitting = true;
  controller.stop().finally(() => app.exit(0));
});

