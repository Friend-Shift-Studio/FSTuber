/*
 * FSTuber recorder module
 * Responsibility: capture the composed preview canvas and mixed audio, replay
 * trim-bounded media, expose recording status/preview events, and save confirmed
 * exports locally or to the user's Google Drive without modifying source media.
 */
(function installRecorder(global) {
  'use strict';

  const root = global.FSTuber = global.FSTuber || {};
  const moduleState = {
    recorder: null,
    chunks: [],
    lastBlob: null,
    previewUrl: null,
    sourceCanvasSize: null,
    recordingResolution: null,
    captureStream: null,
    captureVideoTracks: [],
    audioStream: null,
    recordingStartedAt: 0,
    recordingTimer: null,
    replayTimer: null,
    stopPromise: null,
    replayPromise: null,
    explicitStop: false,
    ffmpeg: null,
    ffmpegLoad: null,
    gifLoad: null,
    localNames: new Set(),
  };

  const DEFAULT_MAX_BLOB_BYTES = 1024 * 1024 * 1024;
  const DRIVE_API = 'https://www.googleapis.com/drive/v3';
  const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files';
  const FFMPEG_VERSION = '0.12.10';
  const FFMPEG_CORE_VERSION = '0.12.6';

  function getSettings() {
    try {
      const value = root.settings && typeof root.settings.get === 'function'
        ? root.settings.get()
        : {};
      return value && typeof value === 'object' ? value : {};
    } catch (_) {
      return {};
    }
  }

  function getMediaState() {
    try {
      return root.media && typeof root.media.getState === 'function'
        ? (root.media.getState() || {})
        : {};
    } catch (_) {
      return {};
    }
  }

  function getCanvas() {
    return global.document && global.document.querySelector
      ? global.document.querySelector('#preview-canvas')
      : null;
  }

  function dispatch(name, detail) {
    if (!global.dispatchEvent || typeof global.CustomEvent !== 'function') return;
    try {
      global.dispatchEvent(new global.CustomEvent(name, { detail: detail || {} }));
    } catch (_) {
      // Events are an optional integration point; recording itself must continue.
    }
  }

  function notify(message, type) {
    const ui = root.ui || {};
    if (typeof ui.toast === 'function') {
      try { ui.toast(message, type || 'info'); return; } catch (_) { /* fallback below */ }
    }
    if (typeof root.toast === 'function') {
      try { root.toast(message, type || 'info'); return; } catch (_) { /* fallback below */ }
    }
    dispatch('fstuber:toast', { message, type: type || 'info' });
  }

  function setStatus(status, extra) {
    const detail = Object.assign({ status }, extra || {});
    const ui = root.ui || {};
    if (typeof ui.setRecordingStatus === 'function') {
      try { ui.setRecordingStatus(detail); } catch (_) { /* event remains available */ }
    }
    if (typeof root.setRecordingStatus === 'function') {
      try { root.setRecordingStatus(detail); } catch (_) { /* event remains available */ }
    }
    dispatch('fstuber:recording-status', detail);
  }

  function isSupported() {
    const canvas = getCanvas();
    return Boolean(
      canvas && typeof canvas.captureStream === 'function' &&
      typeof global.MediaRecorder === 'function' &&
      global.MediaRecorder.isTypeSupported
    );
  }

  function getVideoElement() {
    return getMediaState().videoEl || null;
  }

  function getMusicElement() {
    return getMediaState().musicEl || null;
  }

  function readTrim(settings, video, options) {
    const opts = options || {};
    const edit = settings.edit || {};
    const trim = settings.trim || edit.trim || {};
    const state = getMediaState();
    const metadata = state.metadata || {};
    const duration = Number(video && video.duration) || Number(metadata.duration) || 0;
    const startValue = opts.trimIn ?? opts.trimStart ?? opts.inPoint ??
      trim.in ?? trim.start ?? settings.trimIn ?? settings.trimStart ?? edit.trimIn ?? edit.trimStart ?? 0;
    const endValue = opts.trimOut ?? opts.trimEnd ?? opts.outPoint ??
      trim.out ?? trim.end ?? settings.trimOut ?? settings.trimEnd ?? edit.trimOut ?? edit.trimEnd ?? duration;
    const start = Math.max(0, Number(startValue) || 0);
    let end = Number(endValue);
    if (!Number.isFinite(end) || end <= 0) end = duration;
    if (duration > 0) end = Math.min(end, duration);
    return { start, end, duration };
  }

  function maxBlobBytes() {
    const settings = getSettings();
    const configured = Number(settings.maxRecordingBytes || settings.recordingMaxBytes);
    return Number.isFinite(configured) && configured > 0
      ? Math.min(configured, DEFAULT_MAX_BLOB_BYTES)
      : DEFAULT_MAX_BLOB_BYTES;
  }

  function chooseMimeType() {
    const candidates = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      'video/mp4',
    ];
    for (const mime of candidates) {
      try {
        if (global.MediaRecorder.isTypeSupported(mime)) return mime;
      } catch (_) { /* test the next candidate */ }
    }
    return '';
  }

  function getAspectRatio(canvas, video) {
    const state = getMediaState();
    const metadata = state.metadata || {};
    const width = Number(video && video.videoWidth) || Number(metadata.videoWidth) || canvas.width || 16;
    const height = Number(video && video.videoHeight) || Number(metadata.videoHeight) || canvas.height || 9;
    return width / Math.max(1, height);
  }

  function even(value) {
    return Math.max(2, Math.round(value / 2) * 2);
  }

  function targetCanvasSize(canvas, video, resolution) {
    const originalWidth = Number(canvas && canvas.width) || Number(video && video.videoWidth) || 1280;
    const originalHeight = Number(canvas && canvas.height) || Number(video && video.videoHeight) || Math.round(originalWidth / getAspectRatio(canvas, video));
    const ratio = originalWidth / Math.max(1, originalHeight);
    const normalized = String(resolution || 'source').toLowerCase();
    if (normalized === 'source' || normalized === 'match-source' || normalized === 'match source') {
      return { width: even(originalWidth), height: even(originalHeight) };
    }
    let maxWidth = 1280;
    let maxHeight = 720;
    if (normalized === '1080p' || normalized === '1080') {
      maxWidth = 1920;
      maxHeight = 1080;
    } else if (normalized !== '720p' && normalized !== '720') {
      return { width: even(canvas.width || originalWidth), height: even(canvas.height || originalHeight) };
    }
    const scale = Math.min(maxWidth / originalWidth, maxHeight / originalHeight);
    return {
      width: even(originalWidth * scale),
      height: even(originalHeight * scale),
    };
  }

  function notifyPreview(blob) {
    if (moduleState.previewUrl) {
      try { global.URL.revokeObjectURL(moduleState.previewUrl); } catch (_) { /* ignore */ }
    }
    moduleState.previewUrl = global.URL.createObjectURL(blob);
    const detail = {
      blob,
      url: moduleState.previewUrl,
      type: blob.type,
      size: blob.size,
      duration: Math.max(0, (Date.now() - moduleState.recordingStartedAt) / 1000),
      resolution: moduleState.recordingResolution
    };
    dispatch('fstuber:recording-preview', detail);
  }

  function startStatusTimer() {
    if (moduleState.recordingTimer !== null) global.cancelAnimationFrame(moduleState.recordingTimer);
    moduleState.recordingStartedAt = Date.now();
    let lastAt = performance.now();
    let frames = 0;
    let lastReport = lastAt;
    const settings = getSettings();
    const fpsEnabled = Boolean(
      settings.showRecordingFps || settings.recordingFps || settings.showFpsDuringRecording ||
      (settings.recording && settings.recording.showFps)
    );
    const countFrame = () => {
      const now = performance.now();
      frames += 1;
      if (fpsEnabled && now - lastReport >= 1000) {
        setStatus('recording', {
          elapsed: (Date.now() - moduleState.recordingStartedAt) / 1000,
          fps: Math.round((frames * 1000) / Math.max(1, now - lastAt)),
          fpsEnabled: true,
        });
        lastAt = now;
        lastReport = now;
        frames = 0;
      }
      moduleState.recordingTimer = global.requestAnimationFrame(countFrame);
    };
    moduleState.recordingTimer = global.requestAnimationFrame(countFrame);
  }

  function clearRecordingTimers() {
    if (moduleState.recordingTimer !== null) global.cancelAnimationFrame(moduleState.recordingTimer);
    global.clearInterval(moduleState.replayTimer);
    moduleState.recordingTimer = null;
    moduleState.replayTimer = null;
  }

  function stopMediaPlayback() {
    const video = getVideoElement();
    const music = getMusicElement();
    [video, music].forEach((element) => {
      if (element && typeof element.pause === 'function') {
        try { element.pause(); } catch (_) { /* ignore teardown errors */ }
      }
    });
  }

  function cleanupCapture(restoreCanvas) {
    clearRecordingTimers();
    moduleState.captureVideoTracks.forEach((track) => {
      try { track.stop(); } catch (_) { /* ignore */ }
    });
    moduleState.captureVideoTracks = [];
    moduleState.captureStream = null;
    moduleState.audioStream = null;
    if (restoreCanvas && moduleState.sourceCanvasSize) {
      const canvas = getCanvas();
      if (canvas) {
        canvas.width = moduleState.sourceCanvasSize.width;
        canvas.height = moduleState.sourceCanvasSize.height;
        try {
          if (root.app && typeof root.app.renderFrame === 'function') root.app.renderFrame(performance.now());
        } catch (_) { /* preview loop can redraw on its next frame */ }
      }
    }
    moduleState.sourceCanvasSize = null;
  }

  function createMixedStream(canvas) {
    const base = canvas.captureStream(30);
    const videoTracks = base.getVideoTracks();
    let audio = null;
    try {
      if (root.media && typeof root.media.getMixedAudioStream === 'function') {
        audio = root.media.getMixedAudioStream();
      }
    } catch (error) {
      try { base.getTracks().forEach((track) => track.stop()); } catch (_) { /* ignore */ }
      throw new Error(`Could not create the mixed audio stream: ${error.message || error}`);
    }
    if (audio && typeof audio.getAudioTracks === 'function') {
      const audioTracks = audio.getAudioTracks();
      audioTracks.forEach((track) => {
        if (track.readyState === 'live' && !base.getTracks().some((existing) => existing.id === track.id)) {
          base.addTrack(track);
        }
      });
      moduleState.audioStream = audio;
    }
    if (!videoTracks.length) {
      try { base.getTracks().forEach((track) => track.stop()); } catch (_) { /* ignore */ }
      throw new Error('The browser did not provide a canvas video track.');
    }
    return base;
  }

  function failStart(message, error) {
    cleanupCapture(true);
    moduleState.recorder = null;
    moduleState.chunks = [];
    moduleState.stopPromise = null;
    const text = error && error.message ? `${message} ${error.message}` : message;
    setStatus('error', { message: text });
    notify(text, 'error');
    return false;
  }

  async function startRecording(options) {
    const opts = options || {};
    if (moduleState.recorder && moduleState.recorder.state !== 'inactive') {
      throw new Error('A recording is already in progress.');
    }
    if (!isSupported()) {
      notify('Recording is unavailable: this browser does not support canvas capture and MediaRecorder.', 'error');
      setStatus('unsupported', { message: 'Canvas capture and MediaRecorder are required.' });
      return false;
    }

    const canvas = getCanvas();
    const video = getVideoElement();
    const settings = getSettings();
    const trim = readTrim(settings, video, opts);
    if (opts.replay && (!video || !Number.isFinite(trim.end) || trim.end <= trim.start)) {
      notify('Replay recording needs a video with a valid trim range.', 'error');
      return false;
    }

    moduleState.sourceCanvasSize = { width: canvas.width, height: canvas.height };
    const resolution = opts.resolution || settings.recordingResolution || settings.exportResolution || 'source';
    const target = targetCanvasSize(canvas, video, resolution);
    if (canvas.width !== target.width || canvas.height !== target.height) {
      canvas.width = target.width;
      canvas.height = target.height;
      try {
        if (root.app && typeof root.app.renderFrame === 'function') root.app.renderFrame(performance.now());
      } catch (error) {
        return failStart('Could not render the composition at the selected resolution.', error);
      }
    }
    moduleState.recordingResolution = { width: canvas.width, height: canvas.height };

    const mimeType = chooseMimeType();
    if (!mimeType) return failStart('Recording is unavailable: no supported MediaRecorder video codec was found.');

    try {
      moduleState.captureStream = createMixedStream(canvas);
      moduleState.captureVideoTracks = moduleState.captureStream.getVideoTracks();
      moduleState.chunks = [];
      moduleState.lastBlob = null;
      moduleState.explicitStop = false;
      const recorderOptions = { mimeType };
      const bitrate = Number(opts.videoBitsPerSecond || settings.recordingBitrate);
      if (Number.isFinite(bitrate) && bitrate > 0) recorderOptions.videoBitsPerSecond = bitrate;
      const recorder = new global.MediaRecorder(moduleState.captureStream, recorderOptions);
      moduleState.recorder = recorder;
      moduleState.stopPromise = new Promise((resolve, reject) => {
        recorder.addEventListener('dataavailable', (event) => {
          if (event.data && event.data.size) {
            moduleState.chunks.push(event.data);
            const total = moduleState.chunks.reduce((sum, chunk) => sum + chunk.size, 0);
            if (total > maxBlobBytes() && recorder.state !== 'inactive') {
              moduleState.explicitStop = true;
              try { recorder.stop(); } catch (_) { /* onstop resolves the collected data */ }
              setStatus('size-limit', { maxBytes: maxBlobBytes(), message: 'Recording stopped at the configured size limit.' });
            }
          }
        });
        recorder.addEventListener('error', (event) => {
          const error = event.error || new Error('The browser MediaRecorder failed.');
          setStatus('error', { message: error.message || 'Recording failed.' });
          reject(error);
        }, { once: true });
        recorder.addEventListener('stop', () => {
          const actualMime = recorder.mimeType || mimeType;
          const blob = new Blob(moduleState.chunks, { type: actualMime });
          moduleState.chunks = [];
          moduleState.lastBlob = blob.size <= maxBlobBytes() ? blob : null;
          const wasOversized = !moduleState.lastBlob;
          cleanupCapture(true);
          stopMediaPlayback();
          if (wasOversized) {
            const error = new Error('The recording exceeded the browser-safe size limit and was discarded.');
            setStatus('error', { message: error.message, size: blob.size });
            notify(error.message, 'error');
            resolve(null);
            return;
          }
          if (blob.size === 0) {
            setStatus('error', { message: 'The browser produced an empty recording.' });
            notify('The browser produced an empty recording. Try again or use another browser.', 'error');
            resolve(null);
            return;
          }
          notifyPreview(blob);
          setStatus('ready', { blob, size: blob.size, mimeType: blob.type, explicitStop: moduleState.explicitStop });
          resolve(blob);
        }, { once: true });
      });
      recorder.start(1000);
      startStatusTimer();
      setStatus('recording', {
        mimeType,
        resolution: { width: canvas.width, height: canvas.height },
        trimIn: trim.start,
        trimOut: trim.end,
        replay: Boolean(opts.replay),
        fpsEnabled: Boolean(settings.showRecordingFps || settings.recordingFps || settings.showFpsDuringRecording),
      });
      dispatch('fstuber:recording-started', { mimeType, resolution: { width: canvas.width, height: canvas.height } });
      return true;
    } catch (error) {
      return failStart('Could not start recording.', error);
    }
  }

  async function stopRecording() {
    const recorder = moduleState.recorder;
    if (!recorder) return moduleState.lastBlob;
    if (recorder.state === 'inactive') {
      return moduleState.stopPromise ? moduleState.stopPromise : moduleState.lastBlob;
    }
    moduleState.explicitStop = true;
    setStatus('stopping');
    try {
      recorder.stop();
    } catch (error) {
      cleanupCapture(true);
      stopMediaPlayback();
      setStatus('error', { message: error.message || 'Could not stop recording.' });
      throw error;
    }
    return moduleState.stopPromise;
  }

  async function seekElement(element, time) {
    if (!element || !Number.isFinite(time) || time < 0) return;
    if (Math.abs((Number(element.currentTime) || 0) - time) < 0.05) return;
    await new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        global.clearTimeout(timer);
        element.removeEventListener('seeked', finish);
        element.removeEventListener('error', finish);
        resolve();
      };
      const timer = global.setTimeout(finish, 3000);
      element.addEventListener('seeked', finish, { once: true });
      element.addEventListener('error', finish, { once: true });
      try { element.currentTime = time; } catch (_) { finish(); }
    });
  }

  async function recordReplay(options) {
    const opts = options || {};
    const video = getVideoElement();
    const music = getMusicElement();
    if (!video) {
      notify('Replay recording requires a loaded video source.', 'error');
      return null;
    }
    const trim = readTrim(getSettings(), video, opts);
    if (!Number.isFinite(trim.end) || trim.end <= trim.start) {
      notify('Set a valid trim-out point after the trim-in point before recording.', 'error');
      return null;
    }
    if (moduleState.replayPromise) return moduleState.replayPromise;
    moduleState.replayPromise = (async () => {
      try {
        [video, music].forEach((element) => {
          if (element && typeof element.pause === 'function') element.pause();
        });
        await seekElement(video, trim.start);
        if (music && Number.isFinite(Number(music.duration)) && Number(music.duration) > 0) {
          await seekElement(music, Math.min(trim.start, Math.max(0, Number(music.duration) - 0.05)));
        }
        const started = await startRecording(Object.assign({}, opts, { replay: true }));
        if (!started) return null;
        const playResults = await Promise.allSettled([
          video.play(),
          music && typeof music.play === 'function' ? music.play() : Promise.resolve(),
        ]);
        if (playResults[0] && playResults[0].status === 'rejected') {
          await stopRecording();
          throw new Error(`Video playback could not start: ${playResults[0].reason && playResults[0].reason.message || 'browser playback was blocked.'}`);
        }
        moduleState.replayTimer = global.setInterval(() => {
          if (!video || video.ended || Number(video.currentTime) >= trim.end - 0.025) {
            stopRecording().catch(() => {});
          }
        }, 40);
        const onTimeUpdate = () => {
          if (Number(video.currentTime) >= trim.end - 0.025) stopRecording().catch(() => {});
        };
        video.addEventListener('timeupdate', onTimeUpdate);
        const resultPromise = moduleState.stopPromise;
        resultPromise.finally(() => video.removeEventListener('timeupdate', onTimeUpdate));
        return resultPromise;
      } catch (error) {
        stopMediaPlayback();
        notify(error.message || 'Replay recording could not start.', 'error');
        setStatus('error', { message: error.message || 'Replay recording failed.' });
        return null;
      } finally {
        moduleState.replayPromise = null;
      }
    })();
    return moduleState.replayPromise;
  }

  function replayAndRecord(options) {
    return recordReplay(options);
  }

  function getLastBlob() {
    return moduleState.lastBlob;
  }

  async function discardLastRecording() {
    if (moduleState.recorder && moduleState.recorder.state !== 'inactive') await stopRecording();
    if (moduleState.previewUrl) {
      try { global.URL.revokeObjectURL(moduleState.previewUrl); } catch (_) { /* ignore */ }
    }
    moduleState.previewUrl = null;
    moduleState.lastBlob = null;
    moduleState.chunks = [];
    moduleState.recordingResolution = null;
    moduleState.stopPromise = null;
    setStatus('discarded');
    return true;
  }

  function extensionForMime(type) {
    const mime = String(type || '').toLowerCase().split(';')[0].trim();
    if (mime === 'video/mp4') return 'mp4';
    if (mime === 'image/gif') return 'gif';
    if (mime === 'video/ogg') return 'ogv';
    if (mime === 'video/webm') return 'webm';
    return '';
  }

  function sanitizeName(input) {
    let name = String(input || '').trim();
    name = name.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_').replace(/[. ]+$/g, '').replace(/^\.+/g, '');
    name = name.replace(/\s+/g, ' ').slice(0, 180).trim();
    return name || '';
  }

  function splitName(input) {
    const name = sanitizeName(input);
    const dot = name.lastIndexOf('.');
    return dot > 0 ? { base: name.slice(0, dot), extension: name.slice(dot + 1).toLowerCase() } : { base: name, extension: '' };
  }

  function nameWithActualExtension(input, blob) {
    const extension = extensionForMime(blob && blob.type) || 'webm';
    const parts = splitName(input);
    const base = parts.base || `FSTuber_export_${new Date().toISOString().replace(/[:.]/g, '-')}`;
    return `${base}.${extension}`;
  }

  function reserveLocalName(name) {
    const parts = splitName(name);
    const extension = parts.extension || 'webm';
    const base = parts.base || 'FSTuber_export';
    let candidate = `${base}.${extension}`;
    const registryKey = 'fstuber-local-export-names';
    let saved = [];
    try { saved = JSON.parse(global.localStorage.getItem(registryKey) || '[]'); } catch (_) { saved = []; }
    const used = new Set([...(Array.isArray(saved) ? saved : []), ...moduleState.localNames]);
    let index = 1;
    while (used.has(candidate.toLowerCase())) {
      candidate = `${base} (${index++}).${extension}`;
    }
    moduleState.localNames.add(candidate.toLowerCase());
    try {
      saved.push(candidate.toLowerCase());
      global.localStorage.setItem(registryKey, JSON.stringify(saved.slice(-500)));
    } catch (_) { /* private browsing may disable storage; browser handles collisions */ }
    return candidate;
  }

  function assertBlob(blob) {
    if (!(blob instanceof Blob) || blob.size === 0) throw new Error('There is no completed recording to save.');
    if (blob.size > maxBlobBytes()) throw new Error('This recording is too large for a safe browser export.');
  }

  async function saveLocal(name, options) {
    const opts = options || {};
    const blob = opts.blob || moduleState.lastBlob;
    try {
      assertBlob(blob);
      if (!sanitizeName(name)) throw new Error('Enter a valid filename before saving.');
      let output = blob;
      const requested = String(opts.format || '').toLowerCase();
      if (requested && requested !== extensionForMime(blob.type)) output = await convert(blob, requested, opts);
      const filename = reserveLocalName(nameWithActualExtension(name, output));
      const url = global.URL.createObjectURL(output);
      const anchor = global.document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.style.display = 'none';
      global.document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      global.setTimeout(() => global.URL.revokeObjectURL(url), 60_000);
      setStatus('saved-local', { filename, size: output.size, mimeType: output.type });
      notify(`Download started: ${filename}.`, 'success');
      dispatch('fstuber:recording-saved', { destination: 'local', filename, blob: output });
      return { filename, blob: output, destination: 'local' };
    } catch (error) {
      setStatus('save-error', { destination: 'local', message: error.message });
      notify(error.message || 'The local download could not be started.', 'error');
      throw error;
    }
  }

  function getDriveToken() {
    const auth = root.auth || {};
    const getters = ['getGoogleAccessToken', 'getDriveAccessToken', 'getAccessToken', 'getGoogleToken', 'getToken'];
    for (const key of getters) {
      if (typeof auth[key] === 'function') {
        const value = auth[key]();
        if (value && typeof value.then === 'function') return value;
        if (value) return Promise.resolve(value.token || value.access_token || value);
      }
    }
    const token = auth.googleAccessToken || auth.driveAccessToken || auth.accessToken || auth.googleToken;
    if (token) return Promise.resolve(token.token || token.access_token || token);
    return Promise.reject(new Error('Google Drive is not connected. Connect Drive in Settings, then try again.'));
  }

  function driveQueryEscape(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  }

  async function driveRequest(url, token, options) {
    const response = await global.fetch(url, Object.assign({
      headers: { Authorization: `Bearer ${token}` },
    }, options || {}));
    if (!response.ok) {
      let detail = '';
      try { detail = (await response.json()).error.message || ''; } catch (_) { /* no JSON error */ }
      if (response.status === 401) throw new Error('Google Drive authorization expired. Reconnect Drive and try again.');
      throw new Error(detail || `Google Drive request failed (${response.status}).`);
    }
    return response;
  }

  async function ensureDriveFolder(name, parentId, token) {
    const clauses = [`name='${driveQueryEscape(name)}'`, "mimeType='application/vnd.google-apps.folder'", 'trashed=false'];
    clauses.push(parentId ? `'${driveQueryEscape(parentId)}' in parents` : "'root' in parents");
    const query = encodeURIComponent(clauses.join(' and '));
    const listUrl = `${DRIVE_API}/files?q=${query}&fields=files(id,name,mimeType,parents)&pageSize=100`;
    const response = await driveRequest(listUrl, token);
    const result = await response.json();
    const folder = (result.files || []).find((item) => item.name === name);
    if (folder) return folder.id;
    const created = await driveRequest(`${DRIVE_API}/files?fields=id,name`, token, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', ...(parentId ? { parents: [parentId] } : {}) }),
    });
    const data = await created.json();
    return data.id;
  }

  async function chooseDriveFilename(parentId, proposed, token) {
    const parts = splitName(proposed);
    const base = parts.base || 'FSTuber_export';
    const ext = parts.extension || 'webm';
    const existing = new Set();
    let pageToken = '';
    do {
      const params = new URLSearchParams({
        q: `'${driveQueryEscape(parentId)}' in parents and trashed=false`,
        fields: 'nextPageToken,files(id,name)',
        pageSize: '1000'
      });
      if (pageToken) params.set('pageToken', pageToken);
      const response = await driveRequest(`${DRIVE_API}/files?${params.toString()}`, token);
      const result = await response.json();
      (result.files || []).forEach((file) => existing.add(String(file.name || '').toLowerCase()));
      pageToken = result.nextPageToken || '';
    } while (pageToken);
    let candidate = `${base}.${ext}`;
    let index = 1;
    while (existing.has(candidate.toLowerCase())) candidate = `${base} (${index++}).${ext}`;
    return candidate;
  }

  function uploadWithProgress(url, token, metadata, blob, filename) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.setRequestHeader('Content-Type', 'multipart/related; boundary=fstuber_upload_boundary');
      xhr.upload.onprogress = (event) => {
        const percent = event.lengthComputable ? Math.round((event.loaded / event.total) * 100) : null;
        const detail = { destination: 'drive', filename, loaded: event.loaded, total: event.total, percent };
        setStatus('uploading', detail);
        dispatch('fstuber:drive-upload-progress', detail);
      };
      xhr.onerror = () => reject(new Error('Network error while uploading to Google Drive.'));
      xhr.onabort = () => reject(new Error('Google Drive upload was cancelled.'));
      xhr.onload = () => {
        if (xhr.status < 200 || xhr.status >= 300) {
          let message = `Google Drive upload failed (${xhr.status}).`;
          try { message = JSON.parse(xhr.responseText).error.message || message; } catch (_) { /* keep generic message */ }
          reject(new Error(message));
          return;
        }
        try { resolve(JSON.parse(xhr.responseText)); } catch (_) { reject(new Error('Google Drive returned an unreadable upload response.')); }
      };
      const boundary = 'fstuber_upload_boundary';
      const metadataPart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`;
      const mediaPart = `--${boundary}\r\nContent-Type: ${blob.type || 'application/octet-stream'}\r\n\r\n`;
      const ending = `\r\n--${boundary}--`;
      xhr.send(new Blob([metadataPart, mediaPart, blob, ending], { type: `multipart/related; boundary=${boundary}` }));
    });
  }

  async function saveDrive(name, options) {
    const opts = options || {};
    const blob = opts.blob || moduleState.lastBlob;
    try {
      assertBlob(blob);
      if (!sanitizeName(name)) throw new Error('Enter a valid filename before saving.');
      if (typeof global.fetch !== 'function' || typeof global.XMLHttpRequest !== 'function') {
        throw new Error('This browser cannot upload files to Google Drive.');
      }
      let output = blob;
      const requested = String(opts.format || '').toLowerCase();
      if (requested && requested !== extensionForMime(blob.type)) output = await convert(blob, requested, opts);
      const tokenValue = await getDriveToken();
      const token = typeof tokenValue === 'string' ? tokenValue : (tokenValue && (tokenValue.access_token || tokenValue.token));
      if (!token) throw new Error('Google Drive is not connected. Connect Drive in Settings, then try again.');
      setStatus('uploading', { destination: 'drive', percent: 0 });
      const parentId = await ensureDriveFolder('FSTuber', null, token);
      const proposed = nameWithActualExtension(name, output);
      const filename = await chooseDriveFilename(parentId, proposed, token);
      const metadata = { name: filename, mimeType: output.type || 'application/octet-stream', parents: [parentId] };
      const result = await uploadWithProgress(`${DRIVE_UPLOAD_API}?uploadType=multipart&fields=id,name,mimeType,webViewLink,parents`, token, metadata, output, filename);
      const link = result.webViewLink || (result.id ? `https://drive.google.com/file/d/${encodeURIComponent(result.id)}/view` : '');
      const detail = { destination: 'drive', id: result.id, filename: result.name || filename, path: `FSTuber/${result.name || filename}`, url: link, blob: output };
      setStatus('saved-drive', detail);
      notify(`Saved to FSTuber/${detail.filename}.`, 'success');
      dispatch('fstuber:recording-saved', detail);
      return detail;
    } catch (error) {
      setStatus('save-error', { destination: 'drive', message: error.message });
      notify(error.message || 'Google Drive upload failed.', 'error');
      throw error;
    }
  }

  function getSupportedFormats() {
    const webm = typeof global.MediaRecorder === 'function' && Boolean(
      global.MediaRecorder.isTypeSupported('video/webm') ||
      global.MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus') ||
      global.MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
    );
    const recordedMime = String(moduleState.lastBlob && moduleState.lastBlob.type || '').toLowerCase();
    const recordedMp4 = recordedMime.startsWith('video/mp4');
    const mp4ConversionAvailable = typeof global.WebAssembly === 'object';
    const gifSupported = typeof global.Worker === 'function' && typeof global.document !== 'undefined' &&
      !(global.location && global.location.protocol === 'file:');
    return [
      { id: 'webm', label: 'WebM', extension: 'webm', mimeType: 'video/webm', supported: webm, native: true, reason: webm ? '' : 'MediaRecorder WebM is unavailable in this browser.' },
      { id: 'mp4', label: recordedMp4 ? 'MP4' : 'MP4 (optional conversion)', extension: 'mp4', mimeType: 'video/mp4', supported: recordedMp4 || mp4ConversionAvailable, native: recordedMp4, conversion: !recordedMp4, reason: recordedMp4 ? '' : 'This recording must be converted using single-thread FFmpeg.wasm; CDN access, browser memory, and codec support may limit large exports.' },
      { id: 'gif', label: 'GIF (≤10s, 480px max)', extension: 'gif', mimeType: 'image/gif', supported: gifSupported, native: false, conversion: false, reason: gifSupported ? 'GIF exports are silent and limited to clips of 10 seconds or less and 480 pixels wide.' : 'GIF export requires Web Workers from an HTTP or HTTPS origin.' },
    ];
  }

  async function loadFFmpeg() {
    if (moduleState.ffmpeg) return moduleState.ffmpeg;
    if (moduleState.ffmpegLoad) return moduleState.ffmpegLoad;
    if (!global.WebAssembly || typeof global.fetch !== 'function' || typeof global.Blob !== 'function') {
      throw new Error('MP4 conversion is unsupported: this browser lacks WebAssembly or fetch support. Save as WebM.');
    }
    moduleState.ffmpegLoad = (async () => {
      let coreUrl;
      let wasmUrl;
      try {
        const moduleCdn = `https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@${FFMPEG_VERSION}/dist/esm/index.js`;
        const coreCdn = `https://unpkg.com/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/umd/ffmpeg-core.js`;
        const wasmCdn = `https://unpkg.com/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/umd/ffmpeg-core.wasm`;
        const [coreResponse, wasmResponse] = await Promise.all([
          global.fetch(coreCdn), global.fetch(wasmCdn),
        ]);
        if (![coreResponse, wasmResponse].every((response) => response.ok)) {
          throw new Error('The optional FFmpeg.wasm files could not be loaded from the CDN.');
        }
        coreUrl = global.URL.createObjectURL(new Blob([await coreResponse.text()], { type: 'text/javascript' }));
        wasmUrl = global.URL.createObjectURL(new Blob([await wasmResponse.arrayBuffer()], { type: 'application/wasm' }));
        // Import from the CDN URL (rather than a Blob URL) so the package's
        // relative ESM imports and worker asset retain their original base URL.
        const ffmpegModule = await import(moduleCdn);
        const FFmpegClass = ffmpegModule.FFmpeg || (ffmpegModule.default && ffmpegModule.default.FFmpeg);
        if (!FFmpegClass) throw new Error('The FFmpeg.wasm module did not expose its recorder.');
        const ffmpeg = new FFmpegClass();
        await ffmpeg.load({ coreURL: coreUrl, wasmURL: wasmUrl });
        moduleState.ffmpeg = ffmpeg;
        return ffmpeg;
      } catch (error) {
        const message = error && error.message ? error.message : String(error);
        throw new Error(`MP4 conversion could not be initialized safely (${message}). Save as WebM. Ensure CDN access and available memory.`);
      } finally {
        [coreUrl, wasmUrl].forEach((url) => {
          if (url) global.setTimeout(() => { try { global.URL.revokeObjectURL(url); } catch (_) { /* ignore */ } }, 60_000);
        });
        moduleState.ffmpegLoad = null;
      }
    })();
    return moduleState.ffmpegLoad;
  }

  function loadGifEncoder() {
    if (typeof global.GIF === 'function') return Promise.resolve(global.GIF);
    if (moduleState.gifLoad) return moduleState.gifLoad;
    moduleState.gifLoad = new Promise((resolve, reject) => {
      const script = global.document.createElement('script');
      script.src = new URL('./assets/vendor/gif.js', global.location.href).href;
      script.async = true;
      script.dataset.fstuberGif = 'true';
      script.onload = () => typeof global.GIF === 'function' ? resolve(global.GIF) : reject(new Error('The local GIF encoder did not initialize.'));
      script.onerror = () => reject(new Error('The bundled GIF encoder could not be loaded.'));
      global.document.head.appendChild(script);
    }).finally(() => { moduleState.gifLoad = null; });
    return moduleState.gifLoad;
  }

  async function convertToGif(blob, options = {}) {
    assertBlob(blob);
    if (blob.size > Math.min(maxBlobBytes(), 80 * 1024 * 1024)) {
      throw new Error('GIF export is limited to recordings up to 80 MB. Save this recording as WebM or MP4.');
    }
    if (global.location && global.location.protocol === 'file:') {
      throw new Error('GIF export needs a local HTTP server or HTTPS so its bundled worker can run.');
    }
    setStatus('converting', { format: 'gif', size: blob.size });
    let objectUrl = '';
    let video = null;
    let encoder = null;
    let complete = false;
    try {
      const Encoder = await loadGifEncoder();
      objectUrl = global.URL.createObjectURL(blob);
      video = global.document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      await new Promise((resolve, reject) => {
        const timer = global.setTimeout(() => reject(new Error('The recording could not be decoded for GIF export.')), 15000);
        video.addEventListener('loadedmetadata', () => { global.clearTimeout(timer); resolve(); }, { once: true });
        video.addEventListener('error', () => { global.clearTimeout(timer); reject(new Error('The browser could not decode this recording for GIF export.')); }, { once: true });
        video.src = objectUrl;
        video.load();
      });
      const mediaDuration = Number(video.duration);
      const duration = Number.isFinite(mediaDuration) && mediaDuration > 0 ? mediaDuration : Number(options.duration);
      if (!Number.isFinite(duration) || duration <= 0) throw new Error('The recording has no readable duration.');
      if (duration > 10.05) throw new Error('GIF export is limited to 10 seconds. Trim the replay shorter, or save it as WebM or MP4.');
      if (video.readyState < 2) await new Promise(resolve => video.addEventListener('loadeddata', resolve, { once: true }));

      const sourceWidth = video.videoWidth || moduleState.recordingResolution?.width || 480;
      const sourceHeight = video.videoHeight || moduleState.recordingResolution?.height || 270;
      const width = Math.max(2, even(Math.min(480, sourceWidth)));
      const height = Math.max(2, even(sourceHeight * width / sourceWidth));
      const canvas = global.document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('GIF export needs a 2D canvas.');
      const fps = 8;
      const frameCount = Math.max(1, Math.ceil(duration * fps));
      encoder = new Encoder({
        workers: 2,
        quality: 12,
        width,
        height,
        repeat: 0,
        workerScript: new URL('./assets/vendor/gif.worker.js', global.location.href).href
      });
      for (let index = 0; index < frameCount; index += 1) {
        await seekElement(video, Math.min(duration - 0.01, index / fps));
        context.clearRect(0, 0, width, height);
        context.drawImage(video, 0, 0, width, height);
        encoder.addFrame(context, { copy: true, delay: Math.round(1000 / fps) });
      }
      const result = await new Promise((resolve, reject) => {
        const timer = global.setTimeout(() => reject(new Error('GIF encoding took too long. Try a shorter clip.')), 90000);
        encoder.on('finished', resultBlob => {
          global.clearTimeout(timer);
          complete = true;
          resolve(resultBlob);
        });
        encoder.on('progress', value => setStatus('converting', { format: 'gif', percent: Math.round(Number(value) * 100) }));
        try { encoder.render(); }
        catch (error) { global.clearTimeout(timer); reject(error); }
      });
      if (!result || !result.size) throw new Error('The GIF encoder produced an empty file.');
      if (result.size > Math.min(maxBlobBytes(), 100 * 1024 * 1024)) throw new Error('The GIF exceeds the 100 MB browser-safe limit. Try a shorter clip.');
      setStatus('converted', { format: 'gif', size: result.size });
      return result;
    } catch (error) {
      setStatus('conversion-error', { format: 'gif', message: error.message || String(error) });
      throw error;
    } finally {
      if (encoder && !complete && typeof encoder.abort === 'function') {
        try { encoder.abort(); } catch (_) { /* ignore */ }
      }
      if (video) { video.pause(); video.removeAttribute('src'); video.load(); }
      if (objectUrl) { try { global.URL.revokeObjectURL(objectUrl); } catch (_) { /* ignore */ } }
    }
  }

  async function convert(blob, format, options) {
    const target = String(format || '').toLowerCase().replace(/^\./, '');
    assertBlob(blob);
    if (target === 'gif') return convertToGif(blob, options || {});
    if (target !== 'mp4') throw new Error(`Unsupported export format: ${target || '(empty)'}.`);
    const requestedResolution = String(options && options.resolution || 'source').toLowerCase();
    const sourceSize = moduleState.recordingResolution || { width: 0, height: 0 };
    const outputSize = targetCanvasSize({ width: sourceSize.width || 1280, height: sourceSize.height || 720 }, null, requestedResolution);
    const resizeNeeded = requestedResolution !== 'source' && sourceSize.width > 0 && sourceSize.height > 0 &&
      (outputSize.width !== sourceSize.width || outputSize.height !== sourceSize.height);
    const currentExtension = extensionForMime(blob.type);
    if (target === currentExtension && !resizeNeeded) return blob;
    if (blob.size > Math.min(maxBlobBytes(), 300 * 1024 * 1024)) {
      throw new Error('MP4 conversion is limited to recordings up to 300 MB to reduce browser memory risk. Save this recording as WebM.');
    }
    if (!resizeNeeded && typeof global.MediaRecorder === 'function' && global.MediaRecorder.isTypeSupported('video/mp4') && blob.type.toLowerCase().startsWith('video/mp4')) return blob;
    setStatus('converting', { format: 'mp4', size: blob.size });
    notify('Preparing optional single-thread MP4 conversion. Large files may exceed browser memory.', 'info');
    let ffmpeg;
    const inputName = `fstuber-input.${currentExtension || 'webm'}`;
    try {
      ffmpeg = await loadFFmpeg();
      const outputName = 'fstuber-output.mp4';
      await ffmpeg.writeFile(inputName, new Uint8Array(await blob.arrayBuffer()));
      const preset = (options && options.preset) || 'ultrafast';
      const scaleArgs = resizeNeeded ? ['-vf', `scale=${outputSize.width}:${outputSize.height}`] : [];
      await ffmpeg.exec(['-i', inputName, ...scaleArgs, '-c:v', 'libx264', '-preset', preset, '-crf', '23', '-threads', '1', '-c:a', 'aac', '-movflags', '+faststart', outputName]);
      const data = await ffmpeg.readFile(outputName);
      const result = new Blob([data], { type: 'video/mp4' });
      if (!result.size) throw new Error('FFmpeg produced an empty MP4 file.');
      if (result.size > maxBlobBytes()) throw new Error('The converted MP4 exceeds the browser-safe size limit.');
      setStatus('converted', { format: 'mp4', size: result.size });
      return result;
    } catch (error) {
      setStatus('conversion-error', { format: 'mp4', message: error.message });
      throw new Error(error.message && error.message.includes('MP4 conversion')
        ? error.message
        : `MP4 conversion failed: ${error.message || error}. Save the original recording as WebM.`);
    } finally {
      if (ffmpeg) {
        try { await ffmpeg.deleteFile('fstuber-output.mp4'); } catch (_) { /* file may not exist */ }
        try { await ffmpeg.deleteFile(inputName); } catch (_) { /* file may not exist */ }
      }
    }
  }

  root.recorder = {
    isSupported,
    startRecording,
    stopRecording,
    recordReplay,
    replayAndRecord,
    getLastBlob,
    discardLastRecording,
    saveLocal,
    saveDrive,
    convert,
    getSupportedFormats,
  };
})(window);
