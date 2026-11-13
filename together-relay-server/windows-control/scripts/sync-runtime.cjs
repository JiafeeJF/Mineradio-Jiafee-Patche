'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const relayRoot = path.resolve(root, '..');
const sourceLib = path.resolve(relayRoot, '..', 'payload', 'desktop', 'together-listen');
const runtime = path.join(root, 'runtime');
const runtimeLib = path.join(runtime, 'lib');
const runtimeWs = path.join(runtime, 'node_modules', 'ws');
const required = [
  'authoritative-room.js',
  'config-store.js',
  'payload-budget.js',
  'protocol.js',
  'room-service.js',
  'tcp-transport.js',
];

fs.mkdirSync(runtimeLib, { recursive: true });
fs.copyFileSync(process.execPath, path.join(runtime, 'node.exe'));
for (const file of ['server.js', 'healthcheck.js']) {
  fs.copyFileSync(path.join(relayRoot, file), path.join(runtime, file));
}
for (const file of required) {
  const source = path.join(sourceLib, file);
  if (!fs.existsSync(source)) throw new Error(`Missing relay runtime file: ${source}`);
  fs.copyFileSync(source, path.join(runtimeLib, file));
}
fs.rmSync(runtimeWs, { recursive: true, force: true });
fs.cpSync(path.join(root, 'node_modules', 'ws'), runtimeWs, { recursive: true });
const iconSource = path.resolve(relayRoot, '..', 'build', 'icon.ico');
const iconTarget = path.join(root, 'build', 'icon.ico');
fs.mkdirSync(path.dirname(iconTarget), { recursive: true });
if (fs.existsSync(iconSource)) fs.copyFileSync(iconSource, iconTarget);
console.log(`Synced relay runtime to ${runtime}`);

