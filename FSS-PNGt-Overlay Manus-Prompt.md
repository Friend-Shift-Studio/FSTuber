## Related checklist

This specification is paired with [`FSS-PNGT-Overlay.md`](./FSS-PNGT-Overlay.md).

```markdown
# FSTuber — Detailed Build Specification for AI Agent

**App Name:** FSTuber
**Studio:** FSS / FS Studio / FriendShifts Studio
**Hosting Target:** Static site (GitHub Pages compatible). All authentication must use client-side flows only. No backend. No client secrets in the frontend.

**Core Goal:** Browser-based video tool that looks and feels like a native desktop app (clean, dense, no neon, no oversized web padding, no glowing effects). User can load a video (local file or screen share), add background music, overlay a PNGtuber (PNG/GIF/APNG collection) controlled by customizable keyboard shortcuts, then export the result either locally or to Google Drive without ever overwriting original files.

**Folder Convention (Google Drive):**  
- All user-generated/edited files go into a top-level folder named exactly `FSTuber/`  
- Settings live only in `FSTuber/configuration/settings.json`  
- Never write edited videos or images into the configuration folder  
- Always create new files; never replace existing ones unless the user explicitly confirms overwrite after a rename prompt

**Allowed Media Formats:**  
- Images: png, jpg, jpeg, gif, apng, webp  
- Video: mp4, webm  
- Audio: mp3, wav, ogg (for background music)

---

## 0. Client-Side API Keys & User Instructions (Critical)

111. The app must work as a pure static site (GitHub Pages). Therefore only public client IDs are allowed. Never ask for or embed client secrets.
112. Create a clear “API Setup” section inside the Settings modal (or a first-run banner) that explains exactly what the user needs to provide.
113. When any service is not configured, show a non-blocking notice: “Google / GitHub / Spotify connection requires a client ID. See Settings → API Setup for instructions.”
114. **Google Drive (client-side):**
    - User must create an OAuth 2.0 Client ID (Web application) in Google Cloud Console.
    - Required scopes: `https://www.googleapis.com/auth/drive.file`
    - Authorized JavaScript origins: the exact GitHub Pages URL (e.g. `https://username.github.io`)
    - Authorized redirect URIs: same origin + `/` or the page path.
    - The Client ID is public and safe to paste into the app.
    - In the UI, provide a text field “Google Client ID” that is saved in settings (localStorage + Drive settings.json).
    - Link in the help text: https://console.cloud.google.com/apis/credentials
115. **Spotify (client-side, PKCE):**
    - User creates an app in the Spotify Developer Dashboard.
    - Only the Client ID is needed (no secret).
    - Redirect URI must be added in the Spotify app settings (exact GitHub Pages URL).
    - Use Authorization Code with PKCE flow (spotify-web-api-js or manual PKCE is fine).
    - Scopes: `user-read-playback-state user-modify-playback-state user-read-currently-playing playlist-read-private user-library-read`
    - Provide a text field “Spotify Client ID” saved in settings.
    - Link: https://developer.spotify.com/dashboard
116. **GitHub (client-side options):**
    - Preferred for pure static site: User generates a fine-grained Personal Access Token (PAT) with only the `Contents` permission (read) on the repositories they want to browse.
    - Alternative: GitHub OAuth App Client ID + PKCE (if the agent implements it). Client secret must never be used.
    - Provide a password-style input “GitHub Personal Access Token” (stored only in memory/sessionStorage, never written to Drive settings.json in plain text if possible; or encrypt/obfuscate lightly).
    - Clear warning: “This token is stored only in your browser session. Do not share it.”
    - Link for creating token: https://github.com/settings/tokens?type=beta (fine-grained)
117. All three fields (Google Client ID, Spotify Client ID, GitHub Token) must be editable in Settings → API Setup and persisted appropriately.
118. On app load, if a required client ID is missing when the user clicks a login button, open the API Setup section automatically and highlight the missing field.
119. Add short copy-paste ready instructions under each field so a non-developer can follow them.

---

## 1. Project Skeleton & Boilerplate

1. Create the following exact file and folder structure:
   ```
   /
   ├── index.html
   ├── css/
   │   └── styles.css
   ├── js/
   │   ├── app.js
   │   ├── settings.js
   │   ├── auth.js
   │   ├── media.js
   │   ├── pnuber.js
   │   ├── recorder.js
   │   ├── shortcuts.js
   │   └── ui.js
   └── assets/
       └── icons/
   ```
2. In `index.html` write a complete HTML5 document with:
   - `<!DOCTYPE html>`
   - `<html lang="en">`
   - charset UTF-8
   - viewport meta
   - theme-color meta that will later be updated by theme
   - title exactly `FSTuber`
   - link to `css/styles.css`
   - script tags for every JS file in `/js/` with `defer` (load order: settings.js → auth.js → media.js → pnuber.js → recorder.js → shortcuts.js → ui.js → app.js)
3. Add a single root `<div id="app">` that will contain the entire UI.
4. Do not use any external CSS or JS frameworks that impose a “web app” look. Only lightweight icon library is allowed.
5. Load Google Identity Services and any needed Spotify helper via CDN script tags in `index.html` (no build step).

## 2. Native App Shell & Visual Design

6. In `css/styles.css` define CSS custom properties on `:root` for a neutral light theme:
   - `--bg: #f5f5f7`
   - `--surface: #ffffff`
   - `--text: #1d1d1f`
   - `--text-secondary: #6e6e73`
   - `--border: #d2d2d7`
   - `--accent: #007aff` (system blue, used sparingly)
   - `--radius: 6px`
   - `--font: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
7. Define a `[data-theme="dark"]` override:
   - `--bg: #0f0f0f`
   - `--surface: #1c1c1e`
   - `--text: #f5f5f7`
   - `--text-secondary: #a1a1a6`
   - `--border: #38383a`
   - `--accent: #0a84ff`
8. Set `html, body, #app` to `height: 100%; margin: 0; overflow: hidden; font-family: var(--font); background: var(--bg); color: var(--text);`
9. Build a three-column + bottom bar layout using CSS grid on `#app`:
   - Top bar (height 36px): app title left, window-style buttons right (minimize/maximize/close are visual only)
   - Left sidebar (width 240px): tools and file browser
   - Center: main preview/canvas area
   - Right panel (width 280px): properties and PNGtuber controls
   - Bottom bar (height 64px): playback, timeline, volume
10. All buttons, inputs, and panels must use tight padding (4–8px), 1px solid borders, and subtle hover states (background change only, no glow or scale).
11. Use the icon library only for 16–20px icons. No large decorative icons.
12. Make the entire UI keyboard navigable with visible focus rings that use the accent color at 40% opacity.
13. Add a CSS class `.native-button` and `.native-panel` that the rest of the UI will use so the look stays consistent.

## 3. Settings System (settings.js)

14. Create a default settings object:
    ```js
    const DEFAULT_SETTINGS = {
      theme: "light",
      customCSS: "",
      shortcuts: {},
      musicVolume: 0.5,
      videoVolume: 1,
      lastExportName: "",
      pnuberPosition: { x: 20, y: 20, scale: 1 },
      googleClientId: "",
      spotifyClientId: "",
      githubToken: ""   // kept in session only if possible
    };
    ```
15. Implement `async function loadSettings()` that:
    - Tries to read `FSTuber/configuration/settings.json` from Google Drive if authenticated
    - Falls back to localStorage key `fstuber-settings`
    - Merges with DEFAULT_SETTINGS
    - Applies theme and custom CSS immediately
16. Implement `async function saveSettings(settings)` that writes to both Drive (if connected) and localStorage. Do not write the raw GitHub token to Drive if it can be avoided.
17. Create a Settings modal (opened from a gear icon in the top bar) with sections:
    - Appearance (theme toggle, custom CSS textarea)
    - API Setup (Google Client ID, Spotify Client ID, GitHub Token + instructions)
    - Shortcuts (list of current mappings with edit buttons)
    - Audio defaults
    - Reset to defaults button (with confirmation)
18. When the user edits the custom CSS textarea and clicks “Apply”, inject it into a `<style id="user-custom-css">` tag in the head and save.
19. Theme toggle must set `document.documentElement.dataset.theme` and save immediately.

## 4. Authentication (auth.js)

20. Read Google Client ID, Spotify Client ID, and GitHub token from settings before starting any login flow.
21. If the required ID/token is empty, do not start OAuth. Instead open Settings → API Setup and show a message: “Please add your [Service] Client ID first. Instructions are below the field.”
22. Implement Google OAuth using Google Identity Services with the user-supplied Client ID and scope `https://www.googleapis.com/auth/drive.file`.
23. Store the Google access token in memory only.
24. Implement Spotify Authorization Code with PKCE using the user-supplied Client ID.
25. Implement GitHub access by using the user-supplied Personal Access Token in the `Authorization: Bearer` header for API calls (or OAuth PKCE if implemented).
26. Create three login buttons in the left sidebar under a “Connections” heading. Show green check + username when connected, red X when not.
27. Add a “Disconnect” action for each service that clears the token and updates the UI.
28. On successful Google login, call a function that ensures the folders `FSTuber` and `FSTuber/configuration` exist (create them if missing).

## 5. File Browser & Asset Loading (media.js)

29. Build a file browser panel in the left sidebar that can switch between three sources: Local, Google Drive, GitHub.
30. For Google Drive: list only files whose MIME type or extension is in the allowed media formats. Show thumbnail + filename.
31. For GitHub: let the user pick a repository and branch, then list matching files from that repo using the provided token.
32. For Local: use `<input type="file" accept="image/*,video/*,audio/*" multiple>`.
33. When the user selects a video file, load it into a hidden `<video>` element and display the first frame on the main canvas.
34. When the user selects image files (PNG/GIF/APNG), store them in an array of objects:
    ```js
    { name: "anime_laugh.png", url: blobUrl, type: "image" }
    ```
35. Display a small tip under the image list: “Tip: Name files clearly (e.g. anime_laugh.png) so they are easy to map in shortcuts.”
36. Never modify or overwrite the original selected files. All work happens on copies or canvas renders.

## 6. Screen Share & Video Playback

37. Add a “Screen Share” button that calls `navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })`.
38. When the stream starts, create an object URL and set it as the source of the preview `<video>` element.
39. Implement standard playback controls in the bottom bar:
    - Play / Pause
    - Seek bar (range input synced to video.currentTime)
    - Current time / duration display
    - Loop toggle
    - Video volume slider
40. The main preview area must be a `<canvas id="preview-canvas">` that draws the video frame + any overlays every animation frame.

## 7. Basic Editing Tools

41. Add a simple trim control: two number inputs or dual-handle slider for in-point and out-point (stored in seconds).
42. During playback and export, only render frames between the trim points.
43. Add three sliders: Brightness, Contrast, Saturation. Apply them via canvas filter or manual pixel manipulation.
44. Add an optional text overlay input (text, font size, color, position). Render it on the canvas.
45. All edits are non-destructive until the user hits export. Store edit state in a plain object that can be reset.

## 8. Background Music

46. Allow the user to upload a local audio file or pick a track from Spotify (search or from playlists).
47. Create a separate `Audio` element or Web Audio API gain node for the music track.
48. Add a dedicated music volume slider in the bottom bar (independent of video volume).
49. When the user hits play, start the music at the same time as the video (respecting trim in-point).
50. On export, mix the music audio with the original video audio using the Web Audio API.

## 9. PNGtuber Overlay System (pnuber.js)

51. Create a draggable and resizable PNGtuber layer that is drawn on the preview canvas every frame.
52. Default position comes from `settings.pnuberPosition`. User can drag it with the mouse; save new position on mouseup.
53. Load all selected image assets into an object keyed by filename (without extension).
54. Implement a state machine:
    ```js
    let currentState = "idle";
    function setPNGtuberState(stateName) { ... }
    ```
55. Support both static images and animated GIFs/APNGs. For GIFs, draw the current frame.
56. Allow the user to define animation loops in a simple JSON structure inside settings (example: “laugh” cycles three frames at 8 fps while key is held).
57. Draw the current PNGtuber image in the corner (or custom position) on every canvas frame, respecting scale.

## 10. Keyboard Shortcuts (shortcuts.js)

58. Listen for `keydown` and `keyup` on the document (when not typing in an input).
59. Map keys to actions defined in `settings.shortcuts`. Example default:
    - `1` → set state “idle”
    - `2` → set state “talk”
    - `3` → set state “laugh”
60. In the Settings modal, provide a UI to:
    - List current mappings
    - Click “Change” then press a new key
    - Assign any loaded image filename to a key
    - Set whether the action is toggle or hold
61. Save shortcut changes immediately to settings.json.
62. Show a small overlay or status text in the right panel that displays the currently active PNGtuber state.

## 11. Recording & Export (recorder.js)

63. Implement a “Record Replay” button that:
    - Creates a `MediaRecorder` from a canvas capture stream (`canvas.captureStream(30)`)
    - Also captures mixed audio (video + music) via Web Audio API
    - Plays the video from the trim in-point to out-point while recording
    - Stops automatically at the out-point
64. When recording finishes, create a blob and show a preview modal with the result.
65. The Save button in the preview modal has a dropdown:
    - “Save Locally” → triggers a normal browser download
    - “Save to Google Drive” → uploads to the `FSTuber/` folder
66. Before any save, show a prompt: “Rename file?” with a text input pre-filled with a suggested name (original name + “_edited” + timestamp).
67. Upload or download only after the user confirms the name.
68. Never overwrite an existing file. If the name already exists, append a number or ask again.
69. After successful Drive upload, show a toast with the full path `FSTuber/filename.mp4`.

## 12. Format Conversion & Export Options

70. Support export as WebM (native MediaRecorder) and MP4 (use a lightweight library only if necessary, or document that WebM is the primary format).
71. Add a format selector in the save dialog.
72. Include the PNGtuber overlay, text overlays, color adjustments, and mixed audio in the final recording.
73. Allow the user to choose resolution (match source or 720p/1080p).

## 13. Polish, Error Handling & Final Details

74. Add loading spinners for all network operations (Drive listing, OAuth, upload).
75. Show clear error toasts for permission denied, network failure, missing client ID, or unsupported format.
76. Make the custom CSS editor validate that the user did not break the layout (optional simple check).
77. Add a keyboard shortcut cheat sheet that can be toggled with `?`.
78. Persist the last used PNGtuber position, volume levels, and theme across sessions.
79. On first launch (no settings file), create the default `settings.json` in Drive if connected, otherwise use localStorage.
80. Add an “About” section in settings that shows the app name FSTuber and studio name.
81. Ensure the UI remains usable at 1280×720 and scales reasonably.
82. Remove any default browser margins, focus outlines that look web-like, and excessive whitespace.
83. Test the full flow: screen share → add music → load PNGtuber images → assign shortcuts → record replay → rename → save to Drive.
84. In the API Setup panel, include direct links and one-sentence instructions for obtaining each client ID/token.
85. If the user is on GitHub Pages, detect the origin and show it in the API Setup instructions so they can copy it into the Google/Spotify consoles.

## 14. Additional Recommended Steps

86. Add a simple undo stack for trim points and color adjustments.
87. Let the user save and load “session presets” (trim + music + PNGtuber mappings) as JSON in the configuration folder.
88. Add a mute button for the original video audio.
89. Support multiple PNGtuber images visible at once (optional later).
90. Add a timeline ruler with clickable markers.
91. Implement basic keyboard shortcuts for play/pause (Space) and seek (arrow keys).
92. Make the right panel collapsible.
93. Add a status bar at the very bottom showing connection states and current file name.
94. Document in a comment at the top of each JS file what the file is responsible for.
95. Ensure all user-facing strings are clear and concise.
96. Add a confirmation dialog before discarding unsaved recording.
97. Support drag-and-drop of video and image files onto the preview area.
98. Remember the last opened Google Drive folder or GitHub repo.
99. Add a “Clear All Assets” button that releases object URLs to free memory.
100. Make the preview canvas maintain the video’s aspect ratio and letterbox if needed.
101. Add a small FPS counter in the corner during recording (optional, toggleable).
102. Allow the user to set a custom background color behind the video if it has transparency.
103. Implement a basic progress bar during Drive upload.
104. After export, offer a “Open in Drive” link if saved to Google Drive.
105. Final visual pass: verify the app looks like a native desktop tool, not a website.
106. Write a short in-app onboarding tip on first launch explaining the PNGtuber naming convention and shortcut system.
107. Add the ability to export the current shortcut mapping as a downloadable JSON file.
108. Support APNG the same way as GIF for animated PNGtuber states.
109. Ensure the app works offline for local-file-only workflows (no forced login).
110. Add a volume mixer view that shows both video and music levels.
111. Let the user set a global hotkey to toggle PNGtuber visibility.
112. Clean up all object URLs and media streams when the user loads a new video.
113. Add basic input validation on the rename prompt (no empty names, no invalid characters).
114. Store the last successful export path in settings for user reference.
115. Make the settings modal remember its scroll position and last opened section.
116. When a login button is clicked and the corresponding Client ID is missing, automatically scroll to and highlight that field in the API Setup section.
```

## Related checklist

See the companion [FSS-PNGT-Overlay checklist](./FSS-PNGT-Overlay.md) for the implementation TODOs.
