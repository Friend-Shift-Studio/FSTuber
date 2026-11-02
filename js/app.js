/* Responsibility: bootstrap FSTuber and coordinate settings, media, overlays, connections, editing, playback, presets and export UI. */
(function startFSTuber(window, document) {
  'use strict';

  const F = window.FSTuber = window.FSTuber || {};
  F.app = F;
  window.app = F;
  window.auth = F.auth;
  window.media = F.media;
  window.settings = F.settings;
  window.recorder = F.recorder;

  const defaults = {
    trimIn: 0,
    trimOut: 0,
    brightness: 100,
    contrast: 100,
    saturation: 100,
    backgroundColor: '#08090a',
    aspectRatio: 'source',
    cropMode: 'contain',
    text: '',
    textEnabled: false,
    textSize: 32,
    textColor: '#ffffff',
    textPosition: 'bottom'
  };
  const state = {
    edit: Object.assign({}, defaults),
    markers: [],
    localFiles: [],
    driveFiles: [],
    githubFiles: [],
    githubRepos: [],
    githubBranches: [],
    loopEnabled: false,
    videoMuted: false,
    musicMuted: false,
    videoVolume: 1,
    musicVolume: 0.5,
    recordResolution: 'source',
    isRecording: false,
    hasUnsavedRecording: false,
    recordedResolution: 'source',
    recordedDuration: 0,
    exportLink: '',
    projectLoaded: false,
    pendingVideoName: '',
    pendingVideoRestore: false,
    history: [],
    historyIndex: -1,
    captureShortcut: null,
    spotifyTracks: new Map(),
    spotifyModal: null,
    uploadProgress: 0,
    showFps: false
  };
  let saveTimer = 0;
  let animationFrame = 0;
  let frameCounter = 0;
  let fpsUpdatedAt = 0;
  let lastRenderAt = 0;

  function el(id) { return document.getElementById(id); }
  function settingsValue() { return F.settings && typeof F.settings.get === 'function' ? F.settings.get() : {}; }
  function toast(message, type) { if (F.ui && typeof F.ui.toast === 'function') F.ui.toast(message, type || 'info'); }
  function setStatus(message, type) { if (F.ui && typeof F.ui.setStatus === 'function') F.ui.setStatus(message, type || 'info'); }
  function finite(value, fallback) { const number = Number(value); return Number.isFinite(number) ? number : fallback; }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, finite(value, min))); }
  function timeNow() { const video = F.media && F.media.getState().videoEl; return video ? finite(video.currentTime, 0) : 0; }
  function durationNow() {
    const media = F.media && F.media.getState();
    const videoDuration = media && media.videoEl && Number.isFinite(media.videoEl.duration) ? media.videoEl.duration : 0;
    return videoDuration || finite(media && media.duration, 0);
  }
  function videoElement() { return F.media && F.media.getState().videoEl; }
  function musicElement() { return F.media && F.media.getState().musicEl; }
  function isPlaying() { const video = videoElement(); return Boolean(video && !video.paused && !video.ended); }
  function makeId() { return window.crypto && typeof window.crypto.randomUUID === 'function' ? window.crypto.randomUUID() : `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }

  function mediaKind(name) {
    const extension = String(name || '').split('.').pop().toLowerCase();
    if (['png', 'jpg', 'jpeg', 'gif', 'apng', 'webp'].includes(extension)) return 'image';
    if (['mp4', 'webm'].includes(extension)) return 'video';
    if (['mp3', 'wav', 'ogg'].includes(extension)) return 'audio';
    return 'unsupported';
  }

  function getCanvasSize() {
    const canvas = el('preview-canvas');
    return canvas ? { width: canvas.width, height: canvas.height } : { width: 1280, height: 720 };
  }

  function selectedRatio(sourceWidth, sourceHeight) {
    const selected = state.edit.aspectRatio || 'source';
    if (selected === 'source') return sourceWidth / Math.max(1, sourceHeight);
    const parts = selected.split(':').map(Number);
    return parts.length === 2 && parts.every(Number.isFinite) && parts[1] > 0 ? parts[0] / parts[1] : sourceWidth / Math.max(1, sourceHeight);
  }

  function updateCanvasSize() {
    const canvas = el('preview-canvas');
    if (!canvas || state.isRecording) return;
    const video = videoElement();
    const sourceWidth = Math.max(2, Number(video && video.videoWidth) || 1280);
    const sourceHeight = Math.max(2, Number(video && video.videoHeight) || 720);
    const ratio = selectedRatio(sourceWidth, sourceHeight);
    let width = sourceWidth;
    let height = state.edit.aspectRatio === 'source' ? sourceHeight : width / ratio;
    if (height > sourceHeight && state.edit.aspectRatio !== 'source') { height = sourceHeight; width = height * ratio; }
    const maxDimension = 2560;
    const scale = Math.min(1, maxDimension / Math.max(width, height));
    width = Math.max(2, Math.round(width * scale / 2) * 2);
    height = Math.max(2, Math.round(height * scale / 2) * 2);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  function drawTextOverlay(ctx, width, height) {
    const text = String(state.edit.text || '').trim();
    if (!state.edit.textEnabled || !text) return;
    const scale = Math.max(0.5, width / 1280);
    const fontSize = clamp(state.edit.textSize, 8, 160) * scale;
    const padding = Math.max(16, fontSize * 0.65);
    let y = height - padding;
    if (state.edit.textPosition === 'top') y = padding + fontSize;
    if (state.edit.textPosition === 'center') y = height / 2 + fontSize / 3;
    ctx.save();
    ctx.font = `590 ${fontSize}px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(2, fontSize * 0.09);
    ctx.strokeStyle = 'rgba(0,0,0,.78)';
    ctx.fillStyle = /^#[0-9a-f]{6}$/i.test(state.edit.textColor) ? state.edit.textColor : '#ffffff';
    const maxWidth = width - padding * 2;
    ctx.strokeText(text, width / 2, y, maxWidth);
    ctx.fillText(text, width / 2, y, maxWidth);
    ctx.restore();
  }

  function renderFrame() {
    const canvas = el('preview-canvas');
    if (!canvas) return;
    updateCanvasSize();
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;
    const width = canvas.width;
    const height = canvas.height;
    const background = /^#[0-9a-f]{6}$/i.test(state.edit.backgroundColor) ? state.edit.backgroundColor : '#08090a';
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);

    const video = videoElement();
    if (video && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
      const sourceWidth = video.videoWidth;
      const sourceHeight = video.videoHeight;
      const sourceRatio = sourceWidth / sourceHeight;
      const destinationRatio = width / height;
      let sx = 0, sy = 0, sw = sourceWidth, sh = sourceHeight;
      let dx = 0, dy = 0, dw = width, dh = height;
      if (state.edit.cropMode === 'cover') {
        if (sourceRatio > destinationRatio) {
          sw = sourceHeight * destinationRatio;
          sx = (sourceWidth - sw) / 2;
        } else {
          sh = sourceWidth / destinationRatio;
          sy = (sourceHeight - sh) / 2;
        }
      } else if (sourceRatio > destinationRatio) {
        dh = width / sourceRatio;
        dy = (height - dh) / 2;
      } else {
        dw = height * sourceRatio;
        dx = (width - dw) / 2;
      }
      ctx.save();
      ctx.filter = `brightness(${clamp(state.edit.brightness, 0, 200)}%) contrast(${clamp(state.edit.contrast, 0, 200)}%) saturate(${clamp(state.edit.saturation, 0, 200)}%)`;
      try { ctx.drawImage(video, sx, sy, sw, sh, dx, dy, dw, dh); } catch (_) { /* Skip transient frames while a source is changing. */ }
      ctx.restore();
    }
    if (F.pnuber && typeof F.pnuber.draw === 'function') F.pnuber.draw(ctx, width, height);
    drawTextOverlay(ctx, width, height);
    if (F.media && F.ui && F.media.getAudioLevels && F.ui.updateAudioMeters) F.ui.updateAudioMeters(F.media.getAudioLevels());

    frameCounter += 1;
    const now = performance.now();
    if (now - fpsUpdatedAt >= 1000) {
      if (state.isRecording && state.showFps) {
        const fps = Math.round(frameCounter * 1000 / Math.max(1, now - fpsUpdatedAt));
        const status = el('status-fps');
        if (status) status.textContent = `${fps} fps`;
      }
      frameCounter = 0;
      fpsUpdatedAt = now;
    }
    lastRenderAt = now;
  }

  function animationLoop(timestamp) {
    renderFrame(timestamp);
    animationFrame = window.requestAnimationFrame(animationLoop);
  }

  function updateTrimLabel() {
    const duration = durationNow();
    const label = el('trim-range-label');
    if (label && F.ui) label.textContent = `${F.ui.formatTime(state.edit.trimIn)}–${F.ui.formatTime(state.edit.trimOut || duration)}`;
  }

  function updateVolumes() {
    if (F.media) {
      F.media.setVideoVolume(state.videoMuted ? 0 : state.videoVolume);
      F.media.setMusicVolume(state.musicMuted ? 0 : state.musicVolume);
    }
    ['video-volume', 'transport-video-volume'].forEach(id => { const input = el(id); if (input) input.value = String(state.videoVolume); });
    ['music-volume', 'transport-music-volume'].forEach(id => { const input = el(id); if (input) input.value = String(state.musicVolume); });
    const videoValue = el('video-volume-value'); if (videoValue) videoValue.textContent = `${Math.round(state.videoVolume * 100)}%`;
    const musicValue = el('music-volume-value'); if (musicValue) musicValue.textContent = `${Math.round(state.musicVolume * 100)}%`;
    const videoButton = document.querySelector('[data-action="toggle-video-mute"]');
    const musicButton = document.querySelector('[data-action="toggle-music-mute"]');
    if (videoButton) { videoButton.textContent = state.videoMuted ? 'Unmute source' : 'Mute source'; videoButton.setAttribute('aria-pressed', String(state.videoMuted)); }
    if (musicButton) { musicButton.textContent = state.musicMuted ? 'Unmute music' : 'Mute music'; musicButton.setAttribute('aria-pressed', String(state.musicMuted)); }
  }

  function updateDriveProgress(percent, visible) {
    const root = el('drive-upload-progress');
    const bar = el('drive-upload-progress-bar');
    if (!root) return;
    const value = Math.round(clamp(percent, 0, 100));
    root.hidden = !visible;
    root.setAttribute('aria-valuenow', String(value));
    if (bar) bar.style.width = `${value}%`;
  }

  function connectionState() {
    const statuses = F.auth && F.auth.getStatus ? F.auth.getStatus() : {};
    const values = settingsValue();
    return Object.assign({}, statuses, {
      googleConfigured: Boolean(values.googleClientId),
      spotifyConfigured: Boolean(values.spotifyClientId),
      githubConfigured: Boolean(F.auth && F.auth.getGitHubToken && F.auth.getGitHubToken())
    });
  }

  function renderShortcutRows() {
    if (!F.ui) return;
    const mapping = F.shortcuts && F.shortcuts.getMap ? F.shortcuts.getMap() : {};
    const settings = settingsValue();
    const extraStates = [...(settings.customStates || []), ...Object.keys(settings.loops || {})].map(name => ({ name: String(name) }));
    const rows = Object.entries(mapping).map(([key, action]) => ({
      key,
      state: action.state || action.image || 'idle',
      label: action.label || action.state || action.image || 'idle',
      mode: action.mode || 'hold'
    }));
    F.ui.renderMappings(rows);
    F.ui.renderShortcutEditor(mapping, [...(F.pnuber && F.pnuber.getAssets ? F.pnuber.getAssets() : []), ...extraStates]);
  }

  function syncUI() {
    if (!F.ui) return;
    const media = F.media && F.media.getState ? F.media.getState() : {};
    const video = media.videoEl;
    const width = Number(video && video.videoWidth) || 0;
    const height = Number(video && video.videoHeight) || 0;
    const connections = connectionState();
    F.ui.setPreviewMeta({
      fileName: media.videoFileName || '', width, height,
      hasVideo: Boolean(video && (video.currentSrc || video.srcObject || width))
    });
    F.ui.updateTransport(timeNow(), durationNow(), isPlaying());
    F.ui.renderAssets(media.images || []);
    F.ui.renderLayers(F.pnuber && F.pnuber.getLayers ? F.pnuber.getLayers() : []);
    F.ui.renderMarkers(state.markers, durationNow());
    F.ui.renderSettings(settingsValue());
    F.ui.renderPresets(settingsValue().exportPresets || []);
    F.ui.renderExportProfiles(settingsValue().exportProfiles || []);
    renderShortcutRows();
    F.ui.renderConnections(connections);
    const connectionSummary = el('status-connections');
    if (connectionSummary) connectionSummary.textContent = `Drive ${connections.google?.connected ? 'on' : 'off'} · Spotify ${connections.spotify?.connected ? 'on' : 'off'} · GitHub ${connections.github?.connected ? 'on' : 'off'}`;
    const activeState = el('active-pnuber-state');
    if (activeState && F.pnuber) activeState.textContent = F.pnuber.getState ? F.pnuber.getState() : 'idle';
    const stateSelect = el('pnuber-state-select');
    if (stateSelect && F.pnuber && F.pnuber.getAssets) {
      const current = stateSelect.value;
      const names = ['idle', 'talk', 'laugh', ...(settingsValue().customStates || []), ...Object.keys(settingsValue().loops || {}), ...F.pnuber.getAssets().map(asset => asset.name)];
      stateSelect.replaceChildren(...Array.from(new Set(names), name => new Option(name, name)));
      if (names.includes(current)) stateSelect.value = current;
    }
    const currentCanvasBackground = el('background-color');
    if (currentCanvasBackground) currentCanvasBackground.value = state.edit.backgroundColor;
    const aspect = el('aspect-ratio'); if (aspect) aspect.value = state.edit.aspectRatio;
    const crop = el('crop-mode'); if (crop) crop.value = state.edit.cropMode;
    const trimStart = el('trim-start'); if (trimStart) trimStart.value = String(state.edit.trimIn);
    const trimEnd = el('trim-end'); if (trimEnd) trimEnd.value = String(state.edit.trimOut || durationNow());
    ['brightness', 'contrast', 'saturation'].forEach(key => {
      const input = el(key); const value = el(`${key}-value`);
      if (input) input.value = String(state.edit[key]);
      if (value) value.textContent = `${Math.round(state.edit[key])}%`;
    });
    const textEnabled = el('text-enabled'); if (textEnabled) textEnabled.checked = Boolean(state.edit.textEnabled);
    const text = el('text-overlay'); if (text && document.activeElement !== text) text.value = state.edit.text;
    const textSize = el('text-size'); if (textSize) textSize.value = String(state.edit.textSize);
    const textColor = el('text-color'); if (textColor) textColor.value = state.edit.textColor;
    const textPosition = el('text-position'); if (textPosition) textPosition.value = state.edit.textPosition;
    const recordResolution = el('record-resolution'); if (recordResolution) recordResolution.value = state.recordResolution;
    updateTrimLabel();
    updateVolumes();
  }

  function persistProjectState(immediate) {
    if (!F.settings || typeof F.settings.saveSettings !== 'function') return Promise.resolve(false);
    const snapshot = {
      edit: Object.assign({}, state.edit),
      trimStart: state.edit.trimIn,
      trimEnd: state.edit.trimOut,
      markers: state.markers.map(marker => Object.assign({}, marker)),
      musicVolume: state.musicVolume,
      videoVolume: state.videoVolume,
      backgroundColor: state.edit.backgroundColor,
      loopEnabled: state.loopEnabled,
      recordingResolution: state.recordResolution,
      showRecordingFps: state.showFps,
      lastMediaPath: F.media && F.media.getState ? (F.media.getState().videoFileName || settingsValue().lastMediaPath || '') : '',
      lastGitHubRepo: settingsValue().lastGitHubRepo || '',
      lastGitHubBranch: settingsValue().lastGitHubBranch || ''
    };
    if (immediate) return F.settings.saveSettings(snapshot);
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => F.settings.saveSettings(snapshot), 650);
    return Promise.resolve(true);
  }

  function loadSettingsIntoState(settings) {
    const savedEdit = settings.edit && typeof settings.edit === 'object' ? settings.edit : {};
    state.edit = Object.assign({}, defaults, savedEdit, {
      trimIn: Math.max(0, finite(savedEdit.trimIn ?? settings.trimStart, 0)),
      trimOut: Math.max(0, finite(savedEdit.trimOut ?? settings.trimEnd, 0)),
      backgroundColor: savedEdit.backgroundColor || settings.backgroundColor || defaults.backgroundColor,
      aspectRatio: savedEdit.aspectRatio || 'source',
      cropMode: savedEdit.cropMode || 'contain',
      textEnabled: Boolean(savedEdit.textEnabled)
    });
    state.markers = Array.isArray(settings.markers) ? settings.markers.map(marker => ({ id: String(marker.id || makeId()), time: Math.max(0, finite(marker.time, 0)), label: String(marker.label || '') })) : [];
    state.musicVolume = clamp(settings.musicVolume, 0, 1);
    state.videoVolume = clamp(settings.videoVolume, 0, 1);
    state.loopEnabled = Boolean(settings.loopEnabled);
    state.recordResolution = ['720p', '1080p'].includes(settings.recordingResolution) ? settings.recordingResolution : 'source';
    state.showFps = Boolean(settings.showRecordingFps);
    state.pendingVideoName = settings.lastMediaPath || '';
    state.pendingVideoRestore = Boolean(state.pendingVideoName && (settings.edit || settings.trimStart || settings.trimEnd));
  }

  function editSnapshot() {
    return JSON.stringify({
      trimIn: state.edit.trimIn, trimOut: state.edit.trimOut,
      brightness: state.edit.brightness, contrast: state.edit.contrast,
      saturation: state.edit.saturation, backgroundColor: state.edit.backgroundColor
    });
  }

  function pushHistory() {
    const snapshot = editSnapshot();
    if (state.history[state.historyIndex] === snapshot) return;
    state.history = state.history.slice(0, state.historyIndex + 1);
    state.history.push(snapshot);
    if (state.history.length > 50) state.history.shift();
    state.historyIndex = state.history.length - 1;
  }

  function applyHistory(snapshot) {
    if (!snapshot) return;
    const next = JSON.parse(snapshot);
    Object.assign(state.edit, next);
    syncUI();
    renderFrame();
    persistProjectState();
  }

  function undo() {
    if (state.historyIndex <= 0) return toast('There is no earlier trim or color change to undo.', 'info');
    state.historyIndex -= 1;
    applyHistory(state.history[state.historyIndex]);
  }

  function redo() {
    if (state.historyIndex >= state.history.length - 1) return toast('There is no later trim or color change to redo.', 'info');
    state.historyIndex += 1;
    applyHistory(state.history[state.historyIndex]);
  }

  function seek(time) {
    const video = videoElement();
    if (!video || !Number.isFinite(Number(time))) return;
    const duration = durationNow();
    const start = Math.max(0, state.edit.trimIn);
    const end = state.edit.trimOut > 0 ? Math.min(state.edit.trimOut, duration || state.edit.trimOut) : duration;
    const bounded = Math.max(start, Math.min(end || Number(time), Number(time)));
    try { video.currentTime = bounded; } catch (_) { /* Some live streams do not support seeking. */ }
    const music = musicElement();
    if (music && Number.isFinite(music.duration) && music.duration > 0) {
      try { music.currentTime = bounded % music.duration; } catch (_) { /* Streaming music may be non-seekable. */ }
    }
    F.ui.updateTransport(timeNow(), durationNow(), isPlaying());
  }

  function seekBy(amount) { seek(timeNow() + Number(amount || 0)); }

  async function play() {
    const video = videoElement();
    if (!video || !(video.currentSrc || video.srcObject || video.src)) return toast('Load a video or start a screen share before playback.', 'info');
    const duration = durationNow();
    const end = state.edit.trimOut > 0 ? Math.min(state.edit.trimOut, duration || state.edit.trimOut) : duration;
    if (timeNow() < state.edit.trimIn || end > 0 && timeNow() >= end) seek(state.edit.trimIn);
    try {
      const media = F.media.getState();
      if (media.audioContext && media.audioContext.state === 'suspended') await media.audioContext.resume();
      await video.play();
      const music = musicElement();
      if (music && music.src) {
        if (Number.isFinite(music.duration) && music.duration > 0) music.currentTime = timeNow() % music.duration;
        await music.play().catch(() => {});
      }
      F.ui.updateTransport(timeNow(), durationNow(), true);
      setStatus('Playback started.');
    } catch (error) { toast(`Playback could not start: ${error.message || 'check browser media permissions.'}`, 'error'); }
  }

  function pause() {
    const video = videoElement(); const music = musicElement();
    if (video) video.pause();
    if (music) music.pause();
    F.ui.updateTransport(timeNow(), durationNow(), false);
  }

  async function togglePlayback() { if (isPlaying()) pause(); else await play(); }

  function handleTimeUpdate() {
    const video = videoElement();
    if (!video) return;
    const duration = durationNow();
    const end = state.edit.trimOut > 0 ? Math.min(state.edit.trimOut, duration || state.edit.trimOut) : duration;
    if (end > state.edit.trimIn && timeNow() >= end - 0.025) {
      if (state.loopEnabled && !state.isRecording) seek(state.edit.trimIn);
      else if (!state.isRecording) pause();
    }
    F.ui.updateTransport(timeNow(), duration, isPlaying());
    updateTrimLabel();
  }

  function syncControlsAfterEdit() {
    renderFrame();
    updateTrimLabel();
    persistProjectState();
  }

  function handleControl(detail) {
    if (!detail) return;
    const key = detail.control;
    const value = detail.value;
    if (key === 'seek') { seek(clamp(value, 0, 1000) / 1000 * durationNow()); return; }
    if (['trim-start', 'trim-end', 'brightness', 'contrast', 'saturation', 'background-color'].includes(key)) pushHistory();
    if (key === 'trim-start') {
      const duration = durationNow();
      state.edit.trimIn = clamp(value, 0, Math.max(0, (state.edit.trimOut || duration) - 0.05));
      if (timeNow() < state.edit.trimIn) seek(state.edit.trimIn);
    } else if (key === 'trim-end') {
      const duration = durationNow();
      const maximum = duration > 0 ? duration : Number.MAX_SAFE_INTEGER;
      state.edit.trimOut = clamp(value, state.edit.trimIn + 0.05, maximum);
    } else if (key === 'brightness' || key === 'contrast' || key === 'saturation') {
      state.edit[key] = clamp(value, 0, 200);
    } else if (key === 'background-color') {
      state.edit.backgroundColor = String(value || defaults.backgroundColor);
    } else if (key === 'aspect-ratio') {
      state.edit.aspectRatio = String(value || 'source');
      updateCanvasSize();
    } else if (key === 'crop-mode') {
      state.edit.cropMode = value === 'cover' ? 'cover' : 'contain';
    } else if (key === 'text-enabled') {
      state.edit.textEnabled = Boolean(value);
    } else if (key === 'text-overlay') {
      state.edit.text = String(value || '').slice(0, 180);
    } else if (key === 'text-size') {
      state.edit.textSize = clamp(value, 8, 160);
    } else if (key === 'text-color') {
      state.edit.textColor = String(value || '#ffffff');
    } else if (key === 'text-position') {
      state.edit.textPosition = ['top', 'center', 'bottom'].includes(value) ? value : 'bottom';
    } else if (key === 'video-volume') {
      state.videoVolume = clamp(value, 0, 1);
      state.videoMuted = false;
      updateVolumes();
    } else if (key === 'music-volume') {
      state.musicVolume = clamp(value, 0, 1);
      state.musicMuted = false;
      updateVolumes();
    } else return;
    if (['trim-start', 'trim-end', 'brightness', 'contrast', 'saturation', 'background-color'].includes(key)) pushHistory();
    syncUI();
    syncControlsAfterEdit();
  }

  function addMarker() {
    const time = Math.max(0, Math.min(durationNow() || timeNow(), timeNow()));
    const label = window.prompt('Marker label', `Marker ${state.markers.length + 1}`);
    if (label === null) return;
    state.markers.push({ id: makeId(), time, label: label.trim() || `Marker ${state.markers.length + 1}` });
    F.ui.renderMarkers(state.markers, durationNow());
    persistProjectState();
  }

  function handleMarkerAction(detail) {
    if (!detail) return;
    const index = state.markers.findIndex(marker => marker.id === detail.id);
    if (index < 0) return;
    if (detail.action === 'remove') {
      state.markers.splice(index, 1);
      F.ui.renderMarkers(state.markers, durationNow());
      persistProjectState();
    } else if (detail.action === 'edit') {
      const label = window.prompt('Rename marker', state.markers[index].label || '');
      if (label === null) return;
      state.markers[index].label = label.trim() || `Marker ${index + 1}`;
      F.ui.renderMarkers(state.markers, durationNow());
      persistProjectState();
    } else seek(state.markers[index].time);
  }

  function setMusicLabel(name) {
    const node = el('music-track-name');
    if (node) node.textContent = name ? `Selected: ${name}` : 'No music track selected';
  }

  async function loadLocalFiles(files, kind) {
    const selected = Array.from(files || []);
    if (!selected.length) return;
    const supported = selected.filter(file => mediaKind(file.name) !== 'unsupported');
    if (!supported.length) return toast('Unsupported format. Use PNG/JPG/GIF/APNG/WebP, MP4/WebM, or MP3/WAV/OGG.', 'error');
    const rejected = selected.length - supported.length;
    if (rejected) toast(`${rejected} unsupported file${rejected === 1 ? '' : 's'} skipped.`, 'warning');
    const videoFile = supported.find(file => mediaKind(file.name) === 'video');
    if (videoFile) {
      state.pendingVideoName = videoFile.name;
      state.pendingVideoRestore = Boolean(settingsValue().lastMediaPath === videoFile.name && settingsValue().edit);
    }
    const existing = new Set(state.localFiles.map(file => `${file.name}:${file.size}:${file.lastModified || 0}`));
    supported.forEach(file => {
      const key = `${file.name}:${file.size}:${file.lastModified || 0}`;
      if (!existing.has(key)) state.localFiles.push({ name: file.name, size: file.size, file, kind: mediaKind(file.name) });
    });
    F.ui.renderFileList('local-file-list', state.localFiles, 'local');
    setStatus('Loading selected media…', 'busy');
    try {
      const result = await F.media.loadFiles(supported, { kind });
      const imageAssets = F.media.getState().images.slice().reverse();
      supported.filter(file => mediaKind(file.name) === 'image').forEach(file => {
        const row = state.localFiles.find(item => item.file === file);
        const asset = imageAssets.find(item => item.name === file.name);
        if (row && asset) row.thumbnail = asset.url;
      });
      const musicFile = supported.find(file => mediaKind(file.name) === 'audio');
      if (musicFile) setMusicLabel(musicFile.name);
      updateCanvasSize();
      syncUI();
      setStatus('Media loaded. Original files remain unchanged.', 'success');
      const names = supported.map(file => file.name);
      const videoName = videoFile && videoFile.name;
      if (videoName) F.settings.saveSettings({ lastMediaPath: videoName });
      return result;
    } catch (error) {
      setStatus('Media could not be loaded.', 'error');
      toast(error.message || 'Media could not be loaded.', 'error');
    }
  }

  async function selectMediaFile(source, index) {
    if (source === 'local') {
      const file = state.localFiles[index];
      if (!file) return;
      if (file.kind === 'video') {
        state.pendingVideoName = file.name;
        state.pendingVideoRestore = Boolean(settingsValue().lastMediaPath === file.name && settingsValue().edit);
        try { await F.media.loadVideo(file.file, { name: file.name, source: 'local' }); }
        catch (error) { toast(error.message || 'The selected video could not be opened.', 'error'); }
      } else if (file.kind === 'audio') {
        try { await F.media.loadMusic(file.file, { name: file.name, source: 'local' }); setMusicLabel(file.name); }
        catch (error) { toast(error.message || 'The selected audio could not be opened.', 'error'); }
      } else {
        const asset = F.media.getState().images.find(image => image.name === file.name);
        if (asset && F.pnuber && !F.pnuber.getLayers().some(layer => layer.assetName === asset.name)) F.pnuber.addLayer(asset.name);
      }
      syncUI();
      return;
    }
    const files = source === 'drive' ? state.driveFiles : state.githubFiles;
    const file = files[index];
    if (!file) return;
    if (mediaKind(file.name) === 'video') {
      state.pendingVideoName = file.name;
      state.pendingVideoRestore = Boolean(settingsValue().lastMediaPath === file.name && settingsValue().edit);
    }
    try {
      const descriptor = Object.assign({}, file, { source });
      const imported = await F.media.importRemoteFile(descriptor);
      if (mediaKind(file.name) === 'audio') setMusicLabel(file.name);
      if (source === 'github') F.settings.saveSettings({ lastGitHubRepo: `${file.owner}/${file.repo}`, lastGitHubBranch: file.branch });
      if (source === 'drive') F.settings.saveSettings({ lastDriveFolder: 'FSTuber' });
      if (mediaKind(file.name) === 'video') F.settings.saveSettings({ lastMediaPath: file.name });
      if (mediaKind(file.name) === 'image' && F.pnuber && !F.pnuber.getLayers().some(layer => layer.assetName === imported.name)) F.pnuber.addLayer(imported.name);
      syncUI();
    } catch (error) { toast(error.message || 'The selected file could not be imported.', 'error'); }
  }

  function switchSource(detail) {
    if (!detail || !detail.source) return;
    if (detail.source === 'drive' && F.auth.getGoogleAccessToken()) refreshDrive().catch(() => {});
    if (detail.source === 'github' && F.auth.getGitHubToken() && state.githubFiles.length === 0) {
      const repo = settingsValue().lastGitHubRepo;
      if (repo && repo.includes('/')) {
        const [owner, name] = repo.split('/', 2);
        el('github-owner').value = owner;
        el('github-repo').value = name;
        el('github-branch').value = settingsValue().lastGitHubBranch || '';
        refreshGitHub().catch(() => {});
      }
    }
  }

  async function connectGoogleAndLoad() {
    if (!F.auth.getGoogleAccessToken()) {
      const connected = await F.auth.connectGoogle();
      if (!connected) return false;
      try {
        await F.settings.loadSettings();
        await F.settings.saveSettings(settingsValue());
      } catch (_) { /* Google Drive connection remains usable without settings sync. */ }
    }
    await refreshDrive();
    return true;
  }

  async function refreshDrive() {
    const token = F.auth.getGoogleAccessToken();
    if (!token) return toast('Connect Google Drive before browsing files.', 'warning');
    F.ui.setLoading('drive-refresh-button', true, 'Loading Drive');
    F.ui.setStatus('Loading files from FSTuber/…', 'busy');
    try {
      state.driveFiles = await F.media.listDriveFiles();
      F.ui.renderFileList('drive-file-list', state.driveFiles, 'drive');
      F.settings.saveSettings({ lastDriveFolder: 'FSTuber' });
      F.ui.setStatus(`Loaded ${state.driveFiles.length} supported Drive file${state.driveFiles.length === 1 ? '' : 's'}.`, 'success');
    } catch (error) {
      state.driveFiles = [];
      F.ui.renderFileList('drive-file-list', [], 'drive');
      toast(error.message || 'Google Drive could not be listed.', 'error');
      F.ui.setStatus('Google Drive listing failed.', 'error');
    } finally { F.ui.setLoading('drive-refresh-button', false); }
  }

  async function githubRequest(url) {
    const token = F.auth.getGitHubToken();
    if (!token) throw new Error('Connect GitHub with a fine-grained Contents: read token first.');
    const response = await window.fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });
    if (!response.ok) throw new Error(`GitHub request failed (${response.status}). Verify token access to this repository.`);
    return response.json();
  }

  async function githubRequestPaged(url, maxPages = 50) {
    const parsed = new URL(url);
    const pageSize = Math.max(1, Math.min(100, Number(parsed.searchParams.get('per_page')) || 100));
    parsed.searchParams.set('per_page', String(pageSize));
    const results = [];
    let truncated = false;
    for (let page = 1; page <= maxPages; page += 1) {
      parsed.searchParams.set('page', String(page));
      const pageItems = await githubRequest(parsed.toString());
      if (!Array.isArray(pageItems)) return pageItems;
      results.push(...pageItems);
      if (pageItems.length < pageSize) break;
      if (page === maxPages) truncated = true;
    }
    results.truncated = truncated;
    return results;
  }

  function fillDatalist(input, id, values) {
    if (!input) return;
    let list = el(id);
    if (!list) { list = document.createElement('datalist'); list.id = id; document.body.appendChild(list); }
    list.replaceChildren(...values.map(value => { const option = document.createElement('option'); option.value = value; return option; }));
    input.setAttribute('list', id);
  }

  async function refreshGitHub() {
    if (!F.auth.getGitHubToken()) {
      F.ui.openSettings('api-setup', 'github-token');
      toast('Connect GitHub with a fine-grained token to browse repositories.', 'warning');
      return;
    }
    const ownerInput = el('github-owner');
    const repoInput = el('github-repo');
    const branchInput = el('github-branch');
    F.ui.setLoading('github-browse-button', true, 'Loading GitHub');
    try {
      if (!ownerInput.value.trim() || !repoInput.value.trim()) {
        const repos = await githubRequestPaged('https://api.github.com/user/repos?per_page=100&sort=updated');
        state.githubRepos = Array.isArray(repos) ? repos : [];
        fillDatalist(repoInput, 'github-repo-options', state.githubRepos.map(repo => repo.name));
        fillDatalist(ownerInput, 'github-owner-options', [...new Set(state.githubRepos.map(repo => repo.owner && repo.owner.login).filter(Boolean))]);
        const saved = settingsValue().lastGitHubRepo || '';
        const preferred = state.githubRepos.find(repo => `${repo.owner.login}/${repo.name}` === saved) || state.githubRepos[0];
        if (!preferred) throw new Error('No repositories are available to this GitHub token. Enter an owner and repository manually.');
        ownerInput.value = preferred.owner.login;
        repoInput.value = preferred.name;
        branchInput.value = settingsValue().lastGitHubBranch || preferred.default_branch || '';
      }
      const owner = ownerInput.value.trim();
      const repoName = repoInput.value.trim();
      if (!owner || !repoName) throw new Error('Choose a GitHub owner and repository.');
      const metadata = await githubRequest(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}`);
      const branches = await githubRequestPaged(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}/branches?per_page=100`);
      state.githubBranches = Array.isArray(branches) ? branches : [];
      fillDatalist(branchInput, 'github-branch-options', state.githubBranches.map(branch => branch.name));
      const branch = branchInput.value.trim() || metadata.default_branch;
      branchInput.value = branch;
      state.githubFiles = await F.media.listGitHubFiles(owner, repoName, branch);
      F.media.clearThumbnails();
      const imageFiles = state.githubFiles.filter(file => /\.(png|jpe?g|gif|apng|webp)$/i.test(file.name || '') && Number(file.size) <= 1_000_000).slice(0, 16);
      await Promise.all(imageFiles.map(async file => {
        try { file.thumbnail = await F.media.loadRemoteThumbnail(file); }
        catch (_) { file.thumbnail = ''; }
      }));
      F.ui.renderFileList('github-file-list', state.githubFiles, 'github');
      F.settings.saveSettings({ lastGitHubRepo: `${owner}/${repoName}`, lastGitHubBranch: branch });
      const incomplete = Boolean(state.githubFiles.truncated || state.githubBranches.truncated || state.githubRepos.truncated);
      if (incomplete) {
        F.ui.setStatus(`Loaded ${state.githubFiles.length} supported GitHub files; a large listing may be incomplete.`, 'warning');
        toast('GitHub returned a very large listing. FSTuber kept the available files and marked the result as possibly incomplete.', 'warning');
      } else F.ui.setStatus(`Loaded ${state.githubFiles.length} supported GitHub file${state.githubFiles.length === 1 ? '' : 's'}.`, 'success');
    } catch (error) {
      state.githubFiles = [];
      F.media.clearThumbnails();
      F.ui.renderFileList('github-file-list', [], 'github');
      toast(error.message || 'GitHub repository files could not be loaded.', 'error');
      F.ui.setStatus('GitHub listing failed.', 'error');
    } finally { F.ui.setLoading('github-browse-button', false); }
  }

  function addSpotifyModal() {
    if (state.spotifyModal) return state.spotifyModal;
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.id = 'spotify-library-modal';
    backdrop.setAttribute('aria-hidden', 'true');
    backdrop.innerHTML = `
      <section class="modal wide" role="dialog" aria-modal="true" aria-labelledby="spotify-library-title">
        <header class="modal-head"><h2 id="spotify-library-title">Spotify library</h2><button class="native-button compact small" type="button" data-modal-close="spotify-library-modal" aria-label="Close Spotify library">×</button></header>
        <div class="modal-body">
          <div class="input-row"><input id="spotify-search-query" class="native-input" type="search" placeholder="Search tracks" aria-label="Search Spotify tracks"><button class="native-button small" type="button" data-action="spotify-search">Search</button><button class="native-button small" type="button" data-action="spotify-load-library">Your saved tracks</button></div>
          <div class="form-row"><label for="spotify-playlist-selector">Playlist</label><select id="spotify-playlist-selector" class="native-select"><option value="">Choose a playlist</option></select></div>
          <div class="inline-help">Only Spotify previews exposed by the service can be mixed into FSTuber. Full protected playback stays in Spotify and is not captured.</div>
          <div class="file-list" id="spotify-track-list"><div class="empty-hint">Search for tracks or load a saved playlist.</div></div>
        </div>
        <footer class="modal-foot"><span class="inline-help">Track availability and previews depend on Spotify.</span><div class="modal-foot-actions"><button class="native-button small" type="button" data-action="spotify-load-playlists">Load playlists</button><button class="native-button small" type="button" data-modal-close="spotify-library-modal">Close</button></div></footer>
      </section>`;
    document.body.appendChild(backdrop);
    state.spotifyModal = backdrop;
    return backdrop;
  }

  function displaySpotifyTracks(tracks) {
    const root = el('spotify-track-list');
    if (!root) return;
    state.spotifyTracks.clear();
    root.replaceChildren();
    if (!tracks.length) {
      const empty = document.createElement('div'); empty.className = 'empty-hint'; empty.textContent = 'No tracks found. Try another search or playlist.'; root.appendChild(empty); return;
    }
    tracks.forEach(track => {
      if (!track || !track.id) return;
      state.spotifyTracks.set(track.id, track);
      const row = document.createElement('div'); row.className = 'file-row';
      const name = document.createElement('span'); name.className = 'file-row-name'; name.textContent = track.name || 'Untitled track'; row.appendChild(name);
      const artist = document.createElement('span'); artist.className = 'file-row-meta'; artist.textContent = (track.artists || []).map(item => item.name).join(', '); row.appendChild(artist);
      const select = document.createElement('button'); select.className = 'native-button small'; select.type = 'button'; select.textContent = track.preview_url ? 'Use preview' : 'Preview unavailable'; select.disabled = !track.preview_url; select.dataset.action = 'spotify-select-track'; select.dataset.trackId = track.id; row.appendChild(select);
      root.appendChild(row);
    });
  }

  async function spotifyApi(path) {
    const response = await F.auth.requestSpotify(`https://api.spotify.com/v1/${path}`);
    return response.json();
  }

  async function openSpotifyLibrary() {
    const token = F.auth.state && F.auth.state.spotifyAccessToken;
    if (!token) {
      const started = await F.auth.connectSpotify();
      if (!started) toast('Connect Spotify to browse saved tracks and playlists.', 'warning');
      return;
    }
    const modal = addSpotifyModal();
    F.ui.openModal('spotify-library-modal');
    loadSpotifyPlaylists().catch(error => toast(error.message, 'error'));
  }

  async function loadSpotifyPlaylists() {
    const select = el('spotify-playlist-selector');
    if (!select) return;
    select.disabled = true;
    try {
      const data = await spotifyApi('me/playlists?limit=50');
      const items = data.items || [];
      select.replaceChildren(new Option('Choose a playlist', ''));
      items.forEach(playlist => select.add(new Option(`${playlist.name} (${playlist.tracks && playlist.tracks.total || 0})`, playlist.id)));
    } finally { select.disabled = false; }
  }

  async function loadSpotifyPlaylist(playlistId) {
    if (!playlistId) return;
    const data = await spotifyApi(`playlists/${encodeURIComponent(playlistId)}/tracks?limit=100`);
    displaySpotifyTracks((data.items || []).map(item => item.track).filter(Boolean));
  }

  async function loadSpotifyLibrary() {
    const data = await spotifyApi('me/tracks?limit=50');
    displaySpotifyTracks((data.items || []).map(item => item.track).filter(Boolean));
  }

  async function searchSpotify() {
    const query = (el('spotify-search-query')?.value || '').trim();
    if (!query) return toast('Enter a track name to search Spotify.', 'info');
    const data = await spotifyApi(`search?type=track&limit=25&q=${encodeURIComponent(query)}`);
    displaySpotifyTracks((data.tracks && data.tracks.items) || []);
  }

  async function addSpotifyPreview(trackId) {
    const track = state.spotifyTracks.get(trackId);
    if (!track || !track.preview_url) return toast('This track has no preview that can be mixed. Use a local audio file instead.', 'warning');
    try {
      await F.media.loadMusic(track.preview_url, { name: `${track.name || 'Spotify preview'}.mp3`, mimeType: 'audio/mpeg', source: 'spotify' });
      setMusicLabel(`${track.name} — ${(track.artists || []).map(item => item.name).join(', ')} (preview)`);
      syncUI();
      F.ui.closeModal('spotify-library-modal');
      toast('Spotify preview added as background music.', 'success');
    } catch (error) { toast(error.message || 'The Spotify preview could not be loaded.', 'error'); }
  }

  function downloadJson(name, value) {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = name; anchor.style.display = 'none';
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function snapshotPreset(name) {
    const media = F.media.getState();
    return {
      version: 1,
      name: String(name || 'Session preset').slice(0, 80),
      savedAt: new Date().toISOString(),
      trim: { in: state.edit.trimIn, out: state.edit.trimOut },
      edit: Object.assign({}, state.edit),
      markers: state.markers.map(marker => Object.assign({}, marker)),
      music: { name: media.musicMetadata && media.musicMetadata.name || '' },
      pnuberState: F.pnuber.getState(),
      layers: F.pnuber.getLayers().map(layer => ({ name: layer.name, assetName: layer.assetName, state: layer.state, x: layer.x, y: layer.y, scale: layer.scale, visible: layer.userVisible !== false })),
      loops: settingsValue().loops || {},
      customStates: settingsValue().customStates || [],
      shortcuts: F.shortcuts.getMap()
    };
  }

  async function savePreset() {
    const name = window.prompt('Name this session preset', `Preset ${((settingsValue().exportPresets || []).length || 0) + 1}`);
    if (name === null) return;
    const preset = snapshotPreset(name.trim() || 'Session preset');
    const settings = settingsValue();
    const presets = Array.isArray(settings.exportPresets) ? settings.exportPresets.slice() : [];
    preset.id = makeId();
    presets.push(preset);
    await F.settings.saveSettings({ exportPresets: presets.slice(-50) });
    syncUI();
    toast('Session preset saved to FSTuber settings. Export JSON to keep a separate copy.', 'success');
  }

  function applyPreset(preset) {
    if (!preset || typeof preset !== 'object') return toast('The selected preset could not be read.', 'error');
    state.edit = Object.assign({}, defaults, preset.edit || {}, {
      trimIn: Math.max(0, finite(preset.trim && preset.trim.in, 0)),
      trimOut: Math.max(0, finite(preset.trim && preset.trim.out, 0))
    });
    if (Array.isArray(preset.markers)) state.markers = preset.markers.map(marker => Object.assign({}, marker, { id: marker.id || makeId() }));
    let activeLoops = settingsValue().loops || {};
    if (preset.loops && typeof preset.loops === 'object') {
      try { activeLoops = sanitizeAnimationLoops(JSON.stringify(preset.loops)); }
      catch (error) { toast(`Preset animation loops were skipped: ${error.message}`, 'warning'); }
    }
    const customStates = Array.isArray(preset.customStates) ? preset.customStates.map(String).slice(0, 50) : (settingsValue().customStates || []);
    F.settings.saveSettings({ loops: activeLoops, customStates });
    if (preset.shortcuts && typeof preset.shortcuts === 'object') {
      Object.entries(preset.shortcuts).forEach(([key, value]) => F.shortcuts.assign(key, value));
    }
    if (Array.isArray(preset.layers)) {
      F.pnuber.clearLayers();
      F.pnuber.restoreLayers(preset.layers);
    }
    F.pnuber.setState(preset.pnuberState || 'idle', { source: 'preset' });
    syncUI(); renderFrame(); persistProjectState(true);
    if (preset.music && preset.music.name) toast(`Preset references “${preset.music.name}”. Re-select the audio file if it is not currently loaded.`, 'info');
    toast(`Loaded preset “${preset.name || 'Session preset'}”.`, 'success');
  }

  function loadSelectedPreset() {
    const select = el('preset-select');
    const presets = settingsValue().exportPresets || [];
    const preset = presets.find((item, index) => String(item.id || index) === String(select && select.value));
    if (!preset) return toast('Choose a saved session preset first.', 'warning');
    applyPreset(preset);
  }

  function exportSelectedPreset() {
    const select = el('preset-select');
    const presets = settingsValue().exportPresets || [];
    const preset = presets.find((item, index) => String(item.id || index) === String(select && select.value));
    if (!preset) return toast('Choose a saved session preset first.', 'warning');
    downloadJson('fstuber-session-preset.json', preset);
  }

  function importPreset() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'application/json,.json'; input.hidden = true;
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) { input.remove(); return; }
      try {
        const preset = JSON.parse(await file.text());
        if (!preset || typeof preset !== 'object' || !preset.edit && !preset.trim) throw new Error('This JSON does not look like an FSTuber session preset.');
        const list = settingsValue().exportPresets || [];
        preset.id = makeId();
        preset.name = String(preset.name || file.name.replace(/\.json$/i, '')).slice(0, 80);
        await F.settings.saveSettings({ exportPresets: [...list, preset].slice(-50) });
        syncUI();
        toast(`Imported preset “${preset.name}”.`, 'success');
      } catch (error) { toast(error.message || 'The preset JSON could not be imported.', 'error'); }
      finally { input.remove(); }
    }, { once: true });
    document.body.appendChild(input); input.click();
  }

  async function resetSettings() {
    F.ui.confirm('Reset FSTuber settings, appearance, shortcuts, and saved project preferences to their defaults? Local media files will not be changed.', async () => {
      await F.settings.reset();
      loadSettingsIntoState(settingsValue());
      state.history = []; state.historyIndex = -1; pushHistory();
      if (F.pnuber) F.pnuber.setVisible(true);
      syncUI(); renderFrame();
      toast('Settings were reset to defaults.', 'success');
    }, 'Reset settings');
  }

  function applyCustomCSS() {
    const input = el('custom-css-input');
    const message = el('custom-css-message');
    const css = input ? input.value : '';
    const validation = F.settings.validateCustomCSS(css);
    if (!validation.valid) {
      if (message) message.textContent = validation.reason;
      toast(validation.reason, 'warning');
      return;
    }
    if (!F.settings.applyCustomCSS(css)) {
      if (message) message.textContent = 'The CSS could not be applied; previous styles remain.';
      return;
    }
    F.settings.saveSettings({ customCSS: css });
    if (message) message.textContent = css.trim() ? 'Custom CSS applied and saved.' : 'Custom CSS cleared.';
  }

  function setTheme(theme) {
    const selected = theme === 'light' ? 'light' : 'dark';
    F.settings.saveSettings({ theme: selected });
    F.settings.applyTheme(selected);
    setStatus(`${selected === 'dark' ? 'Dark' : 'Light'} theme applied.`, 'success');
  }

  function saveClientIds() {
    const googleClientId = (el('google-client-id')?.value || '').trim();
    const spotifyClientId = (el('spotify-client-id')?.value || '').trim();
    F.settings.saveSettings({ googleClientId, spotifyClientId });
    syncUI();
    toast('Google and Spotify client IDs were saved. GitHub tokens remain session-only.', 'success');
  }

  function handleClientIdChange(detail) {
    if (detail.id === 'google-client-id') F.settings.saveSettings({ googleClientId: String(detail.value || '').trim() });
    if (detail.id === 'spotify-client-id') F.settings.saveSettings({ spotifyClientId: String(detail.value || '').trim() });
    syncUI();
  }

  async function handleConnectionAction(service, triggerElement) {
    const target = triggerElement || el(`${service}-connect-button`);
    if (target) F.ui.setLoading(target, true, service === 'google' ? 'Connecting Drive' : service === 'spotify' ? 'Connecting Spotify' : 'Connecting GitHub');
    try {
      if (service === 'google') {
        const input = el('google-client-id');
        if (input && input.value.trim() !== settingsValue().googleClientId) await F.settings.saveSettings({ googleClientId: input.value.trim() });
        await connectGoogleAndLoad();
      } else if (service === 'spotify') {
        const input = el('spotify-client-id');
        if (input && input.value.trim() !== settingsValue().spotifyClientId) await F.settings.saveSettings({ spotifyClientId: input.value.trim() });
        const success = await F.auth.connectSpotify();
        if (success) setStatus('Opening Spotify authorization…', 'busy');
      } else if (service === 'github') {
        const token = (el('github-token')?.value || '').trim();
        await F.auth.connectGitHub(token);
        if (F.auth.getGitHubToken()) refreshGitHub().catch(() => {});
      }
    } finally {
      if (target) F.ui.setLoading(target, false);
      syncUI();
    }
  }

  function disconnect(service) {
    F.auth.disconnect(service);
    if (service === 'google') { state.driveFiles = []; F.ui.renderFileList('drive-file-list', [], 'drive'); }
    if (service === 'spotify') state.spotifyTracks.clear();
    if (service === 'github') { state.githubFiles = []; F.media.clearThumbnails(); F.ui.renderFileList('github-file-list', [], 'github'); }
    syncUI();
    toast(`${service[0].toUpperCase()}${service.slice(1)} disconnected.`, 'info');
  }

  function setRecordingResolution(value) {
    state.recordResolution = ['720p', '1080p'].includes(value) ? value : 'source';
    F.settings.saveSettings({ recordingResolution: state.recordResolution });
    const node = el('record-resolution'); if (node) node.value = state.recordResolution;
  }

  async function saveExportProfile() {
    const nameNode = el('export-profile-name');
    const name = String(nameNode && nameNode.value || '').trim();
    if (!name || name.length > 48 || /[\x00-\x1f<>:"/\\|?*]/.test(name)) {
      return toast('Enter a profile name of 1–48 characters without file-path characters.', 'warning');
    }
    const format = el('export-format')?.value || 'webm';
    const formatInfo = F.recorder.getSupportedFormats().find(item => item.id === format);
    if (!formatInfo || !formatInfo.supported) return toast(formatInfo?.reason || 'That export format is unavailable.', 'warning');
    const resolution = format === 'gif' ? 'source' : (el('export-resolution')?.value || 'source');
    const profiles = Array.isArray(settingsValue().exportProfiles) ? [...settingsValue().exportProfiles] : [];
    const existingIndex = profiles.findIndex(profile => String(profile.name || '').toLocaleLowerCase() === name.toLocaleLowerCase());
    const profile = {
      id: existingIndex >= 0 ? profiles[existingIndex].id : makeId(),
      name,
      format,
      resolution
    };
    if (existingIndex >= 0) profiles.splice(existingIndex, 1, profile);
    else profiles.push(profile);
    await F.settings.saveSettings({ exportProfiles: profiles });
    F.ui.renderExportProfiles(profiles);
    const select = el('export-profile-select'); if (select) select.value = profile.id;
    if (nameNode) nameNode.value = '';
    toast(`Export profile “${name}” saved.`, 'success');
  }

  function applyExportProfile(id) {
    if (!id) return;
    const profiles = Array.isArray(settingsValue().exportProfiles) ? settingsValue().exportProfiles : [];
    const profile = profiles.find(item => String(item.id || item.name) === String(id));
    if (!profile) return toast('That export profile could not be found.', 'warning');
    const formatInfo = F.recorder.getSupportedFormats().find(item => item.id === profile.format);
    if (!formatInfo || !formatInfo.supported) return toast(formatInfo?.reason || 'That export format is unavailable.', 'warning');
    const formatNode = el('export-format');
    const resolutionNode = el('export-resolution');
    if (formatNode) {
      formatNode.value = profile.format;
      formatNode.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (resolutionNode) resolutionNode.value = profile.format === 'gif' ? 'source' : (profile.resolution || 'source');
    const select = el('export-profile-select'); if (select) select.value = profile.id || profile.name;
    F.ui.setStatus(`Export profile selected: ${profile.name}.`, 'info');
  }

  async function startRecording() {
    if (!F.recorder.isSupported()) return toast('Recording is unavailable in this browser. Use a browser with canvas capture and MediaRecorder support.', 'error');
    const media = F.media.getState();
    const video = media.videoEl;
    if (!video || !(video.currentSrc || video.srcObject || video.src)) return toast('Load a video or start a screen share before recording.', 'warning');
    state.isRecording = true;
    state.recordedResolution = state.recordResolution;
    try {
      if (video.srcObject) {
        if (video.paused) await video.play();
        const music = media.musicEl;
        if (music && (music.currentSrc || music.src)) {
          music.currentTime = 0;
          try { await music.play(); }
          catch (_) { toast('Background music could not start. Recording will continue without it.', 'warning'); }
        }
        const started = await F.recorder.startRecording({ replay: false, resolution: state.recordResolution });
        if (!started) { state.isRecording = false; if (music) music.pause(); }
      } else {
        const trimEnd = state.edit.trimOut || durationNow();
        const blob = await F.recorder.recordReplay({ trimIn: state.edit.trimIn, trimOut: trimEnd, resolution: state.recordResolution });
        if (!blob && !state.isRecording) state.isRecording = false;
      }
    } catch (error) {
      state.isRecording = false;
      toast(error.message || 'Recording could not start.', 'error');
      F.ui.setRecordingStatus(false);
    }
  }

  async function stopRecording() {
    if (!state.isRecording) return;
    try {
      await F.recorder.stopRecording();
      const media = F.media.getState();
      if (media.videoEl && media.videoEl.srcObject && media.musicEl) media.musicEl.pause();
    }
    catch (error) { toast(error.message || 'Recording could not stop cleanly.', 'error'); }
  }

  async function saveRecording(detail) {
    if (!detail || !F.recorder.getLastBlob()) return toast('There is no recording to save.', 'warning');
    const requestedFormat = String(detail.format || 'webm').toLowerCase();
    const requestedResolution = detail.resolution || state.recordedResolution || 'source';
    if (requestedFormat === 'webm' && requestedResolution !== state.recordedResolution) {
      toast(`This recording was captured at ${state.recordedResolution}. Choose that resolution or record again at ${requestedResolution}.`, 'error');
      F.ui.openRename(detail.destination || 'local');
      return;
    }
    const options = { format: requestedFormat, resolution: requestedResolution, duration: state.recordedDuration, blob: F.recorder.getLastBlob() };
    try {
      F.ui.setStatus(detail.destination === 'drive' ? 'Uploading a new file to FSTuber/…' : 'Preparing local download…', 'busy');
      if (detail.destination === 'drive') {
        if (!F.auth.getGoogleAccessToken()) {
          F.ui.openSettings('api-setup', 'google-client-id');
          return toast('Connect Google Drive before saving to Drive.', 'warning');
        }
        await F.recorder.saveDrive(detail.name, options);
      } else {
        await F.recorder.saveLocal(detail.name, options);
      }
    } catch (error) {
      toast(error.message || 'The recording could not be saved.', 'error');
      F.ui.setStatus('Save failed. Your preview is still available.', 'error');
    }
  }

  function attachDriveLink(detail) {
    const status = document.querySelector('.statusbar-right');
    if (!status || !detail || detail.destination !== 'drive' || !detail.url) return;
    let link = el('drive-open-link');
    if (!link) {
      link = document.createElement('a');
      link.id = 'drive-open-link';
      link.className = 'statusbar-item';
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      status.prepend(link);
    }
    link.href = detail.url;
    link.textContent = 'Open in Drive';
    link.title = detail.path || detail.filename || 'Open the saved file in Google Drive';
  }

  function confirmDiscardRecording() {
    F.ui.confirm('Discard this unsaved recording? The original media and project remain unchanged, but this recording preview will be removed.', async () => {
      if (F.recorder && F.recorder.discardLastRecording) await F.recorder.discardLastRecording();
      if (F.ui.clearRecordingPreview) F.ui.clearRecordingPreview();
      state.hasUnsavedRecording = false;
      state.isRecording = false;
      setStatus('Unsaved recording discarded.');
      toast('Recording discarded. Original media remains unchanged.', 'info');
    }, 'Discard recording');
  }

  async function clearAssets() {
    F.ui.confirm('Clear all loaded media, overlays and streams? Unsaved recording previews will also be discarded. Original files on disk are not changed.', async () => {
      pause();
      if (F.recorder && F.recorder.discardLastRecording) await F.recorder.discardLastRecording();
      if (F.ui.clearRecordingPreview) F.ui.clearRecordingPreview();
      state.hasUnsavedRecording = false;
      state.localFiles = [];
      state.driveFiles = [];
      state.githubFiles = [];
      if (F.media) F.media.clearAssets();
      if (F.pnuber) F.pnuber.clear();
      state.edit = Object.assign({}, defaults);
      state.markers = [];
      state.pendingVideoName = '';
      F.ui.renderFileList('local-file-list', [], 'local');
      F.ui.renderFileList('drive-file-list', [], 'drive');
      F.ui.renderFileList('github-file-list', [], 'github');
      setMusicLabel('');
      updateCanvasSize();
      syncUI(); renderFrame(); persistProjectState(true);
      toast('Loaded media and overlays cleared. Original files were not changed.', 'success');
    }, 'Clear all assets');
  }

  async function withButtonLoading(button, label, operation) {
    if (button) F.ui.setLoading(button, true, label);
    try { return await operation(); }
    finally { if (button) F.ui.setLoading(button, false); }
  }

  async function handleAction(detail) {
    const action = detail.action;
    try {
      if (action === 'play-pause') return togglePlayback();
      if (action === 'stop') { pause(); seek(state.edit.trimIn); return; }
      if (action === 'toggle-video-mute') { state.videoMuted = !state.videoMuted; updateVolumes(); persistProjectState(); return; }
      if (action === 'toggle-music-mute') { state.musicMuted = !state.musicMuted; updateVolumes(); persistProjectState(); return; }
      if (action === 'toggle-loop') {
        state.loopEnabled = !state.loopEnabled;
        const button = el('loop-button'); if (button) button.setAttribute('aria-pressed', String(state.loopEnabled));
        persistProjectState(); return;
      }
      if (action === 'screen-share') {
        state.pendingVideoName = 'Screen share'; state.pendingVideoRestore = false;
        await F.media.startScreenShare();
        updateCanvasSize(); syncUI(); setStatus('Screen sharing is ready to record.', 'success'); return;
      }
      if (action === 'refresh-drive') return refreshDrive();
      if (action === 'refresh-github') return refreshGitHub();
      if (action === 'connect-google') return handleConnectionAction('google', detail.element);
      if (action === 'connect-spotify') return handleConnectionAction('spotify', detail.element);
      if (action === 'connect-github') return handleConnectionAction('github', detail.element);
      if (action.startsWith('disconnect-')) return disconnect(action.slice('disconnect-'.length));
      if (action === 'spotify-library') return openSpotifyLibrary();
      if (action === 'spotify-load-playlists') return withButtonLoading(detail.element, 'Loading playlists', () => loadSpotifyPlaylists()).catch(error => toast(error.message, 'error'));
      if (action === 'spotify-load-library') return withButtonLoading(detail.element, 'Loading saved tracks', () => loadSpotifyLibrary()).catch(error => toast(error.message, 'error'));
      if (action === 'spotify-search') return withButtonLoading(detail.element, 'Searching', () => searchSpotify()).catch(error => toast(error.message, 'error'));
      if (action === 'spotify-select-track') return addSpotifyPreview(detail.element && detail.element.dataset.trackId || detail.id);
      if (action === 'record-replay') return startRecording();
      if (action === 'stop-recording') return stopRecording();
      if (action === 'discard-recording') return confirmDiscardRecording();
      if (action === 'open-recording-preview') {
        if (!F.ui.reopenRecordingPreview()) toast('There is no recording preview to reopen.', 'info');
        return;
      }
      if (action === 'save-api-setup') return saveClientIds();
      if (action === 'save-animation-loops') return saveAnimationLoops();
      if (action === 'save-export-profile') return saveExportProfile();
      if (action === 'export-profile-change') return applyExportProfile(detail.value);
      if (action === 'client-id-change') return handleClientIdChange(detail);
      if (action === 'set-theme') return setTheme(detail.value);
      if (action === 'apply-css') return applyCustomCSS();
      if (action === 'reset-settings') return resetSettings();
      if (action === 'default-volume') {
        const key = detail.id === 'default-video-volume' ? 'videoVolume' : 'musicVolume';
        const value = clamp(detail.value, 0, 1);
        F.settings.saveSettings({ [key]: value });
        const output = el(key === 'videoVolume' ? 'default-video-value' : 'default-music-value'); if (output) output.textContent = `${Math.round(value * 100)}%`;
        return;
      }
      if (action === 'github-token-change') return;
      if (action === 'clear-assets') return clearAssets();
      if (action === 'add-layer') {
        const assets = F.pnuber.getAssets();
        if (!assets.length) { el('local-images').click(); return; }
        F.pnuber.addLayer(assets[assets.length - 1].name); syncUI(); return;
      }
      if (action === 'toggle-pnuber') {
        const visible = F.pnuber.toggleVisibility();
        const button = document.querySelector('[data-action="toggle-pnuber"]');
        if (button) button.textContent = visible ? 'Hide overlays' : 'Show overlays';
        return;
      }
      if (action === 'set-pnuber-state') {
        const target = el('pnuber-state-select')?.value || 'idle';
        F.pnuber.setState(target, { source: 'manual' }); syncUI(); return;
      }
      if (action === 'reset-trim') {
        pushHistory(); state.edit.trimIn = 0; state.edit.trimOut = durationNow(); pushHistory();
        syncUI(); seek(0); persistProjectState(); return;
      }
      if (action === 'reset-adjustments') {
        pushHistory();
        state.edit.brightness = 100; state.edit.contrast = 100; state.edit.saturation = 100;
        state.edit.text = ''; state.edit.textEnabled = false; state.edit.textSize = 32; state.edit.textColor = '#ffffff'; state.edit.textPosition = 'bottom';
        pushHistory(); syncUI(); renderFrame(); persistProjectState(); return;
      }
      if (action === 'undo') return undo();
      if (action === 'redo') return redo();
      if (action === 'add-marker') return addMarker();
      if (action === 'collapse-left') return F.ui.togglePanel('left');
      if (action === 'collapse-right') return F.ui.togglePanel('right');
      if (action === 'fit-preview') { updateCanvasSize(); renderFrame(); return; }
      if (action === 'change-shortcut') return captureNewShortcut(detail.element && detail.element.dataset.key || detail.id || '');
      if (action === 'add-shortcut') return addShortcut();
      if (action === 'export-shortcuts') { F.shortcuts.exportMap(); return toast('Shortcut mapping downloaded as JSON.', 'success'); }
      if (action === 'save-preset') return savePreset();
      if (action === 'load-preset') return loadSelectedPreset();
      if (action === 'export-preset') return exportSelectedPreset();
      if (action === 'import-preset') return importPreset();
      if (action === 'dismiss-onboarding') { F.settings.saveSettings({ onboardingDismissed: true }); return; }
      if (action === 'spotify-select-track') return addSpotifyPreview(detail.id);
    } catch (error) {
      toast(error && error.message ? error.message : 'The requested action could not be completed.', 'error');
    }
  }

  function captureNewShortcut(oldKey) {
    if (state.captureShortcut) return;
    state.captureShortcut = String(oldKey || '');
    toast(`Press the new key for ${state.captureShortcut}, or Escape to cancel.`, 'info');
    const capture = event => {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopImmediatePropagation();
        document.removeEventListener('keydown', capture, true);
        state.captureShortcut = null;
        return toast('Shortcut change canceled.', 'info');
      }
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.key.length !== 1) return;
      event.preventDefault(); event.stopImmediatePropagation();
      document.removeEventListener('keydown', capture, true);
      const previous = F.shortcuts.getMap()[state.captureShortcut] || { state: 'idle', mode: 'hold' };
      const old = state.captureShortcut;
      F.shortcuts.remove(old);
      const assigned = F.shortcuts.assign(event.key, previous);
      state.captureShortcut = null;
      syncUI();
      if (assigned) toast(`Shortcut changed to ${event.key}.`, 'success');
    };
    document.addEventListener('keydown', capture, true);
  }

  function addShortcut() {
    const key = window.prompt('Enter one key for the new shortcut. Reserved keys include Space, arrows, ?, and V.');
    if (!key) return;
    const stateName = window.prompt('Assign a state or loaded image name', 'idle');
    if (!stateName) return;
    if (F.shortcuts.assign(key, { state: stateName.trim(), mode: 'hold' })) syncUI();
  }

  function sanitizeAnimationLoops(text) {
    let parsed;
    try { parsed = JSON.parse(text || '{}'); }
    catch (_) { throw new Error('Enter valid JSON for the animation loops.'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Animation loops must be a JSON object keyed by state name.');
    const entries = Object.entries(parsed);
    if (entries.length > 32) throw new Error('Use no more than 32 custom states.');
    const loops = {};
    entries.forEach(([rawName, definition]) => {
      const name = String(rawName || '').trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9 _-]{0,39}$/i.test(name)) throw new Error(`“${rawName}” is not a valid state name.`);
      if (!definition || typeof definition !== 'object' || Array.isArray(definition) || !Array.isArray(definition.frames)) throw new Error(`State “${name}” must define a frames array.`);
      if (definition.frames.length < 2 || definition.frames.length > 100) throw new Error(`State “${name}” needs 2 to 100 image frames.`);
      const frames = definition.frames.map(frame => {
        const candidate = typeof frame === 'string' ? frame : frame && (frame.assetName || frame.image || frame.name);
        const filename = String(candidate || '').trim();
        if (!filename || /[\\/\u0000-\u001f]/.test(filename) || filename.includes('..')) throw new Error(`State “${name}” contains an invalid frame name.`);
        return filename.replace(/\.(png|jpe?g|gif|apng|webp)$/i, '');
      });
      const fps = Number(definition.fps || 8);
      if (!Number.isFinite(fps) || fps < 1 || fps > 30) throw new Error(`State “${name}” FPS must be from 1 to 30.`);
      loops[name] = { frames, fps, repeat: definition.repeat !== false };
    });
    return loops;
  }

  async function saveAnimationLoops() {
    const input = el('animation-loops-json');
    const message = el('animation-loop-message');
    try {
      const loops = sanitizeAnimationLoops(input ? input.value : '{}');
      const customStates = Array.from(new Set([...(settingsValue().customStates || []), ...Object.keys(loops)])).slice(0, 50);
      await F.settings.saveSettings({ loops, customStates });
      if (F.pnuber) F.pnuber.setState(F.pnuber.getState(), { source: 'loops-updated' });
      if (message) message.textContent = 'Animation loops saved.';
      syncUI();
      toast('Animation loops saved to settings.', 'success');
    } catch (error) {
      if (message) message.textContent = error.message || 'The animation loops could not be saved.';
      toast(error.message || 'The animation loops could not be saved.', 'error');
    }
  }

  function handleLayerAction(detail) {
    if (!detail) return;
    if (detail.action === 'visibility') F.pnuber.setLayerVisibility(detail.id, detail.value);
    if (detail.action === 'remove') F.pnuber.removeLayer(detail.id);
    syncUI();
  }

  function handleDynamicChange(event) {
    const target = event.target;
    if (!target) return;
    if (target.id === 'record-resolution') { setRecordingResolution(target.value); return; }
    if (target.id === 'show-recording-fps') {
      state.showFps = Boolean(target.checked);
      F.settings.saveSettings({ showRecordingFps: state.showFps });
      if (!state.showFps) { const fps = el('status-fps'); if (fps) fps.textContent = ''; }
      return;
    }
    if (target.id === 'spotify-playlist-selector') { loadSpotifyPlaylist(target.value).catch(error => toast(error.message, 'error')); return; }
    const key = target.dataset && (target.dataset.shortcutTarget || target.dataset.shortcutMode);
    if (key) {
      const current = F.shortcuts.getMap()[key] || { state: 'idle', mode: 'hold' };
      const stateName = target.dataset.shortcutTarget ? target.value : current.state;
      const mode = target.dataset.shortcutMode ? target.value : current.mode;
      F.shortcuts.assign(key, { state: stateName, mode });
      syncUI();
    }
    if (target.id === 'settings-background-color') {
      state.edit.backgroundColor = target.value;
      const input = el('background-color'); if (input) input.value = target.value;
      renderFrame(); persistProjectState();
    }
  }

  function handleWindowEvent(type, detail) {
    if (type === 'fstuber:action') return handleAction(detail || {});
    if (type === 'fstuber:control') return handleControl(detail || {});
    if (type === 'fstuber:files') return loadLocalFiles(detail && detail.files || [], detail && detail.kind);
    if (type === 'fstuber:file-select') return selectMediaFile(detail && detail.source || 'local', Number(detail && detail.index));
    if (type === 'fstuber:asset-add') {
      if (detail && detail.asset && F.pnuber) { F.pnuber.addLayer(detail.asset.name); syncUI(); }
      return;
    }
    if (type === 'fstuber:layer-action') return handleLayerAction(detail);
    if (type === 'fstuber:marker-action') return handleMarkerAction(detail);
    if (type === 'fstuber:source') return switchSource(detail);
    if (type === 'fstuber:saveconfirmed') return saveRecording(detail);
    if (type === 'fstuber:open-settings') {
      const info = detail || {};
      F.ui.openSettings(info.section || 'api-setup', info.fieldId || '');
      return;
    }
    if (type === 'fstuber:mediachange') {
      const operation = detail && detail.operation || '';
      const media = detail && detail.state || F.media.getState();
      if (operation === 'video-metadata' || operation === 'duration') {
        const name = media.videoFileName || '';
        if (state.pendingVideoRestore && name && name === state.pendingVideoName) {
          state.pendingVideoRestore = false;
        } else if (durationNow() > 0) {
          state.edit.trimIn = 0; state.edit.trimOut = durationNow();
          state.pendingVideoRestore = false;
        }
      }
      if (operation === 'cleared') {
        state.edit = Object.assign({}, defaults); state.markers = [];
      }
      updateCanvasSize(); syncUI(); renderFrame();
      return;
    }
    if (type === 'fstuber:assetschange') { syncUI(); renderFrame(); return; }
    if (type === 'fstuber:recording-status') {
      const status = detail && detail.status || '';
      state.isRecording = status === 'recording' || status === 'stopping';
      F.ui.setRecordingStatus(detail || false);
      if (status === 'recording') F.ui.setStatus('Recording the preview composition…', 'busy');
      if (status === 'ready') { state.isRecording = false; syncUI(); F.ui.setStatus('Recording preview is ready.', 'success'); }
      if (status === 'error' || status === 'unsupported') { state.isRecording = false; F.ui.setStatus(detail.message || 'Recording failed.', 'error'); }
      if (status === 'ready' || status === 'error' || status === 'unsupported' || status === 'save-error') {
        const fps = el('status-fps'); if (fps) fps.textContent = '';
        updateDriveProgress(0, false);
      }
      if (!state.isRecording) updateCanvasSize();
      return;
    }
    if (type === 'fstuber:recording-preview') {
      state.hasUnsavedRecording = true;
      const estimatedDuration = Math.max(0, state.edit.trimOut - state.edit.trimIn);
      state.recordedDuration = Number(detail && detail.duration) > 0 ? Number(detail.duration) : estimatedDuration;
      if (detail && detail.blob && F.ui.showRecordingPreview) {
        F.ui.showRecordingPreview(detail.blob, { url: detail.url, format: detail.type, duration: state.recordedDuration, resolution: state.recordedResolution });
      }
      return;
    }
    if (type === 'fstuber:recording-started') {
      state.isRecording = true;
      const resolution = detail && detail.resolution;
      if (resolution && resolution.width && resolution.height) state.recordedResolution = state.recordResolution;
      return;
    }
    if (type === 'fstuber:recording-saved') {
      state.hasUnsavedRecording = false;
      attachDriveLink(detail);
      updateDriveProgress(detail && detail.destination === 'drive' ? 100 : 0, detail && detail.destination === 'drive');
      window.setTimeout(() => updateDriveProgress(0, false), 1500);
      const actualName = detail && (detail.filename || detail.path) || 'recording';
      F.settings.saveSettings({ lastExportName: actualName.split('/').pop(), lastExportPath: detail && detail.path || actualName });
      setStatus(detail && detail.path ? `Saved to ${detail.path}.` : `Download started: ${actualName}.`, 'success');
      if (detail && detail.url) toast(`Saved to ${detail.path || actualName}.`, 'success');
      return;
    }
    if (type === 'fstuber:drive-upload-progress') {
      state.uploadProgress = detail && Number.isFinite(detail.percent) ? detail.percent : 0;
      updateDriveProgress(state.uploadProgress, true);
      F.ui.setStatus(state.uploadProgress ? `Uploading to FSTuber/: ${state.uploadProgress}%.` : 'Uploading to FSTuber/…', 'busy');
      return;
    }
    if (type === 'fstuber:connection-status') { syncUI(); return; }
    if (type === 'fstuber:shortcuts:changed') { syncUI(); persistProjectState(); return; }
    if (type === 'fstuber:pnuber:layers-changed') { syncUI(); return; }
    if (type === 'fstuber:pnuber:visibility-changed') {
      const button = document.querySelector('[data-action="toggle-pnuber"]');
      if (button) button.textContent = detail && detail.visible ? 'Hide overlays' : 'Show overlays';
      return;
    }
  }

  function addTimelineInteractions() {
    const ruler = el('timeline-ruler');
    if (ruler) ruler.addEventListener('click', event => {
      if (event.target.closest('.timeline-marker')) return;
      const rect = ruler.getBoundingClientRect();
      if (rect.width > 0 && durationNow() > 0) seek(((event.clientX - rect.left) / rect.width) * durationNow());
    });
    const canvas = el('preview-canvas');
    if (!canvas || !F.pnuber) return;
    canvas.addEventListener('pointerdown', event => {
      const rect = canvas.getBoundingClientRect();
      if (F.pnuber.pointerDown(event, rect) && canvas.setPointerCapture) canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', event => F.pnuber.pointerMove(event, canvas.getBoundingClientRect()));
    const finish = () => { if (F.pnuber.pointerUp()) { syncUI(); persistProjectState(); } };
    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', finish);
  }

  function bindMediaEvents() {
    const video = videoElement();
    if (!video || video.dataset.fstuberAppEvents === 'true') return;
    video.dataset.fstuberAppEvents = 'true';
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('durationchange', handleTimeUpdate);
    video.addEventListener('loadedmetadata', handleTimeUpdate);
    video.addEventListener('play', () => F.ui.updateTransport(timeNow(), durationNow(), true));
    video.addEventListener('pause', () => F.ui.updateTransport(timeNow(), durationNow(), false));
    video.addEventListener('ended', handleTimeUpdate);
    const music = musicElement();
    if (music && music.dataset.fstuberAppEvents !== 'true') {
      music.dataset.fstuberAppEvents = 'true';
      music.addEventListener('ended', () => { if (state.loopEnabled && isPlaying()) { music.currentTime = 0; music.play().catch(() => {}); } });
    }
  }

  function setupEventBridge() {
    [
      'fstuber:action', 'fstuber:control', 'fstuber:files', 'fstuber:file-select', 'fstuber:asset-add',
      'fstuber:layer-action', 'fstuber:marker-action', 'fstuber:source', 'fstuber:saveconfirmed',
      'fstuber:open-settings', 'fstuber:mediachange', 'fstuber:assetschange', 'fstuber:recording-status',
      'fstuber:recording-preview', 'fstuber:recording-started', 'fstuber:recording-saved',
      'fstuber:drive-upload-progress', 'fstuber:connection-status', 'fstuber:shortcuts:changed',
      'fstuber:pnuber:layers-changed', 'fstuber:pnuber:visibility-changed'
    ].forEach(type => window.addEventListener(type, event => handleWindowEvent(type, event.detail)));
    document.addEventListener('change', handleDynamicChange);
    document.addEventListener('click', event => {
      const button = event.target.closest('[data-action="dismiss-onboarding"]');
      if (button) F.settings.saveSettings({ onboardingDismissed: true });
      const close = event.target.closest('[data-modal-close="onboarding-modal"]');
      if (close) F.settings.saveSettings({ onboardingDismissed: true });
    });
  }

  function bindToolbar() {
    F.ui.togglePlayback = togglePlayback;
    F.ui.seekBy = seekBy;
    F.ui.videoElement = videoElement();
    F.ui.seekStep = 5;
    const undoButton = document.querySelector('[data-action="undo"]');
    const redoButton = document.querySelector('[data-action="redo"]');
    if (undoButton) undoButton.setAttribute('aria-keyshortcuts', 'Ctrl+Z');
    if (redoButton) redoButton.setAttribute('aria-keyshortcuts', 'Ctrl+Shift+Z');
  }

  async function init() {
    if (!F.ui || !F.settings || !F.media || !F.auth || !F.recorder || !F.pnuber || !F.shortcuts) {
      const appRoot = el('app');
      if (appRoot) appRoot.textContent = 'FSTuber could not start because a required module is missing. Reload the page and try again.';
      return;
    }
    let firstLaunch = false;
    try { firstLaunch = !window.localStorage.getItem('fstuber-settings'); } catch (_) { firstLaunch = true; }
    F.ui.renderShell();
    if (window.matchMedia && window.matchMedia('(max-width: 780px)').matches) {
      el('sidebar')?.classList.add('collapsed');
      el('inspector')?.classList.add('panel-collapsed');
      el('workspace')?.classList.add('left-collapsed', 'right-collapsed');
    }
    F.media.init();
    F.pnuber.init && F.pnuber.init();
    const saved = await F.settings.loadSettings();
    loadSettingsIntoState(saved);
    if (F.pnuber.restoreLayers) F.pnuber.restoreLayers();
    F.shortcuts.init();
    setupEventBridge();
    bindToolbar();
    addTimelineInteractions();
    bindMediaEvents();
    const githubToken = F.auth.getGitHubToken();
    if (githubToken) F.auth.connectGitHub(githubToken).then(syncUI).catch(() => {});
    F.auth.checkSpotifyCallback().then(syncUI).catch(() => {});
    syncUI();
    pushHistory();
    updateCanvasSize();
    renderFrame();
    if (!animationFrame) animationFrame = window.requestAnimationFrame(animationLoop);
    if (firstLaunch && !saved.onboardingDismissed) window.setTimeout(() => F.ui.openModal('onboarding-modal'), 350);
    setStatus('Local editing is ready. Connect Drive only when you want cloud files.', 'success');
  }

  F.appState = state;
  F.renderFrame = renderFrame;
  F.seek = seek;
  F.seekBy = seekBy;
  F.togglePlayback = togglePlayback;
  F.getRecordResolution = () => state.recordResolution;
  F.init = init;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => init().catch(error => toast(error.message, 'error')), { once: true });
  else init().catch(error => toast(error.message || 'FSTuber could not start.', 'error'));
})(window, document);
