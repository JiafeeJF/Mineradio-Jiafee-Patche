'use strict';

const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');
const readline = require('readline');

class RelayController extends EventEmitter {
  constructor({ runtimeDirectory, logDirectory, executable = process.execPath, electronRuntime = !!process.versions.electron }) {
    super();
    this.runtimeDirectory = runtimeDirectory;
    this.logDirectory = logDirectory;
    this.executable = executable;
    this.electronRuntime = electronRuntime;
    this.child = null;
    this.intentionalStop = false;
    this.healthTimer = null;
    this.restartTimer = null;
    this.config = null;
    this.logLines = [];
    this.state = { phase: 'stopped', healthy: false, members: 0, maxMembers: 2, pid: null, startedAt: null, lastError: '', restartCount: 0 };
    fs.mkdirSync(this.logDirectory, { recursive: true });
  }

  snapshot() { return { ...this.state, endpoint: this.config ? (this.config.publicAddress || `${this.config.host}:${this.config.port}`) : '' }; }
  emitState() { this.emit('state', this.snapshot()); }

  appendLog(level, message) {
    const entry = { time: new Date().toISOString(), level, message: String(message || '').replace(/[\r\n]+$/g, '') };
    if (!entry.message) return;
    this.logLines.push(entry);
    if (this.logLines.length > 800) this.logLines.splice(0, this.logLines.length - 800);
    const day = entry.time.slice(0, 10);
    fs.appendFile(path.join(this.logDirectory, `${day}.log`), `${entry.time} [${level}] ${entry.message}\n`, () => {});
    this.emit('log', entry);
  }

  async start(config) {
    if (this.child) return this.snapshot();
    this.config = { ...config };
    this.intentionalStop = false;
    clearTimeout(this.restartTimer);
    this.state = { ...this.state, phase: 'starting', healthy: false, members: 0, pid: null, lastError: '' };
    this.emitState();
    const server = path.join(this.runtimeDirectory, 'server.js');
    if (!fs.existsSync(server)) throw new Error(`中转服务运行文件缺失：${server}`);
    if (!fs.existsSync(this.executable)) throw new Error(`控制台运行程序不存在：${this.executable}。请重新安装控制台。`);
    if (!fs.existsSync(this.runtimeDirectory)) throw new Error(`中转服务工作目录不存在：${this.runtimeDirectory}`);
    const env = {
      ...process.env,
      PORT: String(config.port), HOST: config.host, ROOM_NAME: config.roomName,
      PUBLIC_ADDRESS: config.publicAddress, AUTHORIZATION_CODE: config.authorizationCode,
      ALLOW_LAN_WITHOUT_AUTH: String(config.allowLanWithoutAuth), DEBUG: String(config.debug),
      SERVER_ID: config.serverId,
    };
    if (this.electronRuntime) env.ELECTRON_RUN_AS_NODE = '1';
    const child = spawn(this.executable, [server], { cwd: this.runtimeDirectory, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.child = child;
    this.state.pid = child.pid;
    this.state.startedAt = Date.now();
    this.attachStream(child.stdout, 'info');
    this.attachStream(child.stderr, 'error');
    child.once('error', (error) => {
      this.state.lastError = error.message;
      this.appendLog('error', `进程启动失败：${error.message}`);
    });
    child.once('exit', (code, signal) => this.onExit(code, signal));
    const spawned = await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    }).then(() => true, (error) => {
      if (this.child === child) {
        this.child = null;
        this.state = { ...this.state, phase: 'error', healthy: false, members: 0, pid: null, startedAt: null, lastError: error.message };
        this.appendLog('error', `进程启动失败：${error.message}`);
        this.emitState();
      }
      throw new Error(`无法启动中转子进程（${error.code || error.message}）：${this.executable}`);
    });
    if (!spawned) throw new Error('无法启动中转子进程。');
    this.state.pid = child.pid;
    this.appendLog('info', `正在启动中转服务，PID ${child.pid}。`);
    this.beginHealthPolling();
    await this.waitForHealth(8000);
    return this.snapshot();
  }

  attachStream(stream, level) {
    const reader = readline.createInterface({ input: stream });
    reader.on('line', (line) => {
      this.appendLog(level, line);
      if (line.includes('[relay] listening on')) {
        this.state.phase = 'running';
        this.emitState();
      }
    });
  }

  async waitForHealth(timeout) {
    const started = Date.now();
    while (this.child && Date.now() - started < timeout) {
      const status = await this.probe();
      if (status) return status;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (this.child) {
      this.state.phase = 'error';
      this.state.lastError = '服务进程已启动，但健康检查未在 8 秒内通过。';
      this.emitState();
      throw new Error(this.state.lastError);
    }
    throw new Error(this.state.lastError || '中转服务启动失败。');
  }

  beginHealthPolling() {
    clearInterval(this.healthTimer);
    this.healthTimer = setInterval(() => this.probe(), 2000);
    this.healthTimer.unref?.();
  }

  healthHost() {
    if (!this.config || this.config.host === '0.0.0.0') return '127.0.0.1';
    if (this.config.host === '::' || this.config.host === '[::]') return '::1';
    return this.config.host.replace(/^\[|\]$/g, '');
  }

  probe() {
    if (!this.child || !this.config) return Promise.resolve(null);
    return new Promise((resolve) => {
      const request = http.get({ host: this.healthHost(), port: this.config.port, path: '/status', timeout: 1500 }, (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { if (body.length < 16384) body += chunk; });
        response.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (response.statusCode !== 200 || data.service !== 'mineradio-together') throw new Error('SERVICE_IDENTITY_MISMATCH');
            this.state.phase = 'running';
            this.state.healthy = true;
            this.state.members = Number(data.members) || 0;
            this.state.maxMembers = Number(data.maxMembers) || 2;
            this.state.lastError = '';
            this.emitState();
            resolve(data);
          } catch (_) { this.markUnhealthy(); resolve(null); }
        });
      });
      request.on('timeout', () => request.destroy());
      request.on('error', () => { this.markUnhealthy(); resolve(null); });
    });
  }

  markUnhealthy() {
    if (!this.child || !this.state.healthy) return;
    this.state.healthy = false;
    this.state.members = 0;
    this.emitState();
  }

  async stop() {
    this.intentionalStop = true;
    clearTimeout(this.restartTimer);
    clearInterval(this.healthTimer);
    this.healthTimer = null;
    if (!this.child) {
      this.state = { ...this.state, phase: 'stopped', healthy: false, members: 0, pid: null, startedAt: null };
      this.emitState();
      return this.snapshot();
    }
    const child = this.child;
    this.state.phase = 'stopping';
    this.emitState();
    this.appendLog('info', '正在通知在线客户端并停止中转服务。');
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill('SIGTERM');
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 8500))]);
    if (this.child === child) child.kill('SIGKILL');
    return this.snapshot();
  }

  async restart(config) { await this.stop(); this.state.restartCount = 0; return this.start(config); }

  onExit(code, signal) {
    const wasIntentional = this.intentionalStop;
    const activeConfig = this.config;
    this.child = null;
    clearInterval(this.healthTimer);
    this.healthTimer = null;
    this.state = { ...this.state, phase: wasIntentional ? 'stopped' : 'error', healthy: false, members: 0, pid: null, startedAt: null, lastError: wasIntentional ? '' : `服务异常退出（${signal || code}）。` };
    this.appendLog(wasIntentional ? 'info' : 'error', wasIntentional ? '中转服务已停止。' : this.state.lastError);
    this.emitState();
    if (!wasIntentional && activeConfig && activeConfig.restartOnCrash && this.state.restartCount < 3) {
      this.state.restartCount += 1;
      const delay = 1200 * this.state.restartCount;
      this.appendLog('warn', `${delay} 毫秒后尝试第 ${this.state.restartCount} 次自动恢复。`);
      this.restartTimer = setTimeout(() => this.start(activeConfig).catch((error) => this.appendLog('error', `自动恢复失败：${error.message}`)), delay);
    }
  }

  getLogs(limit = 300) { return this.logLines.slice(-Math.max(1, Math.min(800, Number(limit) || 300))); }
  clearLogs() { this.logLines = []; this.emit('logs-cleared'); }
}

module.exports = { RelayController };

