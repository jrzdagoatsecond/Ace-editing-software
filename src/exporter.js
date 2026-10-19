'use strict';
// Turns the timeline into one ffmpeg command. No Electron code in here,
// so it can be tested on its own (see test/export-test.js).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

// Quality presets. Each format picks the numbers that apply to it.
const QUALITY = {
  draft:    { crf: 28, preset: 'veryfast', vp9: 38, mpeg4: 8, ab: '128k', ogg: 3 },
  standard: { crf: 22, preset: 'medium',   vp9: 32, mpeg4: 4, ab: '192k', ogg: 5 },
  high:     { crf: 17, preset: 'slow',     vp9: 26, mpeg4: 2, ab: '320k', ogg: 8 }
};

// kind: video | audio | gif
const FORMATS = {
  mp4:    { kind: 'video', ext: 'mp4',  label: 'MP4 video',
            v: (q) => ['-c:v', 'libx264', '-preset', q.preset, '-crf', String(q.crf), '-pix_fmt', 'yuv420p'],
            a: (q) => ['-c:a', 'aac', '-b:a', q.ab], extra: ['-movflags', '+faststart'] },
  mov:    { kind: 'video', ext: 'mov',  label: 'MOV video',
            v: (q) => ['-c:v', 'libx264', '-preset', q.preset, '-crf', String(q.crf), '-pix_fmt', 'yuv420p'],
            a: (q) => ['-c:a', 'aac', '-b:a', q.ab], extra: ['-movflags', '+faststart'] },
  prores: { kind: 'video', ext: 'mov',  label: 'MOV ProRes video',
            v: () => ['-c:v', 'prores_ks', '-profile:v', '3', '-pix_fmt', 'yuv422p10le'],
            a: () => ['-c:a', 'pcm_s16le'], extra: [] },
  webm:   { kind: 'video', ext: 'webm', label: 'WebM video',
            v: (q) => ['-c:v', 'libvpx-vp9', '-crf', String(q.vp9), '-b:v', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4', '-pix_fmt', 'yuv420p'],
            a: () => ['-c:a', 'libopus', '-b:a', '160k'], extra: [] },
  mkv:    { kind: 'video', ext: 'mkv',  label: 'MKV video',
            v: (q) => ['-c:v', 'libx264', '-preset', q.preset, '-crf', String(q.crf), '-pix_fmt', 'yuv420p'],
            a: (q) => ['-c:a', 'aac', '-b:a', q.ab], extra: [] },
  avi:    { kind: 'video', ext: 'avi',  label: 'AVI video',
            v: (q) => ['-c:v', 'mpeg4', '-q:v', String(q.mpeg4), '-pix_fmt', 'yuv420p'],
            a: (q) => ['-c:a', 'libmp3lame', '-b:a', q.ab], extra: [] },
  gif:    { kind: 'gif',   ext: 'gif',  label: 'Animated GIF', extra: [] },
  mp3:    { kind: 'audio', ext: 'mp3',  label: 'MP3 audio', a: (q) => ['-c:a', 'libmp3lame', '-b:a', q.ab], extra: [] },
  wav:    { kind: 'audio', ext: 'wav',  label: 'WAV audio', a: () => ['-c:a', 'pcm_s16le'], extra: [] },
  flac:   { kind: 'audio', ext: 'flac', label: 'FLAC audio', a: () => ['-c:a', 'flac', '-compression_level', '8'], extra: [] },
  m4a:    { kind: 'audio', ext: 'm4a',  label: 'M4A (AAC) audio', a: (q) => ['-c:a', 'aac', '-b:a', q.ab], extra: ['-movflags', '+faststart'] },
  ogg:    { kind: 'audio', ext: 'ogg',  label: 'OGG audio', a: (q) => ['-c:a', 'libvorbis', '-q:a', String(q.ogg)], extra: [] }
};

const GIF_FPS = 15;
const GIF_MAX_SHORT = 480;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const num = (v) => Number(v).toFixed(4).replace(/\.?0+$/, '') || '0';
const even = (v) => Math.max(2, Math.round(v / 2) * 2);

function atempoChain(speed) {
  const parts = [];
  let s = speed;
  while (s > 2) { parts.push('atempo=2'); s /= 2; }
  while (s < 0.5) { parts.push('atempo=0.5'); s /= 0.5; }
  parts.push('atempo=' + num(s));
  return parts.join(',');
}

// clips: [{ path, type:'video'|'image', hasAudio, in, out, fx }]
// music: [{ path, start, in, out, fx:{ volume, fadeIn, fadeOut } }]   songs placed under the timeline
// settings: { w, h, fps, quality, format }
function buildCommand(clips, settings, outPath, music = []) {
  const fmt = FORMATS[settings.format || 'mp4'];
  if (!fmt) throw new Error('Unknown format: ' + settings.format);
  const q = QUALITY[settings.quality] || QUALITY.standard;
  const wantV = fmt.kind !== 'audio';
  const wantA = fmt.kind !== 'gif';
  const { w, h } = settings;
  const fps = fmt.kind === 'gif' ? GIF_FPS : settings.fps;
  const short = Math.min(w, h);

  const args = ['-y', '-hide_banner', '-loglevel', 'error'];
  const graph = [];
  let inputIndex = 0;
  let total = 0;

  clips.forEach((c, i) => {
    const fx = c.fx;
    const speed = clamp(Number(fx.speed) || 1, 0.1, 10);
    const srcLen = Math.max(0.05, c.out - c.in);
    const dur = srcLen / speed;
    const isImage = c.type === 'image';
    const reverse = !!fx.reverse && !isImage;
    total += dur;

    const vIn = inputIndex++;
    if (isImage) {
      args.push('-loop', '1', '-framerate', String(fps), '-t', num(srcLen), '-i', c.path);
    } else {
      args.push('-ss', num(c.in), '-t', num(srcLen), '-i', c.path);
    }

    const fi = clamp(Number(fx.fadeIn) || 0, 0, dur);
    const fo = clamp(Number(fx.fadeOut) || 0, 0, dur);

    // ---------------- video ----------------
    if (wantV) {
      const pre = [];
      if (reverse) pre.push('reverse');
      pre.push('setpts=(PTS-STARTPTS)/' + num(speed));

      // Retiming: how the in-between frames are made.
      const interp = isImage ? 'nearest' : (fx.interp || 'nearest');
      if (speed < 1 && interp === 'blend') {
        pre.push(`minterpolate=fps=${fps}:mi_mode=blend`);
      } else if (speed < 1 && interp === 'optical') {
        pre.push(`minterpolate=fps=${fps}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1`);
      } else if (speed > 1 && interp !== 'nearest') {
        pre.push('tmix=frames=' + clamp(Math.round(speed), 2, 8));
      }
      pre.push('fps=' + fps, 'trim=duration=' + num(dur), 'setpts=PTS-STARTPTS');

      if (fx.fit === 'cover') {
        pre.push(`scale=${w}:${h}:force_original_aspect_ratio=increase`, `crop=${w}:${h}`);
      } else {
        pre.push(`scale=${w}:${h}:force_original_aspect_ratio=decrease`,
                 `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black`);
      }
      pre.push('setsar=1');
      if (fx.flipH) pre.push('hflip');
      if (fx.flipV) pre.push('vflip');

      const b = clamp(Number(fx.brightness) || 0, -100, 100) / 200;
      const ct = 1 + clamp(Number(fx.contrast) || 0, -100, 100) / 100;
      const sat = 1 + clamp(Number(fx.saturation) || 0, -100, 100) / 100;
      if (b !== 0 || ct !== 1 || sat !== 1) {
        pre.push(`eq=brightness=${num(b)}:contrast=${num(ct)}:saturation=${num(sat)}`);
      }
      const hue = clamp(Number(fx.hue) || 0, -180, 180);
      if (hue !== 0 || fx.bw) pre.push(`hue=h=${num(hue)}:s=${fx.bw ? 0 : 1}`);
      const sharp = clamp(Number(fx.sharpen) || 0, 0, 100);
      if (sharp > 0) pre.push(`unsharp=5:5:${num(sharp / 100 * 1.5)}:5:5:0`);

      // Blur effects
      const amt = clamp(Number(fx.blurAmt) || 0, 0, 100) / 100;
      const type = fx.blurType || 'gaussian';
      let zoomBlur = 0;
      if (amt > 0) {
        if (type === 'gaussian') pre.push(`gblur=sigma=${num(Math.max(0.5, amt * 30 * short / 720))}`);
        else if (type === 'box') pre.push(`boxblur=${Math.max(1, Math.round(amt * 20 * short / 720))}:2`);
        else if (type === 'horizontal') pre.push(`avgblur=sizeX=${Math.max(1, Math.round(amt * 0.04 * w))}:sizeY=1`);
        else if (type === 'vertical') pre.push(`avgblur=sizeX=1:sizeY=${Math.max(1, Math.round(amt * 0.04 * h))}`);
        else if (type === 'zoom') zoomBlur = amt;
      }

      const post = [];
      const frames = Math.round(1 + (clamp(Number(fx.blur) || 0, 0, 100) / 100) * 7);
      if (frames > 1) post.push('tmix=frames=' + frames);   // motion blur trail
      const vig = clamp(Number(fx.vignette) || 0, 0, 100) / 100;
      if (vig > 0) post.push(`vignette=angle=${num(1.5708 - vig * (1.5708 - 0.4))}`);
      const grain = clamp(Number(fx.grain) || 0, 0, 100) / 100;
      if (grain > 0) post.push(`noise=alls=${Math.round(grain * 45)}:allf=t+u`);
      if (fi > 0) post.push(`fade=t=in:st=0:d=${num(fi)}`);
      if (fo > 0) post.push(`fade=t=out:st=${num(dur - fo)}:d=${num(fo)}`);
      post.push('format=yuv420p');

      if (zoomBlur > 0) {
        // Zoom blur: average several copies of the picture at growing zoom levels.
        const N = 6;
        const k = zoomBlur * 0.22;
        const outs = Array.from({ length: N }, (_, j) => `[z${i}_${j}]`).join('');
        graph.push(`[${vIn}:v]${pre.join(',')},format=yuv420p,split=${N}${outs}`);
        for (let j = 1; j < N; j++) {
          const s = 1 + k * j / (N - 1);
          graph.push(`[z${i}_${j}]scale=${even(w * s)}:${even(h * s)},crop=${w}:${h}[s${i}_${j}]`);
        }
        let prev = `[z${i}_0]`;
        for (let j = 1; j < N; j++) {
          const out = `[m${i}_${j}]`;
          graph.push(`${prev}[s${i}_${j}]blend=all_expr='(A*${j}+B)/${j + 1}'${out}`);
          prev = out;
        }
        graph.push(`${prev}${post.join(',')}[v${i}]`);
      } else {
        graph.push(`[${vIn}:v]${pre.concat(post).join(',')}[v${i}]`);
      }
    }

    // ---------------- audio ----------------
    if (wantA) {
      const a = [];
      let aIn;
      if (!isImage && c.hasAudio) {
        aIn = vIn;
        if (reverse) a.push('areverse');
        a.push('asetpts=PTS-STARTPTS', 'aresample=48000');
        if (speed !== 1) {
          if (fx.pitch === false) a.push(`asetrate=${Math.round(48000 * speed)}`, 'aresample=48000');
          else a.push(atempoChain(speed));
        }
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
    }
  });

  let aLabel = '[a]';
  let videoTotal = total;
  if (clips.length) {
    const pairs = clips.map((_, i) => (wantV ? `[v${i}]` : '') + (wantA ? `[a${i}]` : '')).join('');
    graph.push(`${pairs}concat=n=${clips.length}:v=${wantV ? 1 : 0}:a=${wantA ? 1 : 0}${wantV ? '[v]' : ''}${wantA ? '[a]' : ''}`);
  } else {
    // Music only: start from silence as long as the longest song.
    videoTotal = music.reduce((m, t) => Math.max(m, t.start + (t.out - t.in)), 0.1);
    total = videoTotal;
    const base = inputIndex++;
    args.push('-f', 'lavfi', '-t', num(videoTotal), '-i', 'anullsrc=r=48000:cl=stereo');
    graph.push(`[${base}:a]aformat=sample_fmts=fltp:channel_layouts=stereo[a]`);
  }

  // Songs under the timeline: each is trimmed, faded, delayed to its start time, then mixed in.
  if (wantA && music.length) {
    const labels = [];
    music.forEach((t, k) => {
      const len = Math.max(0.05, t.out - t.in);
      const idx = inputIndex++;
      args.push('-ss', num(t.in), '-t', num(len), '-i', t.path);
      const m = ['asetpts=PTS-STARTPTS', 'aresample=48000', 'aformat=sample_fmts=fltp:channel_layouts=stereo'];
      const vol = t.fx && t.fx.muted ? 0 : clamp((t.fx ? Number(t.fx.volume) : 100) / 100, 0, 2);
      if (vol !== 1) m.push('volume=' + num(vol));
      const tfi = clamp(Number(t.fx && t.fx.fadeIn) || 0, 0, len);
      const tfo = clamp(Number(t.fx && t.fx.fadeOut) || 0, 0, len);
      if (tfi > 0) m.push(`afade=t=in:st=0:d=${num(tfi)}`);
      if (tfo > 0) m.push(`afade=t=out:st=${num(len - tfo)}:d=${num(tfo)}`);
      const ms = Math.round(Math.max(0, t.start) * 1000);
      if (ms > 0) m.push(`adelay=${ms}|${ms}`);
      graph.push(`[${idx}:a]${m.join(',')}[m${k}]`);
      labels.push(`[m${k}]`);
    });
    graph.push(`[a]${labels.join('')}amix=inputs=${1 + music.length}:duration=first:normalize=0[amix]`);
    aLabel = '[amix]';
  }

  let maps;
  if (fmt.kind === 'gif') {
    const k = Math.min(1, GIF_MAX_SHORT / short);
    graph.push(`[v]fps=${GIF_FPS},scale=${even(w * k)}:${even(h * k)}:flags=lanczos,split[g1][g2]`);
    graph.push('[g1]palettegen=stats_mode=diff[pal]');
    graph.push('[g2][pal]paletteuse=dither=bayer:bayer_scale=5[gif]');
    maps = ['-map', '[gif]', '-loop', '0'];
  } else if (fmt.kind === 'audio') {
    maps = ['-map', aLabel, ...fmt.a(q)];
  } else {
    maps = ['-map', '[v]', '-map', aLabel, ...fmt.v(q), '-r', String(fps), ...fmt.a(q), '-ar', '48000'];
  }

  return {
    graph: graph.join(';\n'),
    total,
    fmt,
    buildArgs(scriptPath) {
      return [...args, '-filter_complex_script', scriptPath, ...maps, ...fmt.extra,
        '-progress', 'pipe:1', '-nostats', outPath];
    }
  };
}

// Starts an export. Returns { promise, cancel }.
function runExport({ ffmpegPath, clips, music = [], settings, outPath, onProgress }) {
  if (!clips.length && !music.length) throw new Error('The timeline is empty.');
  const kind = (FORMATS[settings.format || 'mp4'] || {}).kind;
  if (!clips.length && kind !== 'audio') throw new Error('Add a video clip to the timeline first, or export as an audio format.');
  const cmd = buildCommand(clips, settings, outPath, music);
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

module.exports = { buildCommand, runExport, QUALITY, FORMATS };
