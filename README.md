# Media Studio

A local-first media workspace for video, audio, image processing, and media-page inspection.

## Current status

**Foundation 0.1.0**

- Glass-style dashboard UI
- Local Python HTTP server
- Local environment status for FFmpeg / FFprobe
- Optional module detection for yt-dlp and Pillow
- No external upload server

## Requirements

- Python 3.10 or newer
- FFmpeg and FFprobe (needed for video/audio features; not required just to open the dashboard)

The foundation currently uses only Python's standard library.

## Run

Clone the repository, then run:

```bash
python3 app.py
```

Open this address in your browser:

```
http://127.0.0.1:8765
```

Stop the server with `Ctrl+C`.

The server binds to `127.0.0.1`, so it is accessible only from the same computer by default.

## Planned modules

- Video: FFmpeg / FFprobe
- Audio: FFmpeg
- Image: Pillow
- Downloader: yt-dlp for supported, permitted sources
- Queue and history: local metadata

Media Studio is intended for content you own or are authorized to process. Respect website terms, copyright, and access restrictions.
