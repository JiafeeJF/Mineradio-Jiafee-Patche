import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {VIDEO,QA_FRAMES} from '../src/config.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(import.meta.url);
// Remotion ships codec binaries. Windows is the delivery/test platform.
const binaries=path.dirname(require.resolve('@remotion/compositor-win32-x64-msvc/package.json'));
const mp4=path.join(root,'out/Mineradio-JIAFEE-2.2.9.mp4');
const probe=JSON.parse(execFileSync(path.join(binaries,'ffprobe.exe'),['-v','error','-show_streams','-show_format','-of','json',mp4],{encoding:'utf8'}));
const video=probe.streams.find(s=>s.codec_type==='video');
const audio=probe.streams.find(s=>s.codec_type==='audio');
assert.equal(video.codec_name,'h264');assert.equal(video.width,VIDEO.width);assert.equal(video.height,VIDEO.height);assert.equal(video.r_frame_rate,`${VIDEO.fps}/1`);assert.equal(Number(video.nb_frames),VIDEO.frames);assert.equal(video.pix_fmt,'yuv420p');assert.ok(Math.abs(Number(probe.format.duration)-VIDEO.seconds)<.05);assert.equal(audio.codec_name,'aac');assert.equal(audio.channels,2);
const cover=fs.readFileSync(path.join(root,'out/Mineradio-JIAFEE-2.2.9-cover.png'));
assert.equal(cover.subarray(1,4).toString(),'PNG');assert.equal(cover.readUInt32BE(16),VIDEO.width);assert.equal(cover.readUInt32BE(20),VIDEO.height);
// Decode every frame; malformed/truncated files must fail before handoff.
execFileSync(path.join(binaries,'ffmpeg.exe'),['-v','error','-xerror','-i',mp4,'-f','null','-'],{stdio:['ignore','ignore','pipe']});
fs.mkdirSync(path.join(root,'out/frames'),{recursive:true});
execFileSync(path.join(binaries,'ffmpeg.exe'),['-v','error','-i',mp4,'-vf',`select=${QA_FRAMES.map(n=>`eq(n\\,${n})`).join('+')}`,'-fps_mode','passthrough','-frame_pts','1','-y',path.join(root,'out/frames/%04d.png')],{stdio:['ignore','ignore','pipe']});
const report={passed:true,fullDecode:true,video:{codec:video.codec_name,width:video.width,height:video.height,fps:video.r_frame_rate,frames:video.nb_frames,duration:probe.format.duration,pixelFormat:video.pix_fmt},audio:{codec:audio.codec_name,sampleRate:audio.sample_rate,channels:audio.channels},cover:{width:VIDEO.width,height:VIDEO.height},sampledFrames:QA_FRAMES,bytes:fs.statSync(mp4).size};
fs.writeFileSync(path.join(root,'out/verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
