'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile, spawn } = require('child_process');
const { pathToFileURL } = require('url');
const { runExport } = require('./exporter');

// ffmpeg lives outside the asar archive once the app is packaged.
const unasar = (p) => p.replace(/app\.asar(?!\.unpacked)/, 'app.asar.unpacked');
const FFMPEG = unasar(require('ffmpeg-static'));
const FFPROBE = unasar(require('ffprobe-static').path);

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp']);
const VIDEO_EXT = ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'wmv', 'flv', 'mpg', 'mpeg', 'mts', 'm2ts', '3gp'];
const AUDIO_EXT = ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus', 'wma', 'aiff', 'aif'];
const PEAK_RATE = 20;   // waveform bars per second
const IMAGE_MAX = 3600; // images can be stretched up to an hour on the timeline

let win = null;
let currentJob = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1520,
    height: 920,
    minWidth: 1180,
    minHeight: 720,
    show: false,
    backgroundColor: '#000000',
    title: "Ace's Editing Software",
    icon: path.join(__dirname, 'renderer', 'assets', 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#000000', symbolColor: '#ffffff', height: 44 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => {
  if (currentJob) currentJob.cancel();
  if (process.platform !== 'darwin') app.quit();
});

// ---------- helpers ----------
function run(bin, args, binary) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { maxBuffer: 64 * 1024 * 1024, encoding: binary ? 'buffer' : 'utf8', windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          const msg = (stderr ? stderr.toString().trim().split('\n').pop() : '') || err.message;
          return reject(new Error(msg));
        }
        resolve(stdout);
      });
  });
}

async function thumbnail(file, at) {
  const grab = async (t) => {
    const buf = await run(FFMPEG, ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1',
      '-vf', 'scale=240:-2', '-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '5', 'pipe:1'], true);
    return buf && buf.length ? 'data:image/jpeg;base64,' + buf.toString('base64') : '';
  };
  try {
    return (await grab(at)) || (await grab(0));
  } catch (e) {
    try { return await grab(0); } catch (e2) { return ''; }
  }
}

// Reads the sound once and returns a small list of loudness peaks (0 to 255) for drawing a waveform.
function waveform(file) {
  return new Promise((resolve) => {
    const child = spawn(FFMPEG, ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', 'pipe:1'], { windowsHide: true });
    const bin = 8000 / PEAK_RATE;          // samples per peak
    const peaks = [];
    let leftover = Buffer.alloc(0), n = 0, max = 0;
    child.stdout.on('data', (chunk) => {
      const buf = leftover.length ? Buffer.concat([leftover, chunk]) : chunk;
      const usable = buf.length - (buf.length % 2);
      for (let i = 0; i < usable; i += 2) {
        const v = Math.abs(buf.readInt16LE(i));
        if (v > max) max = v;
        if (++n >= bin) { peaks.push(Math.min(255, Math.round(max / 32768 * 255))); n = 0; max = 0; }
      }
      leftover = buf.subarray(usable);
    });
    child.on('error', () => resolve(peaks));
    child.on('close', () => { if (n) peaks.push(Math.min(255, Math.round(max / 32768 * 255))); resolve(peaks); });
  });
}

async function probeFile(file) {
  const ext = path.extname(file).toLowerCase();
  const raw = await run(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  const info = JSON.parse(raw);
  const streams = info.streams || [];
  const v = streams.find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
  const hasAudioStream = streams.some((s) => s.codec_type === 'audio');
  if (!v) {
    // A song or sound file: no picture, so it goes under the timeline.
    if (!hasAudioStream) throw new Error('No video or sound found in this file');
    const length = parseFloat(info.format && info.format.duration) || 0;
    if (!length) throw new Error('Could not read the length of this file');
    return {
      path: file, url: pathToFileURL(file).href, name: path.basename(file), type: 'audio',
      duration: length, width: 0, height: 0, fps: 0, hasAudio: true, thumb: '',
      peaks: await waveform(file), peakRate: PEAK_RATE
    };
  }
  const isImage = IMAGE_EXT.has(ext);
  let duration = parseFloat(info.format && info.format.duration) || parseFloat(v.duration) || 0;
  if (isImage) duration = IMAGE_MAX;
  if (!duration) throw new Error('Could not read the length of this file');
  const [n, d] = String(v.avg_frame_rate || v.r_frame_rate || '30/1').split('/').map(Number);
  const fps = d ? n / d : 30;
  return {
    path: file,
    url: pathToFileURL(file).href,
    name: path.basename(file),
    type: isImage ? 'image' : 'video',
    duration,
    width: v.width || 0,
    height: v.height || 0,
    fps: fps > 0 && fps < 241 ? fps : 30,
    hasAudio: !isImage && streams.some((s) => s.codec_type === 'audio'),
    thumb: await thumbnail(file, isImage ? 0 : Math.min(1, duration * 0.1))
  };
}

// ---------- IPC ----------
ipcMain.handle('import:dialog', async (_e, kind) => {
  const all = { name: 'Video, images and music', extensions: [...VIDEO_EXT, ...[...IMAGE_EXT].map((e) => e.slice(1)), ...AUDIO_EXT] };
  const music = { name: 'Music and sound', extensions: AUDIO_EXT };
  const r = await dialog.showOpenDialog(win, {
    title: kind === 'audio' ? 'Add music' : 'Import clips or music',
    properties: ['openFile', 'multiSelections'],
    filters: kind === 'audio' ? [music, all, { name: 'All files', extensions: ['*'] }] : [all, music, { name: 'All files', extensions: ['*'] }]
  });
  return r.canceled ? [] : r.filePaths;
});

ipcMain.handle('media:probe', async (_e, paths) => {
  const media = [];
  const errors = [];
  for (const p of paths) {
    try { media.push(await probeFile(p)); }
    catch (err) { errors.push({ path: p, name: path.basename(p), error: String(err.message || err) }); }
  }
  return { media, errors };
});

ipcMain.handle('export:choose', async (_e, defaultName, ext, label) => {
  const r = await dialog.showSaveDialog(win, {
    title: 'Export',
    defaultPath: defaultName || 'Ace Export.mp4',
    filters: [{ name: label || 'Video', extensions: [ext || 'mp4'] }]
  });
  return r.canceled ? null : r.filePath;
});

ipcMain.handle('export:start', async (_e, job) => {
  if (currentJob) return { ok: false, error: 'An export is already running.' };
  try {
    currentJob = runExport({
      ffmpegPath: FFMPEG,
      clips: job.clips,
      music: job.music || [],
      settings: job.settings,
      outPath: job.outPath,
      onProgress: (p) => { if (win && !win.isDestroyed()) win.webContents.send('export:progress', p); }
    });
    const result = await currentJob.promise;
    return result;
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  } finally {
    currentJob = null;
  }
});

ipcMain.handle('export:cancel', () => { if (currentJob) currentJob.cancel(); });

ipcMain.handle('project:save', async (_e, { data, filePath, saveAs }) => {
  let p = filePath;
  if (!p || saveAs) {
    const r = await dialog.showSaveDialog(win, {
      title: 'Save project',
      defaultPath: p || 'Untitled.ace',
      filters: [{ name: 'Ace project', extensions: ['ace'] }]
    });
    if (r.canceled) return null;
    p = r.filePath;
  }
  fs.writeFileSync(p, data, 'utf8');
  return p;
});

ipcMain.handle('project:open', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Open project',
    properties: ['openFile'],
    filters: [{ name: 'Ace project', extensions: ['ace'] }]
  });
  if (r.canceled || !r.filePaths[0]) return null;
  return { path: r.filePaths[0], data: fs.readFileSync(r.filePaths[0], 'utf8') };
});

ipcMain.handle('shell:show', (_e, p) => { if (p) shell.showItemInFolder(p); });
