// Generates sample clips, then exports them in every format and with every effect,
// checking each result with ffprobe.
// Usage: node test/export-test.js [path-to-ffmpeg] [path-to-ffprobe]
const { execFileSync } = require('child_process');
const path = require('path'); const os = require('os'); const fs = require('fs');
const { runExport, FORMATS } = require('../src/exporter');

const ffmpeg = process.argv[2] || (() => { try { return require('ffmpeg-static'); } catch (e) { return 'ffmpeg'; } })();
const ffprobe = process.argv[3] || 'ffprobe';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ace-test-'));
const sh = (...a) => execFileSync(ffmpeg, ['-y', '-loglevel', 'error', ...a]);

const a = path.join(dir, 'a.mp4'), b = path.join(dir, 'b.mp4'), img = path.join(dir, 'c.png');
sh('-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '4', '-pix_fmt', 'yuv420p', '-shortest', a);
sh('-f', 'lavfi', '-i', 'smptebars=size=640x480:rate=25', '-t', '3', '-pix_fmt', 'yuv420p', b);   // no audio, 4:3
sh('-f', 'lavfi', '-i', 'color=c=white:size=400x400', '-frames:v', '1', img);

const fx = (o) => Object.assign({ fadeIn: 0, fadeOut: 0, blur: 0, speed: 1, volume: 100, muted: false,
  brightness: 0, contrast: 0, saturation: 0, sharpen: 0, bw: false, fit: 'contain',
  reverse: false, interp: 'nearest', pitch: true, blurType: 'gaussian', blurAmt: 0,
  hue: 0, vignette: 0, grain: 0, flipH: false, flipV: false }, o);

const mix = [
  { path: a, type: 'video', hasAudio: true,  in: 0.5, out: 3.5, fx: fx({ fadeIn: 0.5, fadeOut: 0.5, blur: 60, contrast: 10, saturation: 15, sharpen: 30 }) },
  { path: b, type: 'video', hasAudio: false, in: 0,   out: 2,   fx: fx({ speed: 2, bw: true, fit: 'cover', interp: 'blend' }) },
  { path: a, type: 'video', hasAudio: true,  in: 1,   out: 2,   fx: fx({ speed: 0.5, interp: 'blend', volume: 50, brightness: 10 }) },
  { path: img, type: 'image', hasAudio: false, in: 0, out: 1.5, fx: fx({ fadeIn: 0.3, fadeOut: 0.3 }) }
];
const mixLen = 3 + 1 + 2 + 1.5;

const jobs = [];
const settings = (format, extra) => Object.assign({ w: 640, h: 360, fps: 30, quality: 'draft', format }, extra);

// 1) every format with the mixed timeline
Object.keys(FORMATS).forEach((f) => jobs.push({ name: 'format ' + f, clips: mix, settings: settings(f), len: mixLen, kind: FORMATS[f].kind, ext: FORMATS[f].ext }));
// 2) vertical size
jobs.push({ name: 'vertical 9:16', clips: mix, settings: settings('mp4', { w: 360, h: 640 }), len: mixLen, kind: 'video', ext: 'mp4' });

// 3) each effect on its own
const one = (name, o, extra = {}) => jobs.push({ name, clips: [{ path: a, type: 'video', hasAudio: true, in: 0, out: extra.src || 2, fx: fx(o) }],
  settings: settings('mp4'), len: (extra.src || 2) / (o.speed || 1), kind: 'video', ext: 'mp4' });
['gaussian', 'box', 'horizontal', 'vertical', 'zoom'].forEach((t) => one('blur ' + t, { blurType: t, blurAmt: 60 }));
one('vignette', { vignette: 70 }); one('grain', { grain: 50 }); one('flip both', { flipH: true, flipV: true });
one('hue shift', { hue: 90 }); one('reverse', { reverse: true });
one('slow nearest', { speed: 0.4 }); one('slow blend', { speed: 0.4, interp: 'blend' }); one('slow optical flow', { speed: 0.5, interp: 'optical' });
one('fast blend', { speed: 3, interp: 'blend' }, { src: 3 }); one('pitch change', { speed: 1.5, pitch: false });
one('very slow', { speed: 0.1, interp: 'blend' }, { src: 1 });
one('everything at once', { blurType: 'zoom', blurAmt: 40, blur: 30, vignette: 40, grain: 20, hue: -30, flipH: true, speed: 0.5, interp: 'blend', fadeIn: 0.3, fadeOut: 0.3, bw: false, reverse: true });


// ---- music tracks ----
const song = path.join(dir, 'song.mp3'), wav = path.join(dir, 'song.wav');
sh('-f', 'lavfi', '-i', 'sine=frequency=880:duration=10', '-c:a', 'libmp3lame', song);
sh('-f', 'lavfi', '-i', 'sine=frequency=330:duration=6', wav);
const silentClip = (len) => [{ path: b, type: 'video', hasAudio: false, in: 0, out: len, fx: fx({}) }];
const meanVol = (file, from, len) => {
  const r = require('child_process').spawnSync(ffmpeg, ['-ss', String(from), '-t', String(len), '-i', file, '-vn', '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /mean_volume: (-?[\d.]+|-inf) dB/.exec(r.stderr); return m ? (m[1] === '-inf' ? -99 : parseFloat(m[1])) : -99;
};
const musicTests = [
  { name: 'music under video', clips: silentClip(3), music: [{ path: song, start: 0, in: 0, out: 10, fx: { volume: 100, fadeIn: 0, fadeOut: 0 } }], format: 'mp4', len: 3, loud: [0.5, 2] },
  { name: 'music starts at 2s', clips: silentClip(3), music: [{ path: song, start: 2, in: 0, out: 5, fx: { volume: 100 } }], format: 'mp4', len: 3, quiet: [0, 1.5], loud: [2.2, 0.7] },
  { name: 'two songs mixed', clips: silentClip(3), music: [{ path: song, start: 0, in: 1, out: 4, fx: { volume: 60, fadeIn: 0.5, fadeOut: 0.5 } }, { path: wav, start: 1, in: 0, out: 2, fx: { volume: 100 } }], format: 'mp4', len: 3, loud: [1.2, 1] },
  { name: 'songs only -> wav', clips: [], music: [{ path: song, start: 2, in: 0, out: 3, fx: { volume: 100 } }], format: 'wav', len: 5, quiet: [0, 1.5], loud: [2.3, 2] },
  { name: 'songs only -> mp3', clips: [], music: [{ path: wav, start: 0, in: 0, out: 4, fx: { volume: 100 } }, { path: song, start: 4, in: 0, out: 2, fx: { volume: 100 } }], format: 'mp3', len: 6, loud: [0.5, 2] },
  { name: 'muted song', clips: silentClip(2), music: [{ path: song, start: 0, in: 0, out: 5, fx: { volume: 100, muted: true } }], format: 'mp4', len: 2, quiet: [0.2, 1.5] }
];
(async () => {
  let failed = 0;
  for (const j of jobs) {
    const out = path.join(dir, j.name.replace(/\W+/g, '_') + '.' + j.ext);
    const r = await runExport({ ffmpegPath: ffmpeg, clips: j.clips, settings: j.settings, outPath: out }).promise;
    if (!r.ok) { failed++; console.log('FAIL', j.name, '->', r.error); continue; }
    const info = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height', '-of', 'json', out]).toString());
    const types = info.streams.map((s) => s.codec_type);
    const dur = parseFloat(info.format.duration);
    const okTypes = j.kind === 'audio' ? (types.length === 1 && types[0] === 'audio')
      : j.kind === 'gif' ? (types.length === 1 && types[0] === 'video')
      : (types.includes('video') && types.includes('audio'));
    const okDur = Math.abs(dur - j.len) < 0.35;
    const codecs = info.streams.map((s) => s.codec_name).join('+');
    console.log((okTypes && okDur ? 'ok  ' : 'BAD ') + j.name.padEnd(20), codecs.padEnd(24), 'len', dur.toFixed(2), '(want', j.len.toFixed(2) + ')');
    if (!(okTypes && okDur)) failed++;
  }
  for (const j of musicTests) {
    const ext = FORMATS[j.format].ext;
    const out = path.join(dir, j.name.replace(/\W+/g, '_') + '.' + ext);
    const r = await runExport({ ffmpegPath: ffmpeg, clips: j.clips, music: j.music, settings: settings(j.format), outPath: out }).promise;
    if (!r.ok) { failed++; console.log('FAIL', j.name, '->', r.error); continue; }
    const dur = parseFloat(execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).toString());
    const okDur = Math.abs(dur - j.len) < 0.35;
    const loudOk = !j.loud || meanVol(out, j.loud[0], j.loud[1]) > -35;
    const quietOk = !j.quiet || meanVol(out, j.quiet[0], j.quiet[1]) < -60;
    const good = okDur && loudOk && quietOk;
    console.log((good ? 'ok  ' : 'BAD ') + j.name.padEnd(20), 'len', dur.toFixed(2), '(want ' + j.len + ')',
      j.loud ? 'loud ' + meanVol(out, j.loud[0], j.loud[1]).toFixed(0) + 'dB' : '', j.quiet ? 'quiet ' + meanVol(out, j.quiet[0], j.quiet[1]).toFixed(0) + 'dB' : '');
    if (!good) failed++;
  }
  // songs-only into a video format must be refused politely
  try { await runExport({ ffmpegPath: ffmpeg, clips: [], music: [{ path: song, start: 0, in: 0, out: 2, fx: {} }], settings: settings('mp4'), outPath: path.join(dir, 'x.mp4') }).promise; failed++; console.log('BAD songs-only mp4 should be refused'); }
  catch (e) { console.log('ok   songs-only mp4 refused:', e.message); }
  console.log(failed ? `\n${failed} FAILED` : `\nALL ${jobs.length + musicTests.length + 1} EXPORT TESTS PASSED`);
  process.exit(failed ? 1 : 0);
})();
