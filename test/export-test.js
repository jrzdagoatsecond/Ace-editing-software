// Generates sample clips, exports them with every effect on, and checks the result.
// Usage: node test/export-test.js [path-to-ffmpeg]
const { execFileSync } = require('child_process');
const path = require('path'); const os = require('os'); const fs = require('fs');
const { runExport } = require('../src/exporter');

const ffmpeg = process.argv[2] || (() => { try { return require('ffmpeg-static'); } catch (e) { return 'ffmpeg'; } })();
const ffprobe = process.argv[3] || 'ffprobe';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ace-test-'));
const sh = (...a) => execFileSync(ffmpeg, ['-y', '-loglevel', 'error', ...a]);

const a = path.join(dir, 'a.mp4'), b = path.join(dir, 'b.mp4'), img = path.join(dir, 'c.png');
sh('-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '4', '-pix_fmt', 'yuv420p', '-shortest', a);
sh('-f', 'lavfi', '-i', 'smptebars=size=640x480:rate=25', '-t', '3', '-pix_fmt', 'yuv420p', b);   // no audio, 4:3
sh('-f', 'lavfi', '-i', 'color=c=white:size=400x400', '-frames:v', '1', img);

const fx = (o) => Object.assign({ fadeIn: 0, fadeOut: 0, blur: 0, speed: 1, volume: 100, muted: false,
  brightness: 0, contrast: 0, saturation: 0, sharpen: 0, bw: false, fit: 'contain' }, o);
const clips = [
  { path: a, type: 'video', hasAudio: true,  in: 0.5, out: 3.5, fx: fx({ fadeIn: 0.5, fadeOut: 0.5, blur: 60, contrast: 10, saturation: 15, sharpen: 30 }) },
  { path: b, type: 'video', hasAudio: false, in: 0,   out: 2,   fx: fx({ speed: 2, bw: true, fit: 'cover' }) },
  { path: a, type: 'video', hasAudio: true,  in: 1,   out: 2,   fx: fx({ speed: 0.5, volume: 50, brightness: 10 }) },
  { path: img, type: 'image', hasAudio: false, in: 0, out: 1.5, fx: fx({ fadeIn: 0.3, fadeOut: 0.3 }) }
];
const expected = 3 + 1 + 2 + 1.5;
const out = path.join(dir, 'out.mp4');

let last = 0;
const job = runExport({ ffmpegPath: ffmpeg, clips, settings: { w: 1280, h: 720, fps: 30, quality: 'draft' }, outPath: out,
  onProgress: (p) => { last = p; } });
job.promise.then((r) => {
  if (!r.ok) { console.error('FAILED:', r.error); process.exit(1); }
  const info = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', out]).toString());
  const dur = parseFloat(info.format.duration);
  const kinds = info.streams.map(s => s.codec_type + (s.width ? ` ${s.width}x${s.height}` : ''));
  console.log('expected duration', expected.toFixed(2), 'got', dur.toFixed(2), '| streams:', kinds.join(', '), '| progress reached', last.toFixed(2));
  if (Math.abs(dur - expected) > 0.3) { console.error('Duration mismatch'); process.exit(1); }
  console.log('EXPORT TEST PASSED');
  console.log('output:', out);
});
