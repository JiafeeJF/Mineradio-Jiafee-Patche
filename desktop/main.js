'use strict';

const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const { PatchEngine } = require('./patch-engine');

const ROOT = app.isPackaged ? path.join(process.resourcesPath, 'app') : path.resolve(__dirname, '..');
const engine = new PatchEngine(ROOT, path.join(ROOT, 'payload'));

function exists(file) { try { return fs.existsSync(file); } catch (_) { return false; } }
function stopMineradio() { try { execFileSync('taskkill.exe', ['/F', '/T', '/IM', 'Mineradio.exe'], { stdio:'ignore' }); } catch (_) {} }
function candidateInstallDirs() { return ['D:\\Mineradio']; }
function detect(ids) {
  for (const dir of candidateInstallDirs()) { const result = engine.inspect(dir, ids); if (result.ok) return result; }
  return { ok:false, targetDir:candidateInstallDirs()[0], reason:'未找到默认路径 D:\\Mineradio。请选择 Mineradio 源码目录或安装目录。' };
}
function normalizeIds(ids) { return (Array.isArray(ids) ? ids : [ids]).filter(Boolean); }
function runMutation(method, targetDir, ids) {
  const result = engine[method](targetDir, normalizeIds(ids));
  if (result.ok && result.kind === 'packaged') {
    stopMineradio();
    const exe = path.join(result.targetDir || targetDir, 'Mineradio.exe');
    if (exists(exe)) { try { spawn(exe, [], { cwd:path.dirname(exe), detached:true, stdio:'ignore' }).unref(); } catch (_) {} }
  }
  return result;
}

async function createWindow() {
  Menu.setApplicationMenu(null);
  const win = new BrowserWindow({ width:820, height:680, minWidth:720, minHeight:560, title:'Mineradio 多功能补丁器', icon:path.join(ROOT, 'icon.ico'), backgroundColor:'#101114', webPreferences:{ preload:path.join(__dirname, 'preload.js'), contextIsolation:true, nodeIntegration:false } });
  await win.loadFile(path.join(__dirname, 'index.html'));
}

ipcMain.handle('patch:list', () => engine.list());
ipcMain.handle('patch:detect', (_event, ids) => detect(ids));
ipcMain.handle('patch:inspect', (_event, targetDir, ids) => engine.inspect(targetDir, ids));
ipcMain.handle('patch:choose', async (_event, ids) => {
  const result = await dialog.showOpenDialog({ title:'选择 Mineradio 源码目录或 Mineradio.exe', properties:['openFile','openDirectory'], filters:[{ name:'Mineradio', extensions:['exe'] }, { name:'All Files', extensions:['*'] }] });
  if (result.canceled || !result.filePaths.length) return null;
  return engine.inspect(result.filePaths[0], ids);
});
ipcMain.handle('patch:install', (_event, targetDir, ids) => runMutation('install', targetDir, ids));
ipcMain.handle('patch:uninstall', (_event, targetDir, ids) => runMutation('uninstall', targetDir, ids));
ipcMain.handle('patch:openDir', async (_event, targetDir) => { const info = engine.inspect(targetDir, []); if (info.ok) await shell.openPath(info.targetDir); return info; });

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
