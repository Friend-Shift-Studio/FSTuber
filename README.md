# FSTuber

FSTuber is a static, browser-based editor for short video compositions and PNGtuber overlays. It previews local media without changing the source file, mixes video and music audio, and exports a new recording. Local editing does not require an account. The site has no backend or database.

## Run the app

On GitHub Pages, open the repository's Pages URL after the `GitHub Pages` workflow succeeds. For local work, serve the repository root over HTTP:

```sh
python3 -m http.server 3000
```

Then open `http://localhost:3000`. The localhost origin supports browser features such as screen capture and web workers. Direct `file://` use can still preview local files, but browser security restrictions disable some capabilities. Screen capture and OAuth integrations require an HTTPS site or localhost.

The app uses vanilla HTML, CSS, and JavaScript. No build or package installation is required. Its script responsibilities and order are documented in the comments at the top of each `js/*.js` module.

## Supported media and editing

Local, Google Drive, and GitHub browsers filter for PNG, JPG/JPEG, GIF, APNG, WebP, MP4, WebM, MP3, WAV, and OGG. FSTuber supports drag-and-drop on the preview, a file picker, video preview and trim points, non-destructive color and text controls, aspect/crop settings, markers, independent video/music levels and live meters, and keyboard shortcuts. Press `?` for the shortcut reference; Space toggles playback and the arrow keys seek. PNGtuber assets are layered over the preview; state and hold/toggle shortcuts can be configured in Settings. Saved layer positions and states return when matching image files are reloaded.

Original media remains unchanged. Clear All Assets releases locally created object URLs and stops media streams. A save always creates a new output; the app never writes to an original file. Local output is delivered through the browser's download system, which handles an existing destination name using its standard suffix or prompt because a web page cannot inspect the user's download folder. Google Drive checks all pages in the destination folder and adds a suffix before upload. Drive exports are stored under a top-level `FSTuber` folder. Settings are saved only as `FSTuber/configuration/settings.json`; session presets can also be imported or exported as JSON.

## Optional connections

In **Settings → API Setup**, enter public client IDs only. Never enter an OAuth client secret. Register the displayed site origin in Google's Authorized JavaScript origins and the exact displayed redirect URL in Spotify's dashboard.

For Google Drive, create an OAuth 2.0 Web application client in the [Google Cloud Console](https://console.cloud.google.com/apis/credentials), enable the Drive API, and register both the exact site origin as an Authorized JavaScript origin and the same-origin page URL shown in API Setup as an Authorized redirect URI. FSTuber requests the `drive.file` scope through a Google Identity Services popup token flow; that flow uses the JavaScript origin and does not send a redirect callback. This scope only exposes files made accessible to FSTuber; if a folder created outside the app is not visible, the app may create a separate app-accessible `FSTuber` folder. The access token stays in memory and is not written to settings.

For Spotify, create an app in the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard), add the exact redirect URL shown in FSTuber, and use Authorization Code with PKCE. No client secret is required in the browser. The picker mixes only preview clips the service exposes; full protected Spotify playback remains in Spotify and is not captured. Use a local or Drive audio file for full-length music. Preview availability and other playback features can depend on Spotify API policy and account eligibility.

For GitHub browsing, create a fine-grained personal access token with **Contents: read-only** for the repositories you intend to browse. The token is kept in `sessionStorage` for the current browser tab and is excluded from local and Drive settings. Disconnect or close the tab to clear the session token.

All connections are optional. A missing client ID opens API Setup and highlights the relevant field; it does not block local editing. Public client IDs may be saved in local settings and, when Drive is connected, the Drive settings file. OAuth access tokens stay in memory; the GitHub token is session-only.

## Recording and exports

WebM is the primary browser-native export. Video replay captures the composition canvas and mixed audio between the selected trim points. Screen-share recording continues until stopped, and begins the loaded music track with the capture. A completed recording opens in a review dialog; rename it before saving locally or to Drive. The app refuses empty or unsafe names and does not write over an existing source or Drive file; local destination collisions are handled by the browser download system.

MP4 conversion is optional and loads FFmpeg.wasm from a CDN only when requested. It uses a single-thread browser worker and can be limited by codec support, network access, memory, or recording size. GIF export uses the bundled GIF.js worker, needs the app served over HTTP/HTTPS, and is limited to silent clips no longer than 10 seconds and 480 pixels wide. If conversion is unavailable, save the preview as WebM instead.

## Browser and compatibility notes

Use a recent browser with `MediaRecorder`, `HTMLCanvasElement.captureStream`, Web Audio, and Web Workers. Screen capture additionally needs `navigator.mediaDevices.getDisplayMedia`; browsers may not provide system audio even when audio capture is requested. Codec support differs by browser. Animated GIF/APNG playback follows the browser's image decoder. FSTuber reports unsupported capabilities rather than renaming an unconverted file to a different extension.

OAuth popups may be blocked until the site origin is authorized in the provider console. GitHub Pages project sites include a repository path in the URL, so the full redirect URL must match that path exactly. For local Google testing, add both the localhost origin and its same-origin page URL; for Spotify, register the full localhost redirect URL.

## Project references

The copied [application prompt](./FSS-PNGt-Overlay%20Manus-Prompt.md) and [feature checklist](./FSS-PNGT-Overlay.md) preserve the source requirements and cross-reference each other. The original Obsidian notes remain in their source repository. See [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md) for bundled asset licenses.
