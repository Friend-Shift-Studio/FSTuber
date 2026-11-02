# FSTuber — Implementation and Design Plan

## Product and serving

FSTuber is a browser-based video editor and PNGtuber production tool. It is a static GitHub Pages app with no backend, database, server APIs, forced sign-in, or private client secrets. Local media workflows remain available without service connections; optional Google Drive, Spotify, and GitHub integration starts only when a user enters the corresponding public client ID or session-only GitHub token.

The app preserves the requested vanilla structure: `index.html`, `css/styles.css`, and the ordered deferred modules `settings.js`, `auth.js`, `media.js`, `pnuber.js`, `recorder.js`, `shortcuts.js`, `ui.js`, and `app.js`. A single root route is declared in `manus-routes.json`. Assets include the FSTuber mark, a locally bundled Inter Variable font, user PNGtuber files, and the GIF.js encoder/worker. The third-party licenses and sources are recorded in `THIRD-PARTY-NOTICES.md`. No package installation or compile step is needed for local use or Pages deployment. Google Identity Services is loaded as an optional provider helper; FFmpeg.wasm is fetched only when a user requests MP4 conversion.

The user authorized publishing the finished project to the public `Friend-Shift-Studio/FSTuber` repository. A GitHub Actions workflow serves the static root through GitHub Pages. Repository-level Pages configuration may be enabled as part of this request if the account permits it; organization policy will not be altered. The public site URL and workflow success must be confirmed before reporting deployment.

## Implementation approach

- `settings.js` defines validated defaults, merges stored settings, saves public client IDs locally and to Drive settings when connected, applies theme/custom CSS, persists editor state, and manages session and export profiles. It explicitly excludes GitHub PAT fields from persisted settings.
- `auth.js` implements Google Identity Services with the `drive.file` scope and in-memory token, Spotify Authorization Code with PKCE plus token refresh/re-auth guidance, and fine-grained GitHub PAT access held only in `sessionStorage`. It reports connection state and friendly missing-credential or permission errors without blocking local work.
- `media.js` handles local selection and drag/drop, supported-format filtering, video/music/image loading, paginated Drive/GitHub listing and import, bounded thumbnails, repository/branch browsing, screen capture, and URL/stream cleanup. If GitHub's recursive tree endpoint reports truncation, it falls back to bounded directory traversal and reports when that traversal is incomplete.
- `pnuber.js` owns multi-layer PNG/GIF/APNG overlay state, image registration, per-layer position/scale/visibility restoration when the user reloads matching assets, filename-derived and custom states, animated frame loops, active state display, and overlay visibility.
- `shortcuts.js` manages user mappings, hold/toggle behavior, keydown/keyup cleanup, playback and seek keys, the global PNGtuber visibility action, and mapping export.
- `recorder.js` mixes source/music audio with the composed canvas, records screen share or trim-bounded replay through MediaRecorder, shows status/preview, and creates duplicate-safe local/Drive outputs. WebM is the primary format; single-thread FFmpeg.wasm is an optional on-demand MP4 path. Bundled GIF.js creates silent GIFs no longer than 10 seconds and no wider than 480 pixels. Conversion failures preserve the original recording.
- `ui.js` renders the accessible compact editor shell, dialogs, API setup, status and upload progress, source browsers, timeline, inspector, settings, and export controls.
- `app.js` coordinates module lifecycle, preview/canvas composition, editing history and undo, audio/volume state, autosave, project/session presets, export profiles, marker interactions, and connection/file/recording flows.

Editing is non-destructive: the composition is drawn to a canvas and the source media is not rewritten. Export adds a timestamped filename, checks input, preserves extensions that match actual encodings, and paginates Drive duplicate checks so an existing Drive item is never overwritten. Local saving uses a browser download rather than a filesystem handle; the app never writes to a source file, reserves names where browser storage allows, and lets the browser apply its normal duplicate-download suffix/prompt because ordinary web pages cannot inspect the download directory. Drive exports are created beneath a top-level `FSTuber` folder; the single settings document belongs at `FSTuber/configuration/settings.json`. Presets and exports are separate from that settings document. Google/Spotify OAuth origins and redirect URLs are displayed from the running site. Screen capture and OAuth require a supported secure context such as HTTPS or localhost; browser permissions, codecs, memory, Spotify account/device rules, and API policy remain external constraints.

## Project structure

```text
/
├── index.html                           # static editor entry and metadata
├── manus-routes.json                    # the single root page route
├── app.config.ts                        # durable public project logo URL
├── plan.md                              # implementation and design decisions
├── TODO.md                              # grouped acceptance outcomes and evidence
├── README.md                            # run, OAuth, privacy and compatibility guidance
├── THIRD-PARTY-NOTICES.md               # bundled asset provenance and licenses
├── FSS-PNGT-Overlay.md                  # copied source checklist; Obsidian original retained
├── FSS-PNGt-Overlay Manus-Prompt.md     # copied source prompt and checklist cross-link
├── .github/workflows/pages.yml          # static GitHub Pages deployment
├── css/styles.css                       # dark-native shell, light theme, responsive/focus styles
├── js/
│   ├── settings.js                      # defaults, local/Drive persistence, profiles
│   ├── auth.js                          # Google, Spotify PKCE and GitHub auth
│   ├── media.js                         # local, Drive, GitHub and capture media
│   ├── pnuber.js                        # overlays, state selection and animation
│   ├── recorder.js                      # media recording, audio mix and export
│   ├── shortcuts.js                     # shortcuts, hold/toggle and export
│   ├── ui.js                            # shell, dialogs and render helpers
│   └── app.js                           # editor composition, app state and wiring
└── assets/
    ├── fonts/                           # Inter Variable WOFF2 and OFL license
    ├── icons/                           # FSTuber mark used in the app and favicon
    ├── pnuber/                          # optional local default-asset destination
    └── vendor/                          # GIF.js 0.2.0, worker and MIT license
```

## Design system

**Design Movement:** Linear-inspired dark-native precision software, adapted to an editing console rather than a marketing site.

**Core Principles:** Dark canvas with tightly stepped luminance surfaces. High information density and precise alignment. Indigo reserved for focus, selection, and active controls. Keyboard-first, accessible interactions without decorative friction.

**Color Philosophy:** Use the near-black canvas `#08090a`, near-white text `#f7f8f8`, and subtly lifted panels (`#0f1011`, `#141516`, `#191a1b`, `#1c1c1f`). Hairlines use low-opacity white. Signature indigo `#7170ff` marks only active and focus states; status colors remain semantic and sparse. The approved initial theme is dark. The alternate light theme retains the user's specified light palette.

**Layout Paradigm:** A full-window editing workstation uses a 36px title strip, 240px left rail, fluid central canvas, 280px right inspector, and 64px transport timeline, plus a thin bottom status strip. Side panels collapse; small viewports retain reachable panels and transport without turning the editor into a generic marketing grid.

**Signature Elements:** Thin luminance hairlines between functional zones; a restrained indigo playhead and focus ring; compact monospaced timecode and technical values.

**Interaction Philosophy:** Direct timeline and canvas manipulation. Changes preview immediately while the original stays untouched. Recording, discard, and export actions remain explicit and keyboard-accessible. Online services are optional and do not block local work.

**Animation:** Short opacity and surface-color transitions with ease-out timing. Avoid gradients, glow, bounce, scaling, and heavy shadows. Respect `prefers-reduced-motion`; do not animate interface elements unless their state requires it.

**Typography System:** Bundle Inter Variable with weight range 100–900. Use `font-feature-settings: "cv01", "ss03"` and optical sizing. UI uses compact 11–13px labels/body, weight 510 for the main interface and 590 for feature labels; larger display typography is unnecessary in this product. Timecode and code use the `Berkeley Mono`/system monospace stack.

**Brand Essence:** A focused creator workstation for streamers and PNGtubers to compose, record, and export without installing a desktop editor. Personality: precise, calm, capable.

**Brand Voice:** Concise, direct, and specific; explain what remains usable and why a connection is needed. Examples: “Local editing is ready. Connect Drive only when you want cloud files.” “Your source stays untouched; exports are saved as a new file.”

**Wordmark & Logo:** A compact F/S waveform mark formed by two offset rounded frame strokes around a single playhead cut, paired with the tightly tracked FSTuber wordmark. The UI uses the original SVG mark rather than a default-font-only icon.

**Signature Brand Color:** `#7170ff`, a bright restrained indigo for intentional interactive states.
