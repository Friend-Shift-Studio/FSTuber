/* UI module: builds the compact editor shell, settings, dialogs, status and accessible feedback. */
(function (window, document) {
  'use strict';
  const F = window.FSTuber = window.FSTuber || {};
  const icons = {
    gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.7a3.3 3.3 0 1 0 0 6.6 3.3 3.3 0 0 0 0-6.6Z"/><path d="m19.4 13.5 1.1.9-1.1 1.9-1.4-.4a7.8 7.8 0 0 1-1.6.9l-.3 1.5h-2.2l-.4-1.5a7.8 7.8 0 0 1-1.7-.9l-1.3.4-1.1-1.9 1.1-.9a7 7 0 0 1 0-1.9l-1.1-.9 1.1-1.9 1.3.4a7.8 7.8 0 0 1 1.7-.9l.4-1.5h2.2l.3 1.5a7.8 7.8 0 0 1 1.6.9l1.4-.4 1.1 1.9-1.1.9a7 7 0 0 1 0 1.9Z"/></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7V5Z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5h3v14H8zM15 5h3v14h-3z"/></svg>',
    folder: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6.5h7l2 2h9v9H3z"/><path d="M3 8.5h18"/></svg>',
    video: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="13" height="14" rx="2"/><path d="m16 10 5-3v10l-5-3z"/></svg>',
    image: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m4 17 5-5 3 3 3-4 5 6"/></svg>',
    music: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
    screen: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/></svg>',
    record: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7" fill="currentColor" stroke="none"/></svg>',
    stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>',
    help: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.6 2.6 0 1 1 4.7 1.5c-.7.8-2.2 1.2-2.2 2.7M12 17h.01"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    upload: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m-5 5 5-5 5 5M4 16v4h16v-4"/></svg>',
    fit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/></svg>',
    trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3"/></svg>'
  };
  const icon = name => `<span class="icon">${icons[name] || ''}</span>`;
  const actionButton = (label, action, iconName = '', extra = '', title = label) => `<button class="native-button ${extra}" type="button" data-action="${action}" title="${title}" aria-label="${title}">${iconName ? icon(iconName) : ''}<span class="label">${label}</span></button>`;
  let lastFocus = null;
  let lastSection = 'appearance';
  let lastScroll = 0;
  let previewUrl = '';
  let previewUrlManagedByRecorder = false;
  let modalListenersReady = false;

  function renderShell() {
    const root = document.getElementById('app');
    if (!root) return;
    root.innerHTML = `
      <div class="app-shell">
        <header class="titlebar" role="banner">
          <div class="titlebar-left">
            <div class="titlebar-brand"><img src="./assets/icons/fstuber-mark.svg" alt=""><span class="brand-name">FSTuber</span></div>
            <div class="titlebar-status" id="connection-summary"><span class="status-dot" id="summary-dot"></span><span id="summary-label">Local workspace</span></div>
          </div>
          <div class="titlebar-actions">
            ${actionButton('Undo', 'undo', '', 'small', 'Undo edit')}
            ${actionButton('Redo', 'redo', '', 'small', 'Redo edit')}
            ${actionButton('Help', 'help', 'help', 'small', 'Keyboard shortcuts help (?)')}
            ${actionButton('Settings', 'settings', 'gear', 'small', 'Settings')}
            <div class="window-controls" aria-label="Window controls">
              <button class="window-control" type="button" aria-label="Minimize window" title="Minimize">−</button>
              <button class="window-control" type="button" aria-label="Maximize window" title="Maximize">□</button>
              <button class="window-control close" type="button" aria-label="Close window" title="Close">×</button>
            </div>
          </div>
        </header>
        <div class="workspace" id="workspace">
          <aside class="sidebar" id="sidebar" aria-label="Media and connections">
            <div class="panel-heading">
              <h2>Sources &amp; assets</h2>
              <div class="panel-heading-actions"><button class="native-button compact small" data-action="collapse-left" aria-label="Collapse source panel" title="Collapse source panel">‹</button></div>
            </div>
            <div class="panel-scroll">
              <section class="sidebar-section">
                <div class="section-label"><span>Source</span><button class="native-button small" data-action="clear-assets">Clear all</button></div>
                <div class="source-tabs" role="tablist" aria-label="File source">
                  <button class="source-tab active" role="tab" aria-selected="true" data-source-tab="local">Local</button>
                  <button class="source-tab" role="tab" aria-selected="false" data-source-tab="drive">Drive</button>
                  <button class="source-tab" role="tab" aria-selected="false" data-source-tab="github">GitHub</button>
                </div>
                <div class="source-panel active" id="source-local-panel" role="tabpanel">
                  <div class="file-actions">
                    <button class="native-button small" data-action="choose-files">${icon('folder')}<span>Browse files</span></button>
                    <button class="native-button small" data-action="screen-share">${icon('screen')}<span>Screen share</span></button>
                  </div>
                  <p class="field-help">Video: MP4, WebM. Images: PNG, JPG, GIF, APNG, WebP. Audio: MP3, WAV, OGG.</p>
                </div>
                <div class="source-panel" id="source-drive-panel" role="tabpanel">
                  <div class="file-actions"><button class="native-button small" data-action="connect-google">Connect Google Drive</button><button class="native-button small" data-action="refresh-drive" id="drive-refresh-button">Refresh</button></div>
                  <div class="file-list" id="drive-file-list"><div class="empty-hint">Connect Drive to browse FSTuber media.</div></div>
                </div>
                <div class="source-panel" id="source-github-panel" role="tabpanel">
                  <div class="form-stack">
                    <div class="input-row"><input class="native-input" id="github-owner" aria-label="GitHub account or organization" placeholder="Owner"><input class="native-input" id="github-repo" aria-label="GitHub repository" placeholder="Repository"></div>
                    <div class="input-row"><input class="native-input" id="github-branch" aria-label="GitHub branch" placeholder="Branch (default)"><button class="native-button small" data-action="refresh-github" id="github-browse-button">Browse</button></div>
                  </div>
                  <div class="file-list" id="github-file-list"><div class="empty-hint">Connect GitHub to browse media from a repository.</div></div>
                </div>
              </section>
              <section class="sidebar-section">
                <div class="section-label"><span>Connections</span><span class="badge" id="connection-count">Local ready</span></div>
                <div class="connection-list">
                  <div class="connection-row" data-connection="google"><div class="connection-meta"><span class="status-dot" id="google-status-dot"></span><span class="connection-name">Google Drive</span><span class="connection-user" id="google-user"></span></div><button class="native-button small connection-action" data-action="connect-google" id="google-connect-button">Connect</button></div>
                  <div class="connection-row" data-connection="spotify"><div class="connection-meta"><span class="status-dot" id="spotify-status-dot"></span><span class="connection-name">Spotify</span><span class="connection-user" id="spotify-user"></span></div><button class="native-button small connection-action" data-action="connect-spotify" id="spotify-connect-button">Connect</button></div>
                  <div class="connection-row" data-connection="github"><div class="connection-meta"><span class="status-dot" id="github-status-dot"></span><span class="connection-name">GitHub</span><span class="connection-user" id="github-user"></span></div><button class="native-button small connection-action" data-action="connect-github" id="github-connect-button">Connect</button></div>
                </div>
                <p class="field-help" id="service-notice">Google / GitHub / Spotify connection requires a client ID. See Settings → API Setup for instructions. GitHub uses a fine-grained read token instead of a client ID.</p>
              </section>
              <section class="sidebar-section">
                <div class="section-label"><span>Media bin</span><button class="native-button small" data-action="choose-files">Add</button></div>
                <div class="file-list" id="local-file-list"><div class="empty-hint">Drop a video, image, or audio file on the preview, or choose Browse files.</div></div>
              </section>
              <section class="sidebar-section">
                <div class="section-label"><span>PNGtuber assets</span><button class="native-button small" data-action="choose-images">Add images</button></div>
                <div class="asset-list" id="image-assets"><div class="empty-hint">Load PNG, GIF, APNG, or WebP art to create a layer.</div></div>
                <p class="field-help">Tip: Name files clearly (e.g. anime_laugh.png) so they are easy to map in shortcuts.</p>
              </section>
              <section class="sidebar-section">
                <div class="section-label"><span>Background music</span><button class="native-button small" data-action="choose-audio">Choose file</button></div>
                <div class="inline-help" id="music-track-name">No music track selected</div>
                <div class="file-actions"><button class="native-button small" data-action="spotify-library">Browse Spotify library</button></div>
              </section>
            </div>
          </aside>

          <main class="preview-workspace" aria-label="Video preview and timeline">
            <div class="preview-toolbar">
              <div class="preview-toolbar-left"><div class="mobile-panel-switches" aria-label="Editor panels"><button class="native-button small" id="mobile-sources" type="button" data-action="collapse-left" aria-expanded="false">Sources</button><button class="native-button small" id="mobile-properties" type="button" data-action="collapse-right" aria-expanded="false">Properties</button></div><span class="preview-label" id="current-file-label">Untitled project</span><span class="badge" id="media-resolution">No source</span></div>
              <div class="preview-toolbar-right">
                <span class="recording-indicator" id="recording-indicator"><span class="status-dot"></span><span>Recording</span><span id="recording-fps"></span></span>
                <label class="visually-hidden" for="record-resolution">Recording resolution</label><select id="record-resolution" class="native-select record-resolution" aria-label="Recording resolution"><option value="source">Source</option><option value="720p">720p</option><option value="1080p">1080p</option></select>
                <button class="native-button small" data-action="add-marker">Add marker</button>
                <button class="native-button compact small" data-action="fit-preview" aria-label="Fit preview to window" title="Fit preview">${icon('fit')}</button>
              </div>
            </div>
            <div class="preview-frame" id="preview-frame" tabindex="0" aria-label="Video canvas. Drop a video or image here.">
              <canvas id="preview-canvas" width="1280" height="720" aria-label="Composited video preview"></canvas>
              <div class="preview-empty" id="preview-empty"><div class="drop-mark">${icon('upload')}</div><strong>Drop media to begin</strong><span>Load a video, share your screen, or add an image. Your originals stay untouched.</span></div>
              <div class="preview-overlay-label" id="preview-timecode">00:00 / 00:00</div>
            </div>
          </main>

          <aside class="inspector" id="inspector" aria-label="Properties and PNGtuber controls">
            <div class="panel-heading"><h2>Properties</h2><div class="panel-heading-actions"><button class="native-button compact small" data-action="collapse-right" aria-label="Collapse properties panel" title="Collapse properties panel">›</button></div></div>
            <div class="inspector-tools"><button class="native-button small" data-action="add-layer">Add PNGtuber layer</button><button class="native-button small" data-action="toggle-pnuber">Hide overlays</button></div>
            <div class="panel-scroll">
              <section class="inspector-section">
                <div class="section-label"><span>Trim</span><span class="badge" id="trim-range-label">00:00–00:00</span></div>
                <div class="form-row"><label for="trim-start">In point (sec)</label><input id="trim-start" class="native-input" type="number" min="0" step="0.1" value="0" data-control="trim-start"></div>
                <div class="form-row"><label for="trim-end">Out point (sec)</label><input id="trim-end" class="native-input" type="number" min="0" step="0.1" value="0" data-control="trim-end"></div>
                <button class="native-button small" data-action="reset-trim">Reset trim</button>
              </section>
              <section class="inspector-section">
                <div class="section-label"><span>Image adjustments</span><button class="native-button small" data-action="reset-adjustments">Reset</button></div>
                <div class="range-row"><label for="brightness">Brightness</label><input id="brightness" class="range-control" type="range" min="0" max="200" value="100" data-control="brightness"><span class="range-value" id="brightness-value">100%</span></div>
                <div class="range-row"><label for="contrast">Contrast</label><input id="contrast" class="range-control" type="range" min="0" max="200" value="100" data-control="contrast"><span class="range-value" id="contrast-value">100%</span></div>
                <div class="range-row"><label for="saturation">Saturation</label><input id="saturation" class="range-control" type="range" min="0" max="200" value="100" data-control="saturation"><span class="range-value" id="saturation-value">100%</span></div>
                <div class="form-row"><label for="background-color">Canvas background</label><input id="background-color" type="color" value="#0a0a0a" data-control="background-color" aria-label="Canvas background color"></div>
                <div class="form-row"><label for="aspect-ratio">Aspect ratio</label><select id="aspect-ratio" class="native-select" data-control="aspect-ratio"><option value="source">Match source</option><option value="16:9">16:9</option><option value="9:16">9:16</option><option value="4:3">4:3</option><option value="1:1">1:1</option></select></div>
                <div class="form-row"><label for="crop-mode">Frame fit</label><select id="crop-mode" class="native-select" data-control="crop-mode"><option value="contain">Fit with letterbox</option><option value="cover">Fill and crop</option></select></div>
              </section>
              <section class="inspector-section">
                <div class="section-label"><span>Text overlay</span><label class="inline-help"><input type="checkbox" id="text-enabled" data-control="text-enabled"> Enable</label></div>
                <div class="form-stack">
                  <input id="text-overlay" class="native-input" maxlength="180" placeholder="Add a caption" data-control="text-overlay" aria-label="Text overlay">
                  <div class="input-row"><input id="text-size" class="native-input" type="number" min="8" max="160" value="32" aria-label="Text size" data-control="text-size"><input id="text-color" type="color" value="#ffffff" aria-label="Text color" data-control="text-color"><select id="text-position" class="native-select" aria-label="Text position" data-control="text-position"><option value="bottom">Bottom</option><option value="top">Top</option><option value="center">Center</option></select></div>
                </div>
              </section>
              <section class="inspector-section">
                <div class="section-label"><span>PNGtuber layers</span><button class="native-button small" data-action="add-layer">Add</button></div>
                <div class="inline-help">Active state: <strong id="active-pnuber-state">idle</strong></div>
                <div class="layer-list" id="pnuber-layers"><div class="empty-hint">No overlay layer loaded.</div></div>
                <div class="input-row" style="margin-top:6px"><select id="pnuber-state-select" class="native-select" aria-label="PNGtuber state"><option>idle</option><option>talk</option><option>laugh</option></select><button class="native-button small" data-action="set-pnuber-state">Set state</button></div>
                <p class="field-help">Drag an overlay to move it. Use a layer’s corner handle to resize. Keys 1, 2 and 3 switch states.</p>
              </section>
              <section class="inspector-section">
                <div class="section-label"><span>Audio mixer</span><span class="badge">Source + music</span></div>
                <div class="range-row"><label for="video-volume">Video</label><input id="video-volume" class="range-control" type="range" min="0" max="1" step="0.01" value="1" data-control="video-volume"><span class="range-value" id="video-volume-value">100%</span></div>
                <div class="range-row"><label for="music-volume">Music</label><input id="music-volume" class="range-control" type="range" min="0" max="1" step="0.01" value="0.5" data-control="music-volume"><span class="range-value" id="music-volume-value">50%</span></div>
                <div class="audio-meter-row"><span class="audio-meter-label">Video</span><div class="audio-meter-track" id="video-level-meter" role="meter" aria-label="Video source audio level" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span class="audio-meter-fill"></span></div><span class="audio-meter-readout" id="video-level-value">0%</span></div>
                <div class="audio-meter-row"><span class="audio-meter-label">Music</span><div class="audio-meter-track" id="music-level-meter" role="meter" aria-label="Music audio level" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span class="audio-meter-fill"></span></div><span class="audio-meter-readout" id="music-level-value">0%</span></div>
                <div class="input-row"><button class="native-button small" data-action="toggle-video-mute">Mute source</button><button class="native-button small" data-action="toggle-music-mute">Mute music</button></div>
              </section>
              <section class="inspector-section">
                <div class="section-label"><span>Shortcuts</span><button class="native-button small" data-action="settings-shortcuts">Edit</button></div>
                <div class="mapping-list" id="shortcut-summary"></div>
                <button class="native-button small" data-action="export-shortcuts">Export shortcut JSON</button>
              </section>
              <section class="inspector-section">
                <div class="section-label"><span>Timeline markers</span><button class="native-button small" data-action="add-marker">Add</button></div>
                <div class="mapping-list" id="marker-list"><div class="inline-help">No markers added.</div></div>
              </section>
            </div>
          </aside>
        </div>
        <footer class="transport" aria-label="Playback and audio controls">
          <div class="transport-controls">
            <div class="transport-main">
              <button class="native-button compact" data-action="play-pause" id="play-button" aria-label="Play or pause" title="Play or pause (Space)">${icon('play')}</button>
              <button class="native-button compact" data-action="stop" aria-label="Stop" title="Stop">${icon('stop')}</button>
              <button class="native-button compact" data-action="toggle-loop" id="loop-button" aria-label="Toggle loop" aria-pressed="false" title="Loop">↻</button>
            </div>
            <div class="transport-time"><strong id="current-time">00:00.0</strong> / <span id="duration-time">00:00.0</span></div>
            <input id="seek-range" class="range-control seek-range" type="range" min="0" max="1000" value="0" aria-label="Seek position" data-control="seek">
          </div>
          <div class="transport-side">
            <div class="volume-control" title="Video volume">${icon('video')}<input id="transport-video-volume" class="range-control" type="range" min="0" max="1" step="0.01" value="1" aria-label="Video volume" data-control="video-volume"></div>
            <div class="volume-control" title="Music volume">${icon('music')}<input id="transport-music-volume" class="range-control" type="range" min="0" max="1" step="0.01" value="0.5" aria-label="Music volume" data-control="music-volume"></div>
            <button class="native-button small accent" data-action="record-replay" id="record-button">Record replay</button>
          </div>
          <div class="timeline-row">
            <span class="timeline-label">Timeline</span>
            <div class="timeline-ruler" id="timeline-ruler" tabindex="0" role="slider" aria-label="Timeline with markers"><div class="timeline-markers" id="timeline-markers"></div></div>
            <span class="timeline-hints" id="timeline-duration-label">Add media</span>
          </div>
        </footer>
        <div class="statusbar" role="status" aria-live="polite"><div class="statusbar-left"><span class="statusbar-item" id="status-message">Local editing is ready.</span><span class="statusbar-item" id="status-file">No source</span></div><div class="statusbar-right"><span class="statusbar-item" id="status-connections" aria-label="Connection status">Drive off · Spotify off · GitHub off</span><button class="native-button small" id="recording-review-link" data-action="open-recording-preview" hidden>Review recording</button><div class="drive-upload-progress" id="drive-upload-progress" role="progressbar" aria-label="Drive upload progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" hidden><span id="drive-upload-progress-bar"></span></div><span class="statusbar-item" id="status-fps"></span><span class="statusbar-item">FSTuber</span></div></div>
      </div>

      <input id="local-files" class="visually-hidden" type="file" accept="image/*,video/*,audio/*" multiple>
      <input id="local-video" class="visually-hidden" type="file" accept="video/mp4,video/webm">
      <input id="local-images" class="visually-hidden" type="file" accept="image/png,image/jpeg,image/gif,image/apng,image/webp" multiple>
      <input id="local-audio" class="visually-hidden" type="file" accept="audio/mpeg,audio/wav,audio/ogg,audio/mp3">

      <div class="toast-region" id="toast-region" aria-live="polite" aria-atomic="false"></div>

      <div class="modal-backdrop" id="settings-modal" aria-hidden="true">
        <section class="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
          <header class="modal-head"><h2 id="settings-title">Settings</h2><button class="native-button compact small" data-modal-close="settings-modal" aria-label="Close settings">${icon('close')}</button></header>
          <div class="settings-layout">
            <nav class="settings-nav" aria-label="Settings sections">
              <button class="native-button active" data-settings-section="appearance">Appearance</button>
              <button class="native-button" data-settings-section="api-setup">API Setup</button>
              <button class="native-button" data-settings-section="shortcuts">Shortcuts</button>
              <button class="native-button" data-settings-section="audio">Audio defaults</button>
              <button class="native-button" data-settings-section="about">About</button>
            </nav>
            <div class="settings-content" id="settings-content">
              <section class="settings-section active" id="settings-section-appearance" data-section="appearance">
                <h3>Appearance</h3><p>Set a quiet editing surface. The Linear-inspired dark workspace is the default; light mode remains available.</p>
                <div class="settings-field"><label for="theme-select">Theme</label><select id="theme-select" class="native-select"><option value="dark">Dark</option><option value="light">Light</option></select></div>
                <div class="settings-field"><label for="custom-css-input">Custom CSS</label><textarea id="custom-css-input" class="native-textarea" spellcheck="false" placeholder="/* Optional custom styles */"></textarea><div class="field-help">Custom rules are applied locally in this browser. Use “Apply” to save.</div><div class="input-row" style="margin-top:5px"><button class="native-button small primary" data-action="apply-css">Apply</button><span id="custom-css-message" class="inline-help"></span></div></div>
                <div class="settings-field"><label>Session presets</label><div class="input-row"><select id="preset-select" class="native-select" aria-label="Select session preset"><option value="">Choose preset</option></select><button class="native-button small" data-action="save-preset">Save</button><button class="native-button small" data-action="load-preset">Load</button><button class="native-button small" data-action="export-preset">Export</button><button class="native-button small" data-action="import-preset">Import</button></div></div>
              </section>
              <section class="settings-section" id="settings-section-api-setup" data-section="api-setup">
                <h3>API Setup</h3><p>Connections are optional. Local editing works without sign-in. Only enter public client IDs; never enter a client secret.</p>
                <div class="settings-field" id="field-google-client-id"><label for="google-client-id">Google Client ID</label><input class="native-input" id="google-client-id" type="text" autocomplete="off" spellcheck="false" placeholder="1234567890-abc.apps.googleusercontent.com"><div class="field-help">Create an OAuth 2.0 Web application client at <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">Google Cloud Console</a>. Enable Drive API and the <code>https://www.googleapis.com/auth/drive.file</code> scope. Add the origin below to Authorized JavaScript origins and the page URL below to Authorized redirect URIs. This FSTuber version uses a Google Identity Services popup token flow, so it does not send a redirect callback; no client secret is needed.</div><div class="field-help">This scope only exposes files made accessible to FSTuber. If a folder you created outside the app is not visible, FSTuber may create its own app-accessible <code>FSTuber</code> folder.</div></div>
                <div class="settings-field" id="field-spotify-client-id"><label for="spotify-client-id">Spotify Client ID</label><input class="native-input" id="spotify-client-id" type="text" autocomplete="off" spellcheck="false" placeholder="Your Spotify Client ID"><div class="field-help">Create an app in the <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer">Spotify Developer Dashboard</a>, add the redirect URL below, and use Authorization Code with PKCE. No client secret is used.</div></div>
                <div class="settings-field" id="field-github-token"><label for="github-token">GitHub Personal Access Token</label><input class="native-input" id="github-token" type="password" autocomplete="new-password" spellcheck="false" placeholder="Fine-grained token; session only"><div class="field-help">Create a <a href="https://github.com/settings/tokens?type=beta" target="_blank" rel="noreferrer">fine-grained token</a> with Contents: read-only for the repositories you browse. This token is stored only in your browser session. Do not share it.</div></div>
                <div class="warning-note"><strong>Current origin:</strong> <code id="current-origin">—</code><br><strong>Page URL:</strong> <code id="current-redirect">—</code><br>Register the origin with Google as an Authorized JavaScript origin. Add the page URL as Google's Authorized redirect URI and as Spotify's exact redirect URI.</div>
                <div class="inline-error" id="api-setup-error" role="alert"></div>
                <div class="input-row" style="margin-top:9px"><button class="native-button small primary" data-action="save-api-setup">Save client IDs</button><button class="native-button small" data-action="connect-google">Connect Google</button><button class="native-button small" data-action="connect-spotify">Connect Spotify</button><button class="native-button small" data-action="connect-github">Connect GitHub</button></div>
              </section>
              <section class="settings-section" id="settings-section-shortcuts" data-section="shortcuts">
                <h3>Keyboard shortcuts</h3><p>Choose a key, assign an image/state, then select hold or toggle. Press the new key after choosing Change.</p>
                <div id="shortcut-settings-list" class="mapping-list"></div>
                <div class="input-row" style="margin-top:8px"><button class="native-button small" data-action="add-shortcut">Add mapping</button><button class="native-button small" data-action="export-shortcuts">Download mapping JSON</button><span class="inline-help">Press ? for the shortcut sheet.</span></div>
                <div class="settings-field"><label for="animation-loops-json">Custom animation loops</label><textarea id="animation-loops-json" class="native-input code-input" rows="6" spellcheck="false" aria-describedby="animation-loops-help"></textarea><p class="field-help" id="animation-loops-help">Define frames using loaded image names, for example {&quot;laugh&quot;:{&quot;frames&quot;:[&quot;laugh-1&quot;,&quot;laugh-2&quot;],&quot;fps&quot;:8,&quot;repeat&quot;:true}}. Loops run while their state is active.</p><div class="input-row"><button class="native-button small" data-action="save-animation-loops">Save animation loops</button><span class="inline-help" id="animation-loop-message" role="status"></span></div></div>
              </section>
              <section class="settings-section" id="settings-section-audio" data-section="audio">
                <h3>Audio defaults</h3><p>These values apply when a new project starts. Source and music levels remain independent.</p>
                <div class="range-row"><label for="default-video-volume">Video</label><input id="default-video-volume" class="range-control" type="range" min="0" max="1" step="0.01" value="1"><span class="range-value" id="default-video-value">100%</span></div>
                <div class="range-row"><label for="default-music-volume">Music</label><input id="default-music-volume" class="range-control" type="range" min="0" max="1" step="0.01" value="0.5"><span class="range-value" id="default-music-value">50%</span></div>
                <label class="inline-help"><input id="show-recording-fps" type="checkbox"> Show recording FPS while capturing</label>
                <div class="settings-field"><label>Background color</label><div class="input-row"><input id="settings-background-color" type="color" value="#0a0a0a"><span class="field-help">Used behind letterboxed or transparent video frames.</span></div></div>
              </section>
              <section class="settings-section" id="settings-section-about" data-section="about">
                <h3>About FSTuber</h3><p>A focused creator workstation for streamers and PNGtubers to compose, record, and export without installing a desktop editor.</p>
                <dl class="about-grid"><dt>App</dt><dd>FSTuber</dd><dt>Studio</dt><dd>FSS / FS Studio / FriendShifts Studio</dd><dt>Primary export</dt><dd>WebM using browser MediaRecorder</dd><dt>Privacy</dt><dd>Local files remain in this browser; exports are new files.</dd><dt>Libraries</dt><dd>Vanilla HTML/CSS/JavaScript, Google Identity Services; optional media conversion loads only on request.</dd></dl>
                <p class="field-help">Browser codec and account capabilities vary. FSTuber reports unavailable functions instead of changing file extensions or overwriting originals.</p>
              </section>
            </div>
          </div>
          <footer class="modal-foot"><button class="native-button danger small" data-action="reset-settings">Reset to defaults</button><div class="modal-foot-actions"><button class="native-button small" data-modal-close="settings-modal">Close</button></div></footer>
        </section>
      </div>

      <div class="modal-backdrop" id="result-modal" aria-hidden="true">
        <section class="modal wide" role="dialog" aria-modal="true" aria-labelledby="result-title">
          <header class="modal-head"><h2 id="result-title">Recording preview</h2><button class="native-button compact small" data-modal-close="result-modal" aria-label="Close recording preview">${icon('close')}</button></header>
          <div class="modal-body"><video class="dialog-video" id="result-video" controls playsinline></video><div class="record-meta"><span id="result-duration">Duration —</span><span id="result-size">Size —</span><span id="result-format">Format —</span></div><div class="warning-note">Your original media is unchanged. Choose a destination, then confirm a new filename before saving.</div></div>
          <footer class="modal-foot"><button class="native-button danger small" data-action="discard-recording">Discard recording</button><div class="modal-foot-actions"><button class="native-button small" data-action="save-recording-local">Save locally</button><button class="native-button small primary" data-action="save-recording-drive">Save to Google Drive</button></div></footer>
        </section>
      </div>

      <div class="modal-backdrop" id="rename-modal" aria-hidden="true">
        <section class="modal small" role="dialog" aria-modal="true" aria-labelledby="rename-title">
          <header class="modal-head"><h2 id="rename-title">Rename file?</h2><button class="native-button compact small" data-modal-close="rename-modal" aria-label="Cancel save">${icon('close')}</button></header>
          <div class="modal-body">
            <div class="settings-field"><label for="export-name">New filename</label><input id="export-name" class="native-input" type="text" autocomplete="off" maxlength="120"><div class="field-help">A new name is required. Drive duplicates get a suffix; local collisions follow your browser's download rules.</div></div>
            <div class="export-options"><div class="settings-field"><label for="export-format">Format</label><select id="export-format" class="native-select"><option value="webm">WebM (recommended)</option><option value="mp4">MP4 (if browser conversion is available)</option><option value="gif">GIF (short clips, if supported)</option></select></div><div class="settings-field"><label for="export-resolution">Resolution</label><select id="export-resolution" class="native-select"><option value="source">Match source</option><option value="720p">720p</option><option value="1080p">1080p</option></select></div></div>
            <div class="settings-field"><label for="export-profile-select">Export profile</label><select id="export-profile-select" class="native-select"><option value="">Current choices</option></select><div class="input-row" style="margin-top:5px"><input id="export-profile-name" class="native-input" type="text" maxlength="48" placeholder="Save current choices as a profile"><button class="native-button small" data-action="save-export-profile">Save profile</button></div><div id="export-resolution-help" class="field-help">Choose a profile or create one from the current format and resolution.</div></div>
            <div class="inline-error" id="rename-error" role="alert"></div>
          </div>
          <footer class="modal-foot"><span class="inline-help" id="rename-destination">Save destination</span><div class="modal-foot-actions"><button class="native-button small" data-modal-close="rename-modal">Cancel</button><button class="native-button small primary" data-action="confirm-save">Confirm save</button></div></footer>
        </section>
      </div>

      <div class="modal-backdrop" id="help-modal" aria-hidden="true">
        <section class="modal small" role="dialog" aria-modal="true" aria-labelledby="help-title">
          <header class="modal-head"><h2 id="help-title">Keyboard shortcuts</h2><button class="native-button compact small" data-modal-close="help-modal" aria-label="Close shortcut help">${icon('close')}</button></header>
          <div class="modal-body"><div class="mapping-list" id="help-shortcuts"></div><p class="field-help">Mappings are editable in Settings → Shortcuts. Shortcut input is ignored while typing in text fields.</p></div>
          <footer class="modal-foot"><span class="inline-help">FSTuber</span><div class="modal-foot-actions"><button class="native-button small" data-modal-close="help-modal">Close</button></div></footer>
        </section>
      </div>

      <div class="modal-backdrop" id="confirm-modal" aria-hidden="true">
        <section class="modal small" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
          <header class="modal-head"><h2 id="confirm-title">Confirm action</h2><button class="native-button compact small" data-modal-close="confirm-modal" aria-label="Cancel">${icon('close')}</button></header>
          <div class="modal-body"><p id="confirm-message" class="settings-section active"></p></div>
          <footer class="modal-foot"><span></span><div class="modal-foot-actions"><button class="native-button small" data-modal-close="confirm-modal">Cancel</button><button class="native-button small danger" id="confirm-yes">Confirm</button></div></footer>
        </section>
      </div>

      <div class="modal-backdrop" id="onboarding-modal" aria-hidden="true">
        <section class="modal small" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
          <header class="modal-head"><h2 id="onboarding-title">A quick note before you begin</h2><button class="native-button compact small" data-modal-close="onboarding-modal" aria-label="Close introduction">${icon('close')}</button></header>
          <div class="modal-body"><p class="settings-section active">Name PNGtuber art by its state, such as <code>idle.png</code>, <code>talk.png</code>, or <code>laugh.png</code>. Keys 1, 2, and 3 switch those states; you can change the mapping and choose hold or toggle in Settings → Shortcuts.</p><p class="settings-section active">Local editing works without sign-in. Connect Drive only when you want to browse or save files there.</p></div>
          <footer class="modal-foot"><span class="inline-help">Your originals stay untouched.</span><div class="modal-foot-actions"><button class="native-button small primary" data-action="dismiss-onboarding">Understood</button></div></footer>
        </section>
      </div>
    `;
    bindShellEvents();
    setOriginText();
    setStatus('Local editing is ready.');
    if (!modalListenersReady) {
      document.addEventListener('keydown', onModalKeyDown);
      modalListenersReady = true;
    }
  }

  function bindShellEvents() {
    document.addEventListener('click', handleClick);
    document.addEventListener('input', handleInput);
    document.addEventListener('change', handleChange);
    document.addEventListener('dragover', handleGlobalDragOver);
    document.addEventListener('drop', handleGlobalDrop);
  }
  function fire(name, detail) { window.dispatchEvent(new CustomEvent(name, { detail })); }
  function handleClick(event) {
    const nav = event.target.closest('[data-settings-section]');
    if (nav) { event.preventDefault(); switchSettingsSection(nav.dataset.settingsSection); return; }
    const source = event.target.closest('[data-source-tab]');
    if (source) { switchSource(source.dataset.sourceTab); return; }
    const closer = event.target.closest('[data-modal-close]');
    if (closer) { closeModal(closer.dataset.modalClose); return; }
    const action = event.target.closest('[data-action]');
    if (action) {
      const name = action.dataset.action;
      if (name === 'settings') { openSettings('appearance'); return; }
      if (name === 'settings-shortcuts') { openSettings('shortcuts'); return; }
      if (name === 'help') { openHelp(); return; }
      if (name === 'choose-files') { document.getElementById('local-files').click(); return; }
      if (name === 'choose-images') { document.getElementById('local-images').click(); return; }
      if (name === 'choose-audio') { document.getElementById('local-audio').click(); return; }
      if (name === 'save-recording-local' || name === 'save-recording-drive') { requestRename(name.endsWith('drive') ? 'drive' : 'local'); return; }
      if (name === 'confirm-save') { confirmRename(); return; }
      if (name === 'discard-recording') { fire('fstuber:action', { action: name }); return; }
      if (name === 'dismiss-onboarding') { closeModal('onboarding-modal'); fire('fstuber:action', { action: name }); return; }
      fire('fstuber:action', { action: name, element: action, value: action.dataset.value || '', id: action.dataset.id || '' });
      return;
    }
    const fileRow = event.target.closest('[data-file-index]');
    if (fileRow) fire('fstuber:file-select', { source: fileRow.dataset.source || 'local', index: Number(fileRow.dataset.fileIndex) });
    const layerAction = event.target.closest('[data-layer-action]');
    if (layerAction) fire('fstuber:layer-action', { action: layerAction.dataset.layerAction, id: layerAction.dataset.layerId || '' });
    const marker = event.target.closest('[data-marker-id]');
    if (marker) fire('fstuber:marker-action', { id: marker.dataset.markerId, action: marker.dataset.markerAction || 'seek' });
  }
  function handleInput(event) {
    const target = event.target;
    if (target.matches('[data-control]')) fire('fstuber:control', { control: target.dataset.control, value: target.type === 'checkbox' ? target.checked : target.value, target });
  }
  function handleChange(event) {
    const target = event.target;
    if (target.matches('input[type="file"]')) {
      const kind = target.id === 'local-images' ? 'images' : target.id === 'local-audio' ? 'audio' : 'all';
      fire('fstuber:files', { kind, files: Array.from(target.files || []) });
      target.value = '';
      return;
    }
    if (target.matches('[data-control]')) fire('fstuber:control', { control: target.dataset.control, value: target.type === 'checkbox' ? target.checked : target.value, target });
    if (target.id === 'theme-select') fire('fstuber:action', { action: 'set-theme', value: target.value });
    if (target.id === 'google-client-id' || target.id === 'spotify-client-id') fire('fstuber:action', { action: 'client-id-change', id: target.id, value: target.value.trim() });
    if (target.id === 'github-token') fire('fstuber:action', { action: 'github-token-change', value: target.value });
    if (target.id === 'export-format' || target.id === 'export-resolution') {
      if (target.id === 'export-format') updateExportOptions();
      const profile = document.getElementById('export-profile-select'); if (profile) profile.value = '';
    }
    if (target.id === 'export-profile-select') fire('fstuber:action', { action: 'export-profile-change', value: target.value });
    if (target.id === 'default-video-volume' || target.id === 'default-music-volume') fire('fstuber:action', { action: 'default-volume', id: target.id, value: Number(target.value) });
  }
  function handleGlobalDragOver(event) {
    const frame = document.getElementById('preview-frame');
    if (frame && (event.target === frame || frame.contains(event.target))) { event.preventDefault(); frame.classList.add('drag-over'); }
  }
  function handleGlobalDrop(event) {
    const frame = document.getElementById('preview-frame');
    if (frame && (event.target === frame || frame.contains(event.target))) {
      event.preventDefault(); frame.classList.remove('drag-over');
      fire('fstuber:files', { kind: 'all', files: Array.from(event.dataTransfer?.files || []) });
    }
  }
  function onModalKeyDown(event) {
    if (event.key === 'Escape') {
      const active = document.querySelector('.modal-backdrop.open');
      if (active && active.id !== 'confirm-modal') closeModal(active.id);
    }
    const active = document.querySelector('.modal-backdrop.open');
    if (active && event.key === 'Tab') {
      const focusable = active.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]');
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }
  function switchSettingsSection(section) {
    const key = ['appearance', 'api-setup', 'shortcuts', 'audio', 'about'].includes(section) ? section : 'appearance';
    const content = document.getElementById('settings-content');
    if (content) lastScroll = content.scrollTop;
    lastSection = key;
    document.querySelectorAll('[data-settings-section]').forEach(button => button.classList.toggle('active', button.dataset.settingsSection === key));
    document.querySelectorAll('.settings-section[data-section]').forEach(panel => panel.classList.toggle('active', panel.dataset.section === key));
    if (content) content.scrollTop = lastScroll;
  }
  function switchSource(source) {
    document.querySelectorAll('[data-source-tab]').forEach(button => {
      const active = button.dataset.sourceTab === source;
      button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('.source-panel').forEach(panel => panel.classList.toggle('active', panel.id === `source-${source}-panel`));
    fire('fstuber:source', { source });
  }
  function openModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    lastFocus = document.activeElement;
    modal.classList.add('open'); modal.setAttribute('aria-hidden', 'false');
    const first = modal.querySelector('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])');
    if (first) setTimeout(() => first.focus(), 0);
  }
  function closeModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.remove('open'); modal.setAttribute('aria-hidden', 'true');
    if (id === 'settings-modal') {
      const content = document.getElementById('settings-content');
      if (content) lastScroll = content.scrollTop;
      try { localStorage.setItem('fstuber-settings-section', lastSection); localStorage.setItem('fstuber-settings-scroll', String(lastScroll)); } catch (_) {}
    }
    if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
  }
  function openSettings(section = 'appearance', field = '') {
    let savedSection = section;
    if (!field && section === 'appearance') {
      try { savedSection = localStorage.getItem('fstuber-settings-section') || section; lastScroll = Number(localStorage.getItem('fstuber-settings-scroll') || 0); } catch (_) {}
    }
    switchSettingsSection(savedSection);
    openModal('settings-modal');
    if (field) {
      switchSettingsSection('api-setup');
      const byId = { google: 'google-client-id', spotify: 'spotify-client-id', github: 'github-token' };
      const input = document.getElementById(byId[field] || field);
      if (input) {
        const parent = input.closest('.settings-field');
        if (parent) { parent.classList.add('field-invalid'); setTimeout(() => parent.classList.remove('field-invalid'), 4500); }
        setTimeout(() => { input.focus(); input.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 50);
      }
    }
    return true;
  }
  function openHelp() {
    renderHelpShortcuts(); openModal('help-modal');
  }
  function confirm(message, callback, title = 'Confirm action') {
    const heading = document.getElementById('confirm-title');
    const content = document.getElementById('confirm-message');
    if (heading) heading.textContent = title;
    if (content) content.textContent = message;
    const yes = document.getElementById('confirm-yes');
    if (yes) {
      yes.onclick = () => { closeModal('confirm-modal'); if (callback) callback(); };
    }
    openModal('confirm-modal');
  }
  function updateExportOptions() {
    const format = document.getElementById('export-format')?.value || 'webm';
    const resolution = document.getElementById('export-resolution');
    const help = document.getElementById('export-resolution-help');
    if (resolution) resolution.disabled = format === 'gif';
    if (help) {
      help.textContent = format === 'gif'
        ? 'GIF is silent and limited to 10 seconds, 8 fps, and 480 pixels wide. Trim shorter first.'
        : format === 'mp4'
          ? 'MP4 may need optional single-thread conversion; browser memory and codec limits apply.'
          : 'Choose a profile or create one from the current format and resolution.';
    }
  }
  function requestRename(destination) {
    const nameInput = document.getElementById('export-name');
    const source = document.getElementById('current-file-label')?.textContent || 'recording';
    const base = source.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '').trim() || 'recording';
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    if (nameInput) nameInput.value = `${base}_edited_${stamp}`;
    document.getElementById('rename-destination').textContent = destination === 'drive' ? 'Save to FSTuber/ in Google Drive' : 'Download a new local file';
    document.getElementById('rename-error').textContent = '';
    const formatSelect = document.getElementById('export-format');
    const recordedType = F.recorder?.getLastBlob?.()?.type || '';
    const preferredFormat = recordedType.toLowerCase().includes('mp4') ? 'mp4' : 'webm';
    if (formatSelect) {
      const preferredOption = Array.from(formatSelect.options).find(option => option.value === preferredFormat && !option.disabled);
      const firstAvailable = Array.from(formatSelect.options).find(option => !option.disabled);
      formatSelect.value = (preferredOption || firstAvailable || {}).value || 'webm';
    }
    document.getElementById('export-resolution').value = F.app?.getRecordResolution?.() || 'source';
    const profile = document.getElementById('export-profile-select'); if (profile) profile.value = '';
    const profileName = document.getElementById('export-profile-name'); if (profileName) profileName.value = '';
    updateExportOptions();
    document.getElementById('rename-modal').dataset.destination = destination;
    openModal('rename-modal');
  }
  function confirmRename() {
    const name = document.getElementById('export-name')?.value.trim() || '';
    const safe = name.replace(/\.[^.]+$/, '');
    const error = document.getElementById('rename-error');
    if (!safe) { if (error) error.textContent = 'Enter a filename before saving.'; return; }
    if (/[\\/:*?"<>|\u0000-\u001f]/.test(safe)) { if (error) error.textContent = 'Use a filename without slashes, reserved characters, or control characters.'; return; }
    const destination = document.getElementById('rename-modal').dataset.destination || 'local';
    const options = { name: safe, format: document.getElementById('export-format').value, resolution: document.getElementById('export-resolution').value };
    closeModal('rename-modal');
    fire('fstuber:saveconfirmed', { destination, ...options });
  }
  function setOriginText() {
    const origin = !window.location.origin || window.location.origin === 'null' ? 'file:// local preview' : window.location.origin;
    const originNode = document.getElementById('current-origin');
    const redirectNode = document.getElementById('current-redirect');
    if (originNode) originNode.textContent = origin;
    if (redirectNode) redirectNode.textContent = `${origin}${window.location.pathname || '/'}`;
  }
  function toast(message, type = 'info', timeout = 4200) {
    const region = document.getElementById('toast-region');
    if (!region) return;
    const item = document.createElement('div'); item.className = `toast ${type}`; item.setAttribute('role', type === 'error' ? 'alert' : 'status'); item.textContent = String(message || '');
    region.appendChild(item); setTimeout(() => item.remove(), timeout);
  }
  function setStatus(message, type = 'info') {
    const node = document.getElementById('status-message');
    if (node) node.textContent = message;
    const dot = document.getElementById('summary-dot');
    if (dot) { dot.classList.remove('is-online', 'is-busy', 'is-error'); if (type === 'success') dot.classList.add('is-online'); if (type === 'busy') dot.classList.add('is-busy'); if (type === 'error') dot.classList.add('is-error'); }
  }
  function setConnectionStatus(service, status, username = '') {
    const id = String(service || '').toLowerCase();
    const dot = document.getElementById(`${id}-status-dot`);
    const user = document.getElementById(`${id}-user`);
    const button = document.getElementById(`${id}-connect-button`);
    const connected = typeof status === 'boolean' ? status : Boolean(status && (status.connected || status.accessToken || status.token));
    const candidate = typeof status === 'boolean' ? username : status && (status.username || status.name || status.login || status.email || status.user) || '';
    const displayName = typeof candidate === 'string' ? candidate : candidate && (candidate.displayName || candidate.username || candidate.login || candidate.name || candidate.email) || '';
    if (dot) { dot.classList.toggle('is-online', connected); dot.classList.toggle('is-error', !connected); }
    if (user) user.textContent = connected ? (displayName || 'Connected') : '';
    if (button) { button.textContent = connected ? 'Disconnect' : 'Connect'; button.dataset.action = connected ? `disconnect-${id}` : `connect-${id}`; }
    const nodes = document.querySelectorAll(`[data-connection="${id}"]`);
    nodes.forEach(node => node.dataset.connected = String(connected));
  }
  function renderConnections(statuses = {}) {
    ['google', 'spotify', 'github'].forEach(service => setConnectionStatus(service, statuses[service] || {}));
    const notice = document.getElementById('service-notice');
    const configured = Boolean(statuses.googleConfigured && statuses.spotifyConfigured && statuses.githubConfigured);
    if (notice) notice.textContent = statuses.missingNotice || (configured
      ? 'Connections are optional. Local editing works without sign-in.'
      : 'Google / GitHub / Spotify connection requires a client ID. See Settings → API Setup for instructions. GitHub uses a fine-grained read token instead of a client ID.');
    const count = ['google', 'spotify', 'github'].filter(service => statuses[service]?.connected).length;
    const countNode = document.getElementById('connection-count');
    if (countNode) countNode.textContent = count ? `${count} connected` : 'Local ready';
  }
  function renderFileList(targetId, files = [], source = 'local') {
    const root = document.getElementById(targetId);
    if (!root) return;
    root.replaceChildren();
    if (!files.length) {
      const empty = document.createElement('div'); empty.className = 'empty-hint'; empty.textContent = source === 'local' ? 'Drop a video, image, or audio file on the preview, or choose Browse files.' : 'No supported media found.'; root.appendChild(empty); return;
    }
    files.forEach((file, index) => {
      const row = document.createElement('button'); row.className = 'file-row'; row.type = 'button'; row.dataset.fileIndex = String(index); row.dataset.source = source; row.title = file.name || 'Media file';
      if (file.thumbnail || file.thumbnailLink || file.url && /\.(png|jpe?g|gif|apng|webp)(\?|$)/i.test(file.name || '')) {
        const image = document.createElement('img'); image.className = 'file-thumb'; image.alt = ''; image.src = file.thumbnail || file.thumbnailLink || file.url; row.appendChild(image);
      } else {
        const thumb = document.createElement('span'); thumb.className = 'file-icon'; const ext = (file.name || '').split('.').pop().slice(0, 4).toUpperCase(); thumb.textContent = ext || 'FILE'; row.appendChild(thumb);
      }
      const name = document.createElement('span'); name.className = 'file-row-name'; name.textContent = file.name || 'Untitled'; row.appendChild(name);
      const meta = document.createElement('span'); meta.className = 'file-row-meta'; meta.textContent = file.kind || ''; row.appendChild(meta);
      root.appendChild(row);
    });
  }
  function renderAssets(assets = []) {
    const root = document.getElementById('image-assets'); if (!root) return;
    root.replaceChildren();
    if (!assets.length) { const empty = document.createElement('div'); empty.className = 'empty-hint'; empty.textContent = 'Load PNG, GIF, APNG, or WebP art to create a layer.'; root.appendChild(empty); return; }
    assets.forEach((asset, index) => {
      const row = document.createElement('button'); row.className = 'asset-row'; row.type = 'button'; row.dataset.assetIndex = String(index); row.title = `Add ${asset.name || 'image'} to the preview`;
      if (asset.url) { const img = document.createElement('img'); img.className = 'file-thumb'; img.src = asset.url; img.alt = ''; row.appendChild(img); }
      const name = document.createElement('span'); name.className = 'asset-name'; name.textContent = asset.name || 'Image'; row.appendChild(name);
      const add = document.createElement('span'); add.className = 'row-meta'; add.textContent = 'Add'; row.appendChild(add);
      row.addEventListener('click', () => fire('fstuber:asset-add', { index, asset }));
      root.appendChild(row);
    });
  }
  function renderLayers(layers = []) {
    const root = document.getElementById('pnuber-layers'); if (!root) return;
    root.replaceChildren();
    if (!layers.length) { const empty = document.createElement('div'); empty.className = 'empty-hint'; empty.textContent = 'No overlay layer loaded.'; root.appendChild(empty); return; }
    layers.forEach(layer => {
      const row = document.createElement('div'); row.className = 'layer-row'; row.dataset.layerId = layer.id;
      const visible = document.createElement('input'); visible.type = 'checkbox'; visible.className = 'layer-toggle'; visible.checked = layer.userVisible !== false; visible.setAttribute('aria-label', `Show ${layer.name}`); visible.addEventListener('change', () => fire('fstuber:layer-action', { action: 'visibility', id: layer.id, value: visible.checked })); row.appendChild(visible);
      const name = document.createElement('span'); name.className = 'layer-name'; name.textContent = layer.name || 'Layer'; row.appendChild(name);
      const actions = document.createElement('span'); actions.className = 'layer-actions';
      const hide = document.createElement('button'); hide.type = 'button'; hide.className = 'native-button compact small'; hide.textContent = '×'; hide.title = 'Remove layer'; hide.setAttribute('aria-label', 'Remove layer'); hide.dataset.layerAction = 'remove'; hide.dataset.layerId = layer.id; actions.appendChild(hide);
      row.appendChild(actions); root.appendChild(row);
    });
  }
  function renderMappings(mappings = []) {
    const roots = [document.getElementById('shortcut-summary'), document.getElementById('shortcut-settings-list'), document.getElementById('help-shortcuts')].filter(Boolean);
    roots.forEach(root => {
      root.replaceChildren();
      if (!mappings.length) { const note = document.createElement('div'); note.className = 'inline-help'; note.textContent = 'No custom mappings. Keys 1, 2, and 3 use idle, talk, and laugh.'; root.appendChild(note); return; }
      mappings.forEach(item => {
        const row = document.createElement('div'); row.className = root.id === 'shortcut-settings-list' ? 'shortcut-setting' : 'mapping-row';
        const key = document.createElement('kbd'); key.className = root.id === 'shortcut-settings-list' ? 'shortcut-key' : 'mapping-key'; key.textContent = item.key; row.appendChild(key);
        const label = document.createElement('span'); label.className = 'file-row-name'; label.textContent = item.label || item.state || item.image || 'Action'; row.appendChild(label);
        const mode = document.createElement('span'); mode.className = 'badge'; mode.textContent = item.mode || 'toggle'; row.appendChild(mode);
        if (root.id === 'shortcut-settings-list') {
          const change = document.createElement('button'); change.type = 'button'; change.className = 'native-button small'; change.textContent = 'Change'; change.dataset.action = 'change-shortcut'; change.dataset.key = item.key; row.appendChild(change);
        }
        root.appendChild(row);
      });
    });
  }
  function renderMarkers(markers = [], duration = 0) {
    const ruler = document.getElementById('timeline-markers'); const list = document.getElementById('marker-list');
    if (ruler) ruler.replaceChildren();
    if (list) list.replaceChildren();
    if (!markers.length && list) { const note = document.createElement('div'); note.className = 'inline-help'; note.textContent = 'No markers added.'; list.appendChild(note); }
    markers.forEach((marker, index) => {
      const percentage = duration > 0 ? Math.max(0, Math.min(100, marker.time / duration * 100)) : 0;
      if (ruler) { const button = document.createElement('button'); button.type = 'button'; button.className = 'timeline-marker'; button.style.left = `${percentage}%`; button.dataset.markerId = marker.id; button.title = `${marker.label || `Marker ${index + 1}`} at ${formatTime(marker.time)}`; button.setAttribute('aria-label', button.title); ruler.appendChild(button); }
      if (list) { const row = document.createElement('div'); row.className = 'mapping-row'; row.innerHTML = `<button class="native-button small" data-marker-id="${escapeAttribute(marker.id)}" data-marker-action="seek">${escapeHTML(formatTime(marker.time))}</button><span class="file-row-name">${escapeHTML(marker.label || `Marker ${index + 1}`)}</span><button class="native-button small" data-marker-id="${escapeAttribute(marker.id)}" data-marker-action="edit" aria-label="Edit marker">Edit</button><button class="native-button compact small" data-marker-id="${escapeAttribute(marker.id)}" data-marker-action="remove" aria-label="Remove marker">×</button>`; list.appendChild(row); }
    });
  }
  function formatTime(value) {
    const seconds = Math.max(0, Number(value) || 0); const minutes = Math.floor(seconds / 60); const sec = Math.floor(seconds % 60); const tenth = Math.floor((seconds % 1) * 10);
    return `${String(minutes).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${tenth}`;
  }
  function escapeHTML(value) { return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function escapeAttribute(value) { return escapeHTML(value).replace(/`/g, '&#96;'); }
  function updateTransport(current = 0, duration = 0, playing = false) {
    const currentText = document.getElementById('current-time'); const durationText = document.getElementById('duration-time'); const code = document.getElementById('preview-timecode'); const seek = document.getElementById('seek-range'); const ruler = document.getElementById('timeline-ruler');
    if (currentText) currentText.textContent = formatTime(current); if (durationText) durationText.textContent = formatTime(duration);
    if (code) code.textContent = `${formatTime(current)} / ${formatTime(duration)}`;
    if (seek && duration > 0 && document.activeElement !== seek) seek.value = String(Math.round(current / duration * Number(seek.max || 1000)));
    if (ruler) ruler.style.setProperty('--playhead', `${duration > 0 ? current / duration * 100 : 0}%`);
    const play = document.getElementById('play-button');
    if (play) { play.innerHTML = icon(playing ? 'pause' : 'play'); play.setAttribute('aria-label', playing ? 'Pause' : 'Play'); }
    const label = document.getElementById('timeline-duration-label'); if (label) label.textContent = duration > 0 ? `${formatTime(duration)}` : 'Add media';
  }
  function setRecordingStatus(active, fps = '') {
    const detail = active && typeof active === 'object' ? active : null;
    const recording = detail ? detail.status === 'recording' || detail.status === 'stopping' : Boolean(active);
    const fpsValue = detail ? (detail.fps || detail.frameRate || '') : fps;
    const indicator = document.getElementById('recording-indicator'); if (indicator) indicator.classList.toggle('active', recording);
    const fpsNode = document.getElementById('recording-fps'); if (fpsNode) fpsNode.textContent = fpsValue ? `${fpsValue} fps` : '';
    const button = document.getElementById('record-button'); if (button) { button.textContent = recording ? 'Stop recording' : 'Record replay'; button.dataset.action = recording ? 'stop-recording' : 'record-replay'; button.classList.toggle('danger', recording); }
  }
  function setPreviewMeta({ fileName = '', width = 0, height = 0, hasVideo = false } = {}) {
    const label = document.getElementById('current-file-label'); if (label) label.textContent = fileName || 'Untitled project';
    const empty = document.getElementById('preview-empty'); if (empty) empty.style.display = hasVideo ? 'none' : 'flex';
    const resolution = document.getElementById('media-resolution'); if (resolution) resolution.textContent = width && height ? `${width} × ${height}` : hasVideo ? 'Preview' : 'No source';
    const statusFile = document.getElementById('status-file'); if (statusFile) statusFile.textContent = fileName || 'No source';
  }
  function showRecordingPreview(blob, urlOrMeta = {}, extra = {}) {
    if (!blob) return;
    const meta = urlOrMeta && typeof urlOrMeta === 'object' ? urlOrMeta : extra;
    const suppliedUrl = typeof urlOrMeta === 'string' ? urlOrMeta : (meta.url || '');
    if (previewUrl && previewUrl !== suppliedUrl && !previewUrlManagedByRecorder) URL.revokeObjectURL(previewUrl);
    previewUrl = suppliedUrl || previewUrl || URL.createObjectURL(blob);
    previewUrlManagedByRecorder = Boolean(suppliedUrl);
    const video = document.getElementById('result-video'); if (video) { video.src = previewUrl; video.load(); }
    const duration = document.getElementById('result-duration'); if (duration) duration.textContent = `Duration ${formatTime(meta.duration || 0)}`;
    const size = document.getElementById('result-size'); if (size) size.textContent = `Size ${formatBytes(blob.size)}`;
    const format = document.getElementById('result-format'); if (format) format.textContent = `Format ${(meta.format || blob.type || 'video').toUpperCase()}`;
    const selector = document.getElementById('export-format');
    const supportedFormats = F.recorder?.getSupportedFormats?.() || [];
    if (selector && supportedFormats.length) {
      Array.from(selector.options).forEach(option => {
        const formatInfo = supportedFormats.find(item => item.id === option.value);
        if (!formatInfo) return;
        option.disabled = !formatInfo.supported;
        option.title = formatInfo.reason || '';
        option.textContent = formatInfo.supported ? `${formatInfo.label}${formatInfo.conversion && formatInfo.id !== 'gif' ? ' (optional conversion)' : ''}` : `${formatInfo.label} (unavailable)`;
      });
      if (selector.selectedOptions[0]?.disabled) {
        const firstAvailable = Array.from(selector.options).find(option => !option.disabled);
        if (firstAvailable) selector.value = firstAvailable.value;
      }
    }
    updateExportOptions();
    const review = document.getElementById('recording-review-link'); if (review) review.hidden = false;
    openModal('result-modal');
  }
  function reopenRecordingPreview() { if (!previewUrl) return false; openModal('result-modal'); return true; }
  function clearRecordingPreview() {
    const video = document.getElementById('result-video');
    if (video) { video.pause(); video.removeAttribute('src'); video.load(); }
    if (previewUrl && !previewUrlManagedByRecorder) URL.revokeObjectURL(previewUrl);
    previewUrl = ''; previewUrlManagedByRecorder = false;
    const review = document.getElementById('recording-review-link'); if (review) review.hidden = true;
    if (document.getElementById('result-modal')?.classList.contains('open')) closeModal('result-modal');
  }
  function formatBytes(value) { let size = Number(value) || 0; const units = ['B', 'KB', 'MB', 'GB']; let i = 0; while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; } return `${size.toFixed(i ? 1 : 0)} ${units[i]}`; }
  function openRename(destination) { requestRename(destination); }
  function togglePanel(side) {
    const workspace = document.getElementById('workspace');
    if (!workspace) return;
    const mobile = typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 780px)').matches;
    if (side === 'right') {
      const panel = document.getElementById('inspector'); const collapsed = panel.classList.toggle('panel-collapsed'); workspace.classList.toggle('right-collapsed', collapsed);
      const button = document.getElementById('mobile-properties'); if (button) button.setAttribute('aria-expanded', String(!collapsed));
      if (mobile && !collapsed) { document.getElementById('sidebar')?.classList.add('collapsed'); workspace.classList.add('left-collapsed'); const leftButton = document.getElementById('mobile-sources'); if (leftButton) leftButton.setAttribute('aria-expanded', 'false'); }
    }
    if (side === 'left') {
      const panel = document.getElementById('sidebar'); const collapsed = panel.classList.toggle('collapsed'); workspace.classList.toggle('left-collapsed', collapsed);
      const button = document.getElementById('mobile-sources'); if (button) button.setAttribute('aria-expanded', String(!collapsed));
      if (mobile && !collapsed) { document.getElementById('inspector')?.classList.add('panel-collapsed'); workspace.classList.add('right-collapsed'); const rightButton = document.getElementById('mobile-properties'); if (rightButton) rightButton.setAttribute('aria-expanded', 'false'); }
    }
  }
  function setLoading(targetId, loading, label = 'Loading') {
    const target = typeof targetId === 'string' ? document.getElementById(targetId) : targetId; if (!target) return;
    target.setAttribute('aria-busy', String(Boolean(loading)));
    if (loading) {
      if (!Object.prototype.hasOwnProperty.call(target.dataset, 'previousHTML')) {
        target.dataset.previousHTML = target.innerHTML;
        target.dataset.previousDisabled = String(Boolean(target.disabled));
      }
      target.disabled = true;
      target.innerHTML = `<span class="spinner" aria-hidden="true"></span><span>${escapeHTML(label)}</span>`;
    } else if (Object.prototype.hasOwnProperty.call(target.dataset, 'previousHTML')) {
      target.innerHTML = target.dataset.previousHTML;
      target.disabled = target.dataset.previousDisabled === 'true';
      delete target.dataset.previousHTML;
      delete target.dataset.previousDisabled;
    }
  }
  function renderSettings(settings = {}) {
    const theme = document.getElementById('theme-select'); if (theme) theme.value = settings.theme || 'dark';
    const css = document.getElementById('custom-css-input'); if (css) css.value = settings.customCSS || '';
    const google = document.getElementById('google-client-id'); if (google) google.value = settings.googleClientId || '';
    const spotify = document.getElementById('spotify-client-id'); if (spotify) spotify.value = settings.spotifyClientId || '';
    const github = document.getElementById('github-token'); if (github) github.value = F.auth?.getGitHubToken?.() || '';
    const video = document.getElementById('default-video-volume'); if (video) video.value = String(settings.videoVolume ?? 1);
    const music = document.getElementById('default-music-volume'); if (music) music.value = String(settings.musicVolume ?? .5);
    const fps = document.getElementById('show-recording-fps'); if (fps) fps.checked = Boolean(settings.showRecordingFps);
    const background = document.getElementById('settings-background-color'); if (background) background.value = settings.backgroundColor || '#0a0a0a';
    const loops = document.getElementById('animation-loops-json'); if (loops && document.activeElement !== loops) loops.value = JSON.stringify(settings.loops || {}, null, 2);
    setOriginText();
  }
  function renderPresets(presets = []) {
    const select = document.getElementById('preset-select'); if (!select) return;
    select.replaceChildren(new Option('Choose preset', ''));
    presets.forEach((preset, i) => select.add(new Option(preset.name || `Preset ${i + 1}`, preset.id || String(i))));
  }
  function renderExportProfiles(profiles = []) {
    const select = document.getElementById('export-profile-select'); if (!select) return;
    const selected = select.value;
    const supported = F.recorder?.getSupportedFormats?.() || [];
    select.replaceChildren(new Option('Current choices', ''));
    (Array.isArray(profiles) ? profiles : []).forEach((profile, index) => {
      const value = String(profile.id || profile.name || index);
      const format = supported.find(item => item.id === profile.format);
      const option = new Option(profile.name || `Profile ${index + 1}`, value);
      if (format && !format.supported) { option.disabled = true; option.title = format.reason || 'This format is unavailable.'; }
      select.add(option);
    });
    if (Array.from(select.options).some(option => option.value === selected)) select.value = selected;
  }
  function renderShortcutEditor(mapping, assets = []) {
    const root = document.getElementById('shortcut-settings-list'); if (!root) return;
    root.replaceChildren();
    const entries = Object.entries(mapping || {});
    if (!entries.length) { const note = document.createElement('p'); note.className = 'inline-help'; note.textContent = 'Default keys: 1 idle, 2 talk, 3 laugh.'; root.appendChild(note); }
    entries.forEach(([key, value]) => {
      const item = typeof value === 'string' ? { state: value, mode: 'toggle' } : value || {};
      const row = document.createElement('div'); row.className = 'shortcut-setting';
      const keyNode = document.createElement('kbd'); keyNode.className = 'shortcut-key'; keyNode.textContent = key; row.appendChild(keyNode);
      const target = document.createElement('select'); target.className = 'native-select'; target.dataset.shortcutTarget = key;
      const options = ['idle', 'talk', 'laugh', ...assets.map(asset => asset.name.replace(/\.[^.]+$/, ''))];
      [...new Set(options)].forEach(option => target.add(new Option(option, option)));
      target.value = item.state || item.image || 'idle'; row.appendChild(target);
      const mode = document.createElement('select'); mode.className = 'native-select'; mode.dataset.shortcutMode = key; mode.add(new Option('Toggle', 'toggle')); mode.add(new Option('Hold', 'hold')); mode.value = item.mode === 'hold' ? 'hold' : 'toggle'; row.appendChild(mode);
      const change = document.createElement('button'); change.type = 'button'; change.className = 'native-button small'; change.textContent = 'Change'; change.dataset.action = 'change-shortcut'; change.dataset.key = key; row.appendChild(change);
      root.appendChild(row);
    });
  }

  function updateAudioMeters(levels) {
    const values = levels || {};
    [['video', 'video-level-meter', 'video-level-value'], ['music', 'music-level-meter', 'music-level-value']].forEach(([key, meterId, valueId]) => {
      const raw = Number(values[key]);
      const percent = Math.round(Math.max(0, Math.min(1, Number.isFinite(raw) ? raw : 0)) * 100);
      const meter = document.getElementById(meterId);
      if (meter) {
        meter.setAttribute('aria-valuenow', String(percent));
        meter.setAttribute('aria-valuetext', `${percent}%`);
        const fill = meter.querySelector('.audio-meter-fill');
        if (fill) fill.style.width = `${percent}%`;
      }
      const readout = document.getElementById(valueId);
      if (readout) readout.textContent = `${percent}%`;
    });
  }

  F.ui = {
    renderShell, toast, setStatus, setConnectionStatus, renderConnections, renderFileList, renderAssets, renderLayers, renderMappings, renderMarkers,
    updateTransport, updateAudioMeters, setRecordingStatus, setPreviewMeta, showRecordingPreview, reopenRecordingPreview, clearRecordingPreview, openSettings, openHelp, confirm, closeModal, openModal,
    openRename, togglePanel, setLoading, renderSettings, renderPresets, renderExportProfiles, renderShortcutEditor, formatTime, formatBytes,
    get activeModal() { return document.querySelector('.modal-backdrop.open')?.id || ''; }
  };
})(window, document);
