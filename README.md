# Media Studio

A browser-only media workspace for video, audio and image conversion.

## Web edition

Media Studio runs inside the browser. It does not require a Python server or a local backend.

- **Video / Audio:** FFmpeg.wasm (loaded on demand)
- **Image:** Canvas API
- **History:** localStorage in the current browser
- **Hosting:** GitHub Pages

Selected media files are processed in browser memory. They are not uploaded to a Media Studio server. FFmpeg.wasm runtime files are fetched from public CDNs when video/audio conversion is first used.

## GitHub Pages

The GitHub Actions workflow in `.github/workflows/pages.yml` deploys the repository root whenever changes are pushed to `main`.

In the repository settings, open **Pages** and make sure the publishing source is **GitHub Actions**.

After the first successful workflow, the site will be available at:

`https://minax2036-beep.github.io/Media-Studio/`

## Local preview

Because this is a static site, you can preview it with any static file server, or open `index.html` directly. Some browsers restrict module imports on `file://`, so a simple local static server is recommended for preview only.

## Browser compatibility and limitations

- A modern browser with JavaScript modules, WebAssembly, Canvas and Blob URL support is required.
- FFmpeg.wasm can be memory- and CPU-intensive. Large videos may fail on low-memory devices.
- This project uses the single-thread FFmpeg core; it does not require cross-origin isolation.
- Codec availability depends on the FFmpeg.wasm core build.
- Image GIF animation is not preserved by the current Canvas image workflow.
- Browser storage is local to the current browser profile and can be cleared by browser settings.

Use media you own or are authorized to process, and respect applicable copyright and website terms.
