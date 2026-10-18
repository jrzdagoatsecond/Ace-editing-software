# Ace's Editing Software

A black and white video editor for Windows. Import several clips, cut them on a timeline, add fades and motion blur, and export an MP4.

## Get the .exe from GitHub (no coding needed)

1. Make a new repository on GitHub (private is fine).
2. Upload everything in this folder to it. Make sure the `.github` folder goes up too.
   The easiest way is GitHub Desktop, or `git add . && git commit -m "Ace" && git push`.
3. Open the **Actions** tab. The **Build Windows .exe** workflow starts by itself (about 5 minutes).
   You can also start it with **Run workflow**.
4. When it finishes, open the run and download **Aces-Editing-Software-Windows** from the Artifacts section.
   It holds two files:
   - `Aces-Editing-Software-Setup-1.0.0.exe` installs the app and adds a Start menu shortcut.
   - `Aces-Editing-Software-Portable-1.0.0.exe` runs straight away with no install.

To publish a download page, tag a release (`git tag v1.0.0 && git push --tags`).
The .exe files are attached to a GitHub Release automatically.

Windows may show a "Windows protected your PC" warning because the app is not code-signed.
Choose **More info**, then **Run anyway**.

## Run it on your own computer instead

Install Node.js 20 or newer, then:

    npm install
    npm start

To build the .exe yourself on Windows: `npm run dist` (output goes in `dist/`).

## What it does

- **Import** several videos and images at once (button, Ctrl+I, or drag files in).
- **Timeline**: drag clips to reorder, drag a clip's edges to trim, split at the playhead, duplicate, delete.
  Gaps close automatically. Undo and redo cover every edit.
- **Effects per clip**: fade in, fade out, motion blur, speed (0.25x to 4x), volume or mute,
  brightness, contrast, saturation, sharpen, black and white, and Fit or Fill framing.
  **Enhance picture** adds a little contrast, colour and sharpness in one click.
  **Copy fades and blur to all clips** makes the whole video match.
- **Canvas**: 16:9, vertical 9:16 or square 1:1.
- **Export** to MP4 at 720p, 1080p or 1440p, 24, 30 or 60 fps, with Draft, Standard or High quality.
  Clips of different sizes, frame rates and with or without sound are matched up automatically.
- **Projects**: save and open `.ace` project files.

## Keys

| Key | Action |
| --- | --- |
| Space | Play or pause |
| S | Split at playhead |
| Delete | Delete selected clip |
| Left / Right | Step one frame (hold Shift for one second) |
| Home / End | Jump to start or end |
| Ctrl+Z / Ctrl+Y | Undo / redo |
| Ctrl+D | Duplicate clip |
| Ctrl+I / Ctrl+E | Import / export |
| Ctrl+S / Ctrl+O | Save / open project |
| + / - or Ctrl+scroll | Zoom the timeline |

## Notes

- The preview plays what Windows' built-in browser engine can decode (H.264 MP4, WebM and most MOV files).
  If a file cannot be previewed you get a message, but it still exports correctly.
- Motion blur in the preview is a quick approximation. The exported video uses true frame blending,
  so check the export for the final look.
- `npm run test:export` renders a short test video with every effect turned on, to check the export engine.
