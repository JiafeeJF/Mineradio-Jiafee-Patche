'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function exists(file) { try { return fs.existsSync(file); } catch (_) { return false; } }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function hashFile(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function ensureDir(file) { fs.mkdirSync(path.dirname(file), { recursive: true }); }
function copyFile(src, dest) { ensureDir(dest); fs.copyFileSync(src, dest); }
function parseSemver(v) { const m = String(v || '').match(/^(\d+)\.(\d+)\.(\d+)/); return m ? { major:+m[1], minor:+m[2], patch:+m[3] } : null; }
function compareVersion(a, b) { return a.major - b.major || a.minor - b.minor || a.patch - b.patch; }
function walkFiles(root, prefix = '') {
  if (!exists(root)) return [];
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes:true })) {
    const rel = prefix ? path.join(prefix, entry.name) : entry.name;
    if (entry.isDirectory()) out.push(...walkFiles(path.join(root, entry.name), rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}
function nthIndex(text, value, occurrence = 1) {
  let index = -1;
  for (let count = 0; count < Math.max(1, occurrence); count++) {
    index = text.indexOf(value, index + 1);
    if (index < 0) return -1;
  }
  return index;
}

function marker(style, id, end) {
  if (style === 'html') return `<!-- ==== Jiafee ${id} ${end ? 'end' : 'begin'} ==== -->`;
  if (style === 'css') return `/* ==== Jiafee ${id} ${end ? 'end' : 'begin'} ==== */`;
  return `// ==== Jiafee ${id} ${end ? 'end' : 'begin'} ====`;
}

function resolveTarget(input) {
  if (!input) return null;
  let selected = path.resolve(String(input));
  if (exists(selected) && fs.statSync(selected).isFile()) selected = path.dirname(selected);
  const packagedApp = path.join(selected, 'resources', 'app');
  if (exists(path.join(packagedApp, 'package.json'))) return { targetDir: selected, appDir: packagedApp, kind: 'packaged' };
  if (exists(path.join(selected, 'package.json')) && exists(path.join(selected, 'desktop', 'main.js')) && exists(path.join(selected, 'public', 'index.html'))) {
    return { targetDir: selected, appDir: selected, kind: 'source' };
  }
  if (exists(path.join(selected, 'package.json')) && exists(path.join(selected, 'public', 'index.html'))) {
    const root = path.resolve(selected, '..', '..');
    if (exists(path.join(root, 'resources', 'app', 'package.json'))) return { targetDir: root, appDir: selected, kind: 'packaged' };
  }
  return { targetDir: selected, appDir: selected, kind: 'unknown' };
}

class PatchEngine {
  constructor(root, payloadRoot) {
    this.root = root;
    this.payloadRoot = payloadRoot;
    this.manifests = this.loadManifests();
    this.backupDir = '.jiafee-patches';
  }

  loadManifests() {
    return fs.readdirSync(this.root).filter((name) => /^patch-manifest.*\.json$/.test(name)).sort().map((name) => {
      const manifest = readJson(path.join(this.root, name));
      return { ...manifest, manifestFile: name };
    }).filter((m) => m.patchId);
  }
  getManifest(id) { return this.manifests.find((m) => m.patchId === id) || null; }
  list() { return this.manifests.map((m) => ({ patchId:m.patchId, name:m.displayName || m.name, version:m.version || '1.0.0', payloadCount:(m.payloadFiles || []).length, insertCount:(m.payloadInserts || []).length, supportedMajors:m.supportedMajors || [] })); }
  markerPath(appDir, manifest) { return path.join(appDir, manifest.markerFile || `.jiafee-${manifest.patchId}-patch.json`); }
  payloadEntries(manifest) {
    const entries = (manifest.payloadFiles || []).map((rel) => ({ srcRel:rel, destRel:rel }));
    for (const item of manifest.payloadDirectories || []) {
      for (const rel of walkFiles(path.join(this.payloadRoot, item.source))) entries.push({ srcRel:path.join(item.source, rel), destRel:path.join(item.target, rel) });
    }
    return entries;
  }

  inspect(input, ids) {
    const resolved = resolveTarget(input);
    if (!resolved || resolved.kind === 'unknown') return { ok:false, targetDir:resolved && resolved.targetDir, reason:'未找到受支持的 Mineradio 源码结构：需要 package.json、desktop/main.js、public/index.html，或安装目录/resources/app。' };
    let pkg;
    try { pkg = readJson(path.join(resolved.appDir, 'package.json')); } catch (error) { return { ok:false, ...resolved, reason:`package.json 读取失败：${error.message}` }; }
    const version = String(pkg.version || '');
    const patches = (Array.isArray(ids) ? ids : [ids]).filter(Boolean).map((id) => this.getManifest(id)).filter(Boolean);
    const modules = patches.map((manifest) => {
      const sv = parseSemver(version);
      const majors = (manifest.supportedMajors || []).map(String);
      const min = parseSemver(manifest.minVersion);
      const supported = !!sv && (!majors.length || majors.includes(String(sv.major))) && (!min || compareVersion(sv, min) >= 0);
      const markerFile = this.markerPath(resolved.appDir, manifest);
      let markerData = null;
      if (exists(markerFile)) { try { markerData = readJson(markerFile); } catch (_) {} }
      const missing = (manifest.requiredFiles || []).filter((rel) => !exists(path.join(resolved.appDir, rel)));
      const payloadMissing = (manifest.payloadFiles || []).filter((rel) => !exists(path.join(this.payloadRoot, rel))).concat((manifest.payloadDirectories || []).filter((item) => !exists(path.join(this.payloadRoot, item.source))).map((item) => item.source));
      const conflicts = (manifest.conflicts || []).filter((rel) => !exists(path.join(resolved.appDir, rel)));
      const anchorErrors = [];
      for (const insert of manifest.payloadInserts || []) {
        if (insert.append || insert.jsonDependency) continue;
        const dest = path.join(resolved.appDir, insert.file); if (!exists(dest)) continue;
        const style = insert.markerStyle || (insert.file.endsWith('.html') ? 'html' : 'js');
        const text = fs.readFileSync(dest, 'utf8');
        const markerId = insert.markerId ? `${manifest.patchId}-${insert.markerId}` : manifest.patchId;
        const installedBlock = text.includes(marker(style, markerId, false)) && text.includes(marker(style, markerId, true));
        if (!installedBlock && nthIndex(text, insert.anchor || '', insert.occurrence || 1) < 0) anchorErrors.push(`${insert.file}: ${insert.anchor}`);
      }
      return { patchId:manifest.patchId, name:manifest.displayName || manifest.name, version:manifest.version || '1.0.0', supported, tested:(manifest.testedVersions || []).includes(version), installed:!!markerData, markerData, missing, payloadMissing, conflicts, anchorErrors };
    });
    const bad = modules.find((m) => !m.supported || m.missing.length || m.payloadMissing.length || m.conflicts.length || m.anchorErrors.length);
    return { ok:true, ...resolved, version, productName:pkg.productName || pkg.name || 'Mineradio', modules, supported:!bad, reason:bad ? `${bad.name} 不可用：${bad.missing.concat(bad.payloadMissing, bad.conflicts, bad.anchorErrors).join(', ') || '版本不支持'}` : '' };
  }

  prepareInsert(appDir, insert, manifest, changes, virtual = new Map()) {
    const dest = path.join(appDir, insert.file);
    if (!exists(dest)) throw new Error(`${manifest.displayName || manifest.patchId} 注入目标不存在：${insert.file}`);
    if (insert.jsonDependency) {
      const current = virtual.has(dest) ? virtual.get(dest) : fs.readFileSync(dest, 'utf8');
      const data = JSON.parse(current);
      data.dependencies = data.dependencies || {};
      if (!data.dependencies[insert.jsonDependency]) {
        data.dependencies[insert.jsonDependency] = insert.jsonValue || '*';
        const after = JSON.stringify(data, null, 2) + '\n'; changes.push({ type:'json', rel:insert.file, before:current, after }); virtual.set(dest, after);
      }
      return { rel:insert.file, inserted:true };
    }
    const style = insert.markerStyle || (insert.file.endsWith('.html') ? 'html' : 'js');
    const markerId = insert.markerId ? `${manifest.patchId}-${insert.markerId}` : manifest.patchId;
    const begin = marker(style, markerId, false); const end = marker(style, markerId, true);
    const current = virtual.has(dest) ? virtual.get(dest) : fs.readFileSync(dest, 'utf8');
    if (current.includes(begin) && current.includes(end)) return { rel:insert.file, already:true };
    let snippet = insert.snippet || '';
    if (insert.snippetFile) snippet = fs.readFileSync(path.join(this.payloadRoot, insert.snippetFile), 'utf8');
    let index = -1;
    if (insert.append) index = current.length;
    else { index = nthIndex(current, insert.anchor || '', insert.occurrence || 1); if (index < 0) throw new Error(`${manifest.displayName || manifest.patchId} 注入锚点不存在：${insert.file} -> ${insert.anchor}`); }
    if (insert.before === false && !insert.append) index += String(insert.anchor || '').length;
    const block = `${begin}\n${snippet.replace(/\r?\n$/, '')}\n${end}\n`;
    const next = insert.replace ? current.slice(0, index) + block + current.slice(index + String(insert.anchor || '').length) : current.slice(0, index) + block + current.slice(index);
    changes.push({ type:'insert', rel:insert.file, before:current, after:next });
    virtual.set(dest, next);
    return { rel:insert.file, inserted:true };
  }

  install(input, ids) {
    const selected = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
    if (!selected.length) return { ok:false, reason:'至少选择一个补丁模块。' };
    const info = this.inspect(input, selected);
    if (!info.ok || !info.supported) return { ...info, ok:false };
    const resolved = resolveTarget(input);
    const manifests = selected.map((id) => this.getManifest(id)).filter(Boolean);
    const changes = []; const backups = []; const virtual = new Map(); const now = new Date().toISOString();
    try {
      for (const manifest of manifests) {
        const markerFile = this.markerPath(resolved.appDir, manifest);
        const existing = exists(markerFile) ? readJson(markerFile) : null;
        const moduleBackup = path.join(resolved.appDir, this.backupDir, manifest.patchId, 'original');
        for (const entry of this.payloadEntries(manifest)) {
          const rel = entry.destRel;
          const src = path.join(this.payloadRoot, entry.srcRel); if (!exists(src)) throw new Error(`Payload 文件缺失：${entry.srcRel}`);
          const dest = path.join(resolved.appDir, rel);
          if (!existing && exists(dest) && !exists(path.join(moduleBackup, rel))) { copyFile(dest, path.join(moduleBackup, rel)); backups.push({ rel, backup:path.join(moduleBackup, rel), existed:true }); }
          else if (!existing && !exists(dest)) backups.push({ rel, backup:null, existed:false });
          const before = exists(dest) ? fs.readFileSync(dest) : null; const after = fs.readFileSync(src); changes.push({ type:'file', rel, before, after }); virtual.set(dest, after);
        }
        for (const insert of manifest.payloadInserts || []) {
          if (insert.jsonDependency && !existing) {
            const backup = path.join(moduleBackup, insert.file);
            if (exists(path.join(resolved.appDir, insert.file)) && !exists(backup)) { copyFile(path.join(resolved.appDir, insert.file), backup); backups.push({ rel:insert.file, backup, existed:true }); }
          }
        }
        for (const insert of manifest.payloadInserts || []) this.prepareInsert(resolved.appDir, insert, manifest, changes, virtual);
        for (const rel of manifest.requiredFiles || []) if (!exists(path.join(resolved.appDir, rel))) throw new Error(`关键文件缺失：${rel}`);
      }
      const written = [];
      for (const change of changes) {
        const dest = path.join(resolved.appDir, change.rel); ensureDir(dest); fs.writeFileSync(dest, change.after); written.push(dest);
      }
      for (const manifest of manifests) {
        const markerFile = this.markerPath(resolved.appDir, manifest);
        const modulePayloads = this.payloadEntries(manifest).map((entry) => entry.destRel);
        const relevant = changes.filter((c) => modulePayloads.includes(c.rel) || (manifest.payloadInserts || []).some((i) => i.file === c.rel));
        const originalHashes = {};
        for (const c of relevant) if (!(c.rel in originalHashes)) originalHashes[c.rel] = c.before == null ? null : crypto.createHash('sha256').update(c.before).digest('hex');
        const markerData = { patchId:manifest.patchId, name:manifest.displayName || manifest.name, moduleVersion:manifest.version || '1.0.0', targetVersion:info.version, targetKind:resolved.kind, installedAt:now, backupRoot:path.join(resolved.appDir, this.backupDir, manifest.patchId, 'original'), files:[...new Set(relevant.map((c) => c.rel))], originalHashes };
        ensureDir(markerFile); fs.writeFileSync(markerFile, JSON.stringify(markerData, null, 2));
      }
      return { ...this.inspect(input, selected), ok:true, message:`已安装：${manifests.map((m) => m.displayName || m.name).join('、')}。${resolved.kind === 'source' ? '源码目录已更新，可以直接启动或重新生成依赖锁。' : '请重启 Mineradio。'}` };
    } catch (error) {
      for (let i = changes.length - 1; i >= 0; i--) { const c = changes[i]; const dest = path.join(resolved.appDir, c.rel); try { if (c.before == null) fs.rmSync(dest, { force:true }); else fs.writeFileSync(dest, c.before); } catch (_) {} }
      return { ...info, ok:false, reason:`注入已回滚：${error.message}` };
    }
  }

  uninstall(input, ids) {
    const selected = (Array.isArray(ids) ? ids : [ids]).filter(Boolean); const info = this.inspect(input, selected); if (!info.ok) return info;
    const resolved = resolveTarget(input); const results = []; const snapshots = new Map();
    try {
      for (const id of selected) {
        const manifest = this.getManifest(id); if (!manifest) continue;
        const markerFile = this.markerPath(resolved.appDir, manifest); if (!exists(markerFile)) { results.push(`${manifest.displayName || manifest.name} 未安装`); continue; }
        const markerData = readJson(markerFile); const backupRoot = markerData.backupRoot || path.join(resolved.appDir, this.backupDir, manifest.patchId, 'original');
        for (const insert of manifest.payloadInserts || []) {
          if (insert.jsonDependency) continue;
          if (insert.replace) {
            const dest = path.join(resolved.appDir, insert.file); if (!exists(dest)) continue; if (!snapshots.has(dest)) snapshots.set(dest, fs.readFileSync(dest));
            const style = insert.markerStyle || 'js'; const markerId = insert.markerId ? `${manifest.patchId}-${insert.markerId}` : manifest.patchId; const begin = marker(style, markerId, false); const end = marker(style, markerId, true); const text = fs.readFileSync(dest, 'utf8'); const start = text.indexOf(begin); const finish = text.indexOf(end);
            if (start >= 0 && finish >= start) { let tail = text.slice(finish + end.length); if (tail.startsWith('\n')) tail = tail.slice(1); fs.writeFileSync(dest, text.slice(0, start) + insert.anchor + tail); }
            continue;
          }
          const dest = path.join(resolved.appDir, insert.file); if (!exists(dest)) continue; if (!snapshots.has(dest)) snapshots.set(dest, fs.readFileSync(dest));
          const style = insert.markerStyle || (insert.file.endsWith('.html') ? 'html' : 'js'); const markerId = insert.markerId ? `${manifest.patchId}-${insert.markerId}` : manifest.patchId; const begin = marker(style, markerId, false); const end = marker(style, markerId, true); let text = fs.readFileSync(dest, 'utf8'); const start = text.indexOf(begin); const finish = text.indexOf(end); if (start >= 0 && finish >= start) { let tail = text.slice(finish + end.length); if (tail.startsWith('\n')) tail = tail.slice(1); fs.writeFileSync(dest, text.slice(0, start) + tail); }
        }
        for (const insert of manifest.payloadInserts || []) {
          if (!insert.jsonDependency) continue;
          const backup = path.join(backupRoot, insert.file); const dest = path.join(resolved.appDir, insert.file); if (!snapshots.has(dest) && exists(dest)) snapshots.set(dest, fs.readFileSync(dest)); if (exists(backup)) copyFile(backup, dest);
        }
        for (const entry of this.payloadEntries(manifest)) { const rel = entry.destRel; const backup = path.join(backupRoot, rel); const dest = path.join(resolved.appDir, rel); if (!snapshots.has(dest)) snapshots.set(dest, exists(dest) ? fs.readFileSync(dest) : null); if (exists(backup)) copyFile(backup, dest); else if (exists(dest)) fs.rmSync(dest, { force:true }); }
        fs.rmSync(markerFile, { force:true }); fs.rmSync(path.join(resolved.appDir, this.backupDir, manifest.patchId), { recursive:true, force:true }); results.push(`${manifest.displayName || manifest.name} 已卸载`);
      }
      return { ...this.inspect(input, selected), ok:true, message:results.join('；') };
    } catch (error) { for (const [dest, data] of snapshots) { try { if (data == null) fs.rmSync(dest, { force:true }); else { ensureDir(dest); fs.writeFileSync(dest, data); } } catch (_) {} } return { ...info, ok:false, reason:`卸载已回滚：${error.message}` }; }
  }
}

module.exports = { PatchEngine, resolveTarget, marker, hashFile };
