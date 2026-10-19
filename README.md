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
- **Select several clips**: Ctrl+click adds or removes a clip, Shift+click selects a range, Ctrl+A selects all.
  Every effect, delete, duplicate and drag then works on the whole selection.
  If the selected clips have different values for a setting, it shows "Mixed" until you change it.
- **Effects** (each clip, or all selected clips at once):
  - fade in, fade out, volume, mute
  - motion blur trail, plus blur effects: Gaussian, Box, Horizontal, Vertical and Zoom
  - brightness, contrast, saturation, hue shift, sharpen, black and white
  - vignette, film grain, flip horizontal and vertical
  - Fit or Fill framing, and **Enhance picture** for a one-click boost
- **Speed and retime**: speed from 0.1x to 10x, a **Length** box to stretch a clip to an exact duration,
  and three frame modes for slow motion and fast motion:
  - **Sampling** repeats or skips frames (fastest)
  - **Frame blend** mixes neighbouring frames for smoother results
  - **Optical flow** works out in-between frames for the smoothest slow motion (slow to export)

  New clips use Frame blend by default, so slow motion is smooth from the start. The Speed slider is logarithmic
  (slow speeds get as much room as fast ones) and snaps to 0.25x, 0.5x, 1x and 2x. Speed ramps use 24 eased steps.


  Also **Keep pitch or Change pitch**, **Reverse**, and one-click **speed ramps**
  (slow to fast, fast to slow, slow in the middle).
- **Music under the timeline**: import songs and sounds (MP3, WAV, FLAC, M4A, AAC, OGG, Opus, AIFF) with
  **Add music**, the Import button, or by dragging files onto the two music lanes. Songs show a waveform and can be
  dragged to move (they snap to clip edges and the playhead), dragged up or down to change lanes, trimmed from
  either edge, split with S, and given volume, fades and a start time. Everything is mixed into the export.
- **Fullscreen preview**: press **Ctrl+F** (or the fullscreen button, or double-click the picture) to watch your edit
  full screen. It starts playing at once. Move the mouse for the play bar, press Left or Right to jump 5 seconds,
  and press Esc or Ctrl+F to leave.
- **Export formats**:
  - Video: MP4, MOV, MOV ProRes, WebM, MKV, AVI
  - Animated GIF
  - Audio only: MP3, WAV, FLAC, M4A (AAC), OGG

  Video exports can be 720p, 1080p or 1440p at 24, 30 or 60 fps, in 16:9, 9:16 or 1:1.
- **Save project** keeps your editable timeline as an `.ace` file. **Export** makes the finished file.

## Keys

| Key | Action |
| --- | --- |
| Space | Play or pause |
| S | Split at playhead |
| Delete | Delete selected clip |
| Left / Right | Step one frame (hold Shift for one second) |
| Home / End | Jump to start or end |
| Ctrl+F | Fullscreen preview (plays your edit) |
| Ctrl+Z / Ctrl+Y | Undo / redo |
| Ctrl+click / Shift+click | Add to selection / select a range |
| Ctrl+A | Select all clips |
| Ctrl+D | Duplicate clip |
| Ctrl+I / Ctrl+E | Import / export |
| Ctrl+S / Ctrl+O | Save / open project |
| + / - or Ctrl+scroll | Zoom the timeline |

## Notes

- The preview plays what Windows' built-in browser engine can decode (H.264 MP4, WebM and most MOV files).
  If a file cannot be previewed you get a message, but it still exports correctly.
- In the preview, motion blur averages real video frames, so it shows both while playing and on a paused frame
  (a paused frame takes a moment to gather the frames before it). Frame blend slow motion fades between frames.
  Reverse and Optical flow only show in the export, and the preview plays forward.
- Reverse keeps the clip in memory while exporting, so use it on shorter clips (a minute or less is comfortable).
- Blur effects in the preview are close approximations of the export. Check the export for the exact look. The exported video uses true frame blending,
  so check the export for the final look.
- `npm run test:export` exports test clips in every format and with every effect, to check the export engine.
