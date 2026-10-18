'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { pathToFileURL } = require('url');
const { runExport } = require('./exporter');

// ffmpeg lives outside the asar archive once the app is packaged.
const unasar = (p) => p.replace(/app\.asar(?!\.unpacked)/, 'app.asar.unpacked');
const FFMPEG = unasar(require('ffmpeg-static'));
const FFPROBE = unasar(require('ffprobe-static').path);

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp']);
const VIDEO_EXT = ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'wmv', 'flv', 'mpg', 'mpeg', 'mts', 'm2ts', '3gp'];
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

async function probeFile(file) {
  const ext = path.extname(file).toLowerCase();
  const raw = await run(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  const info = JSON.parse(raw);
  const streams = info.streams || [];
  const v = streams.find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
  if (!v) throw new Error('No video found in this file');
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
ipcMain.handle('import:dialog', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Import clips',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Video and images', extensions: [...VIDEO_EXT, ...[...IMAGE_EXT].map((e) => e.slice(1))] },
      { name: 'All files', extensions: ['*'] }
    ]
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

ipcMain.handle('export:choose', async (_e, defaultName) => {
  const r = await dialog.showSaveDialog(win, {
    title: 'Export video',
    defaultPath: defaultName || 'Ace Export.mp4',
    filters: [{ name: 'MP4 video', extensions: ['mp4'] }]
  });
  return r.canceled ? null : r.filePath;
});

ipcMain.handle('export:start', async (_e, job) => {
  if (currentJob) return { ok: false, error: 'An export is already running.' };
  try {
    currentJob = runExport({
      ffmpegPath: FFMPEG,
      clips: job.clips,
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
