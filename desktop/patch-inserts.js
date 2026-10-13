// @ts-nocheck
/* eslint-disable @typescript-eslint/no-var-requires */
// ============================================================
//  Patch snippet injection helpers (shared by main.js + tests)
//  ------------------------------------------------------------
//  Idempotent, marker-wrapped snippet insertion into text
//  files (server.js, index.html, ...). Multi-patch safe: each
//  patch uses its own begin/end markers so patches can coexist
//  in the same file without fighting over anchors.
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');

function markerStyleFor(insert, rel) {
  return insert.markerStyle || (rel.endsWith('.html') || rel.endsWith('.htm') ? 'html' : 'js');
}

function beginMarker(patchId, style) {
  return (style === 'html' ? '<!-- ==== Jiafee ' : '// ==== Jiafee ') + patchId + ' begin ====' + (style === 'html' ? ' -->' : '');
}

function endMarker(patchId, style) {
  return (style === 'html' ? '<!-- ==== Jiafee ' : '// ==== Jiafee ') + patchId + ' end ====' + (style === 'html' ? ' -->' : '');
}

// Insert a snippet before (or after) the first occurrence of `anchor`.
// Returns a result object for logging.
function applyInsert(appDir, insert, manifest, backupRoot, alreadyInstalled) {
  const rel = insert.file;
  const dest = path.join(appDir, rel);
  if (!fs.existsSync(dest)) return { rel, skipped: true, reason: 'target missing' };
  const style = markerStyleFor(insert, rel);
  const bm = beginMarker(manifest.patchId, style);
  const em = endMarker(manifest.patchId, style);

  let text;
  try { text = fs.readFileSync(dest, 'utf8'); }
  catch (err) { return { rel, skipped: true, reason: err.message }; }

  // Idempotent: markers already present → nothing to do.
  if (text.indexOf(bm) !== -1 && text.indexOf(em) !== -1) {
    return { rel, skipped: true, already: true };
  }

  const anchor = insert.anchor;
  const idx = text.indexOf(anchor);
  if (idx === -1) return { rel, skipped: true, reason: 'anchor not found: ' + anchor };

  // Back up the pristine target once (only if this patch isn't already installed).
  if (!alreadyInstalled) {
    const backupDest = path.join(backupRoot, rel);
    if (!fs.existsSync(backupDest)) {
      fs.mkdirSync(path.dirname(backupDest), { recursive: true });
      fs.copyFileSync(dest, backupDest);
    }
  }

  const insertPoint = insert.before === false ? idx + anchor.length : idx;
  const block = bm + '\n' + (insert.snippet || '') + em + '\n';
  text = text.slice(0, insertPoint) + block + text.slice(insertPoint);
  try { fs.writeFileSync(dest, text, 'utf8'); }
  catch (err) { return { rel, skipped: true, reason: err.message }; }
  return { rel, inserted: true };
}

// Remove the marker-wrapped block previously inserted by applyInsert.
// Leaves the rest of the file untouched (safe if the user edited it after
// patching, unlike whole-file backup restore).
function removeInsert(appDir, insert, manifest) {
  const rel = insert.file;
  const dest = path.join(appDir, rel);
  if (!fs.existsSync(dest)) return { rel, skipped: true, reason: 'target missing' };
  const style = markerStyleFor(insert, rel);
  const bm = beginMarker(manifest.patchId, style);
  const em = endMarker(manifest.patchId, style);

  let text;
  try { text = fs.readFileSync(dest, 'utf8'); }
  catch (err) { return { rel, skipped: true, reason: err.message }; }

  const start = text.indexOf(bm);
  const end = text.indexOf(em);
  if (start === -1 || end === -1) return { rel, skipped: true, reason: 'markers not found' };
  const endIdx = end + em.length;

  // The block was inserted as bm + '\n' + snippet + em + '\n'; the trailing
  // newline belongs to the block (we added it), while the newline before bm
  // is original. Consume only ours so the file restores byte-identically.
  let after = text.slice(endIdx);
  if (after.startsWith('\n')) after = after.slice(1);
  const before = text.slice(0, start);
  text = before + after;

  try { fs.writeFileSync(dest, text, 'utf8'); }
  catch (err) { return { rel, skipped: true, reason: err.message }; }
  return { rel, removed: true };
}

module.exports = { applyInsert, removeInsert, beginMarker, endMarker, markerStyleFor };