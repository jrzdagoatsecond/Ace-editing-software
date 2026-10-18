'use strict';
// Turns the timeline into one ffmpeg command. No Electron code in here,
// so it can be tested on its own (see test/export-test.js).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const QUALITY = {
  draft:    { crf: 28, preset: 'veryfast' },
  standard: { crf: 22, preset: 'medium' },
  high:     { crf: 17, preset: 'slow' }
};

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const num = (v) => Number(v).toFixed(4).replace(/\.?0+$/, '') || '0';

function atempoChain(speed) {
  const parts = [];
  let s = speed;
  while (s > 2) { parts.push('atempo=2'); s /= 2; }
  while (s < 0.5) { parts.push('atempo=0.5'); s /= 0.5; }
  parts.push('atempo=' + num(s));
  return parts.join(',');
}

// clips: [{ path, type:'video'|'image', hasAudio, in, out, fx }]
// settings: { w, h, fps, quality }
function buildCommand(clips, settings, outPath) {
  const { w, h, fps } = settings;
  const q = QUALITY[settings.quality] || QUALITY.standard;
  const args = ['-y', '-hide_banner', '-loglevel', 'error'];
  const graph = [];
  const vLabels = [];
  let inputIndex = 0;
  let total = 0;

  clips.forEach((c, i) => {
    const fx = c.fx;
    const speed = clamp(Number(fx.speed) || 1, 0.25, 4);
    const srcLen = Math.max(0.05, c.out - c.in);
    const dur = srcLen / speed;
    total += dur;

    const vIn = inputIndex++;
    if (c.type === 'image') {
      args.push('-loop', '1', '-framerate', String(fps), '-t', num(srcLen), '-i', c.path);
    } else {
      args.push('-ss', num(c.in), '-t', num(srcLen), '-i', c.path);
    }

    // ---------- video ----------
    const v = [];
    v.push('setpts=(PTS-STARTPTS)/' + num(speed));
    v.push('fps=' + fps);
    v.push('trim=duration=' + num(dur));
    v.push('setpts=PTS-STARTPTS');
    if (fx.fit === 'cover') {
      v.push(`scale=${w}:${h}:force_original_aspect_ratio=increase`, `crop=${w}:${h}`);
    } else {
      v.push(`scale=${w}:${h}:force_original_aspect_ratio=decrease`,
             `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black`);
    }
    v.push('setsar=1');

    const b = clamp(Number(fx.brightness) || 0, -100, 100) / 200;
    const ct = 1 + clamp(Number(fx.contrast) || 0, -100, 100) / 100;
    const sat = 1 + clamp(Number(fx.saturation) || 0, -100, 100) / 100;
    if (b !== 0 || ct !== 1 || sat !== 1) {
      v.push(`eq=brightness=${num(b)}:contrast=${num(ct)}:saturation=${num(sat)}`);
    }
    if (fx.bw) v.push('hue=s=0');
    const sharp = clamp(Number(fx.sharpen) || 0, 0, 100);
    if (sharp > 0) v.push(`unsharp=5:5:${num(sharp / 100 * 1.5)}:5:5:0`);

    // Motion blur: average the last N frames.
    const blur = clamp(Number(fx.blur) || 0, 0, 100);
    const frames = Math.round(1 + (blur / 100) * 7);
    if (frames > 1) v.push('tmix=frames=' + frames);

    const fi = clamp(Number(fx.fadeIn) || 0, 0, dur);
    const fo = clamp(Number(fx.fadeOut) || 0, 0, dur);
    if (fi > 0) v.push(`fade=t=in:st=0:d=${num(fi)}`);
    if (fo > 0) v.push(`fade=t=out:st=${num(dur - fo)}:d=${num(fo)}`);
    v.push('format=yuv420p');

    graph.push(`[${vIn}:v]${v.join(',')}[v${i}]`);
    vLabels.push(`[v${i}]`);

    // ---------- audio ----------
    const a = [];
    let aIn;
    if (c.type !== 'image' && c.hasAudio) {
      aIn = vIn;
      a.push('asetpts=PTS-STARTPTS');
      if (speed !== 1) a.push(atempoChain(speed));
      a.push('aresample=48000');
    } else {
      aIn = inputIndex++;
      args.push('-f', 'lavfi', '-t', num(dur), '-i', 'anullsrc=r=48000:cl=stereo');
    }
    a.push('aformat=sample_fmts=fltp:channel_layouts=stereo');
    const vol = fx.muted ? 0 : clamp(Number(fx.volume) / 100, 0, 2);
    if (vol !== 1) a.push('volume=' + num(vol));
    if (fi > 0) a.push(`afade=t=in:st=0:d=${num(fi)}`);
    if (fo > 0) a.push(`afade=t=out:st=${num(dur - fo)}:d=${num(fo)}`);
    a.push(`apad=whole_dur=${num(dur)}`, `atrim=end=${num(dur)}`, 'asetpts=PTS-STARTPTS');
    graph.push(`[${aIn}:a]${a.join(',')}[a${i}]`);
  });

  const pairs = clips.map((_, i) => `[v${i}][a${i}]`).join('');
  graph.push(`${pairs}concat=n=${clips.length}:v=1:a=1[v][a]`);

  return {
    graph: graph.join(';\n'),
    total,
    buildArgs(scriptPath) {
      return [
        ...args,
        '-filter_complex_script', scriptPath,
        '-map', '[v]', '-map', '[a]',
        '-c:v', 'libx264', '-preset', q.preset, '-crf', String(q.crf),
        '-pix_fmt', 'yuv420p', '-r', String(fps),
        '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
        '-movflags', '+faststart',
        '-progress', 'pipe:1', '-nostats',
        outPath
      ];
    }
  };
}

// Starts an export. Returns { promise, cancel }.
function runExport({ ffmpegPath, clips, settings, outPath, onProgress }) {
  if (!clips.length) throw new Error('The timeline is empty.');
  const cmd = buildCommand(clips, settings, outPath);
  const scriptPath = path.join(os.tmpdir(), `ace-graph-${Date.now()}.txt`);
  fs.writeFileSync(scriptPath, cmd.graph);

  const child = spawn(ffmpegPath, cmd.buildArgs(scriptPath), { windowsHide: true });
  let cancelled = false;
  let errText = '';
  let buf = '';

  child.stdout.on('data', (d) => {
    buf += d.toString();
    const lines = buf.split(/\r?\n/);
    buf = lines.pop();
    for (const line of lines) {
      const m = /^out_time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(line);
      if (m && onProgress) {
        const t = (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
        onProgress(clamp(t / cmd.total, 0, 1));
      }
    }
  });
  child.stderr.on('data', (d) => { errText += d.toString(); if (errText.length > 8000) errText = errText.slice(-8000); });

  const promise = new Promise((resolve) => {
    const finish = (r) => { try { fs.unlinkSync(scriptPath); } catch (e) { /* ignore */ } resolve(r); };
    child.on('error', (e) => finish({ ok: false, error: 'Could not start ffmpeg: ' + e.message }));
    child.on('close', (code) => {
      if (cancelled) {
        try { fs.unlinkSync(outPath); } catch (e) { /* ignore */ }
        return finish({ ok: false, cancelled: true });
      }
      if (code === 0) return finish({ ok: true, outPath });
      const lastLines = errText.trim().split('\n').slice(-4).join('\n');
      finish({ ok: false, error: lastLines || ('ffmpeg exited with code ' + code) });
    });
  });

  return { promise, cancel() { cancelled = true; child.kill(); }, total: cmd.total };
}

module.exports = { buildCommand, runExport, QUALITY };
