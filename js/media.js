/* FSTuber media responsibility: safe media loading, cloud reads, screen capture, and recorder audio mixing. */
(function (window) {
  'use strict';

  const root = (window.FSTuber = window.FSTuber || {});
  const MIME_BY_EXTENSION = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    apng: 'image/apng', webp: 'image/webp', mp4: 'video/mp4', webm: 'video/webm',
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg'
  };
  const EXTENSION_BY_MIME = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/apng': 'apng',
    'image/webp': 'webp', 'video/mp4': 'mp4', 'video/webm': 'webm',
    'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
    'audio/wave': 'wav', 'audio/ogg': 'ogg', 'application/ogg': 'ogg'
  };
  const state = {
    videoEl: null,
    musicEl: null,
    videoFileName: '',
    duration: 0,
    videoUrl: '',
    musicUrl: '',
    images: [],
    assets: [],
    streams: [],
    audioContext: null,
    videoGain: null,
    musicGain: null,
    videoAnalyser: null,
    musicAnalyser: null,
    audioDestination: null,
    videoMetadata: null,
    musicMetadata: null,
    videoSource: null,
    musicSource: null
  };
  const sourceNodes = new WeakMap();
  const connectedGains = new WeakMap();
  const gainOutputsConnected = new WeakSet();
  const objectUrls = new Set();
  const thumbnailUrls = new Set();
  const roleUrls = { video: '', music: '' };
  let screenStream = null;
  let initialized = false;
  let resumeListenerInstalled = false;

  function emit(name, detail) {
    try { window.dispatchEvent(new CustomEvent(name, { detail: detail || {} })); } catch (_) { /* Older embedded browsers. */ }
  }

  function toast(message, type) {
    const ui = root.ui;
    if (!ui) return;
    const fn = ui.toast || ui.showToast || ui.notify;
    if (typeof fn === 'function') {
      try { fn.call(ui, message, type || 'error'); } catch (_) { /* UI is optional. */ }
    }
  }

  function error(message, cause) {
    const detail = { message, error: cause || null };
    emit('fstuber:mediaerror', detail);
    toast(message, 'error');
    return new Error(message, cause ? { cause } : undefined);
  }

  function setLoading(loading, operation) {
    emit('fstuber:loading', { loading: Boolean(loading), operation: operation || 'media' });
  }

  function mediaChanged(operation) {
    emit('fstuber:mediachange', { operation: operation || 'media', state: getState() });
  }

  function assetsChanged() {
    emit('fstuber:assetschange', { images: state.images.slice(), assets: state.assets.slice() });
  }

  function basename(name) {
    return String(name || 'media').split(/[\\/]/).pop() || 'media';
  }

  function classify(name, mime) {
    const filename = basename(name);
    const match = /\.([^.]+)$/.exec(filename);
    const extension = match ? match[1].toLowerCase() : '';
    let resolvedExtension = extension;
    if (!resolvedExtension && mime) resolvedExtension = EXTENSION_BY_MIME[String(mime).split(';')[0].trim().toLowerCase()] || '';
    const expectedMime = MIME_BY_EXTENSION[resolvedExtension];
    if (!expectedMime) return null;
    return {
      extension: resolvedExtension,
      mime: expectedMime,
      type: expectedMime.startsWith('image/') ? 'image' : expectedMime.startsWith('video/') ? 'video' : 'audio'
    };
  }

  function validateMedia(fileOrUrl, metadata) {
    const meta = metadata || {};
    const name = basename(meta.name || (fileOrUrl && fileOrUrl.name) || (typeof fileOrUrl === 'string' ? fileOrUrl.split(/[?#]/)[0].split('/').pop() : 'media'));
    const mime = meta.mimeType || meta.type || (fileOrUrl && fileOrUrl.type) || '';
    const result = classify(name, mime);
    if (!result) throw error('Unsupported media format. Use PNG, JPG, JPEG, GIF, APNG, WebP, MP4, WebM, MP3, WAV, or OGG.');
    return { name, mime: result.mime, type: result.type, extension: result.extension };
  }

  function createHiddenElement(kind) {
    const selectors = kind === 'video'
      ? ['[data-fstuber-video]', '#source-video', '#video-source']
      : ['[data-fstuber-music]', '#source-music', '#music-source'];
    let element = null;
    for (const selector of selectors) {
      try { element = document.querySelector(selector); } catch (_) { element = null; }
      if (element) break;
    }
    if (!element) {
      element = document.createElement(kind === 'video' ? 'video' : 'audio');
      element.dataset.fstuberMedia = kind;
      element.hidden = true;
      element.setAttribute('aria-hidden', 'true');
      (document.body || document.documentElement).appendChild(element);
    }
    element.preload = 'metadata';
    if (kind === 'video') element.playsInline = true;
    element.controls = false;
    return element;
  }

  function ensureElements() {
    if (typeof document === 'undefined') return;
    if (!state.videoEl) state.videoEl = createHiddenElement('video');
    if (!state.musicEl) state.musicEl = createHiddenElement('audio');
    attachElementEvents();
  }

  function ensureAudioGraph() {
    if (state.audioContext && state.videoGain && state.musicGain && state.audioDestination) {
      connectElement(state.videoEl, state.videoGain);
      connectElement(state.musicEl, state.musicGain);
      return true;
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return false;
    try {
      state.audioContext = state.audioContext || new AudioContextClass();
      state.audioDestination = state.audioDestination || state.audioContext.createMediaStreamDestination();
      state.videoGain = state.videoGain || state.audioContext.createGain();
      state.musicGain = state.musicGain || state.audioContext.createGain();
      state.videoAnalyser = state.videoAnalyser || state.audioContext.createAnalyser();
      state.musicAnalyser = state.musicAnalyser || state.audioContext.createAnalyser();
      state.videoAnalyser.fftSize = state.musicAnalyser.fftSize = 256;
      state.videoAnalyser.smoothingTimeConstant = state.musicAnalyser.smoothingTimeConstant = 0.82;
      state.videoGain.gain.value = state.videoGain.gain.value == null ? 1 : state.videoGain.gain.value;
      state.musicGain.gain.value = state.musicGain.gain.value == null ? 0.5 : state.musicGain.gain.value;
      connectElement(state.videoEl, state.videoGain);
      connectElement(state.musicEl, state.musicGain);
      if (!resumeListenerInstalled && typeof document !== 'undefined') {
        const resume = function () {
          if (state.audioContext && state.audioContext.state === 'suspended') state.audioContext.resume().catch(function () {});
        };
        document.addEventListener('pointerdown', resume, { passive: true });
        document.addEventListener('keydown', resume);
        resumeListenerInstalled = true;
      }
      return true;
    } catch (cause) {
      error('Audio mixing is unavailable in this browser. Media preview may still work.', cause);
      return false;
    }
  }

  function connectElement(element, gain) {
    if (!element || !gain || !state.audioContext) return;
    if (connectedGains.get(element) === gain) return;
    let node = sourceNodes.get(element);
    if (!node) {
      try {
        node = state.audioContext.createMediaElementSource(element);
        sourceNodes.set(element, node);
      } catch (cause) {
        error('Could not connect media audio for recording.', cause);
        return;
      }
    }
    try {
      node.disconnect();
      node.connect(gain);
      connectedGains.set(element, gain);
      if (!gainOutputsConnected.has(gain)) {
        const analyser = gain === state.videoGain ? state.videoAnalyser : state.musicAnalyser;
        if (analyser) {
          gain.connect(analyser);
          analyser.connect(state.audioContext.destination);
          analyser.connect(state.audioDestination);
        } else {
          gain.connect(state.audioContext.destination);
          gain.connect(state.audioDestination);
        }
        gainOutputsConnected.add(gain);
      }
    } catch (cause) {
      error('Could not initialize the audio mixer.', cause);
    }
  }

  function attachElementEvents() {
    if (state.videoEl && !state.videoEl.dataset.fstuberEventsAttached) {
      state.videoEl.dataset.fstuberEventsAttached = 'true';
      state.videoEl.addEventListener('loadedmetadata', function () {
        state.duration = Number.isFinite(state.videoEl.duration) ? state.videoEl.duration : 0;
        mediaChanged('video-metadata');
      });
      state.videoEl.addEventListener('durationchange', function () {
        state.duration = Number.isFinite(state.videoEl.duration) ? state.videoEl.duration : 0;
        mediaChanged('duration');
      });
      state.videoEl.addEventListener('error', function () {
        if (state.videoUrl || state.videoEl.srcObject) error('The video could not be loaded or played.');
      });
    }
    if (state.musicEl && !state.musicEl.dataset.fstuberEventsAttached) {
      state.musicEl.dataset.fstuberEventsAttached = 'true';
      state.musicEl.addEventListener('error', function () {
        if (state.musicUrl) error('The audio file could not be loaded or played.');
      });
    }
  }

  function getState() {
    return state;
  }

  function makeUrl(fileOrUrl) {
    if (typeof fileOrUrl === 'string') return { url: fileOrUrl, owned: false };
    if (fileOrUrl && typeof URL !== 'undefined' && URL.createObjectURL) {
      const url = URL.createObjectURL(fileOrUrl);
      objectUrls.add(url);
      return { url, owned: true };
    }
    throw error('The selected media could not be opened.');
  }

  function releaseUrl(url) {
    if (!url || !objectUrls.has(url)) return;
    try { URL.revokeObjectURL(url); } catch (_) { /* Best-effort cleanup. */ }
    objectUrls.delete(url);
  }

  function clearThumbnails() {
    Array.from(thumbnailUrls).forEach(releaseUrl);
    thumbnailUrls.clear();
  }

  function waitForMetadata(element, isVideo) {
    return new Promise(function (resolve, reject) {
      let done = false;
      const cleanup = function () {
        element.removeEventListener(isVideo ? 'loadedmetadata' : 'loadedmetadata', loaded);
        element.removeEventListener('error', failed);
      };
      const finish = function (fn, value) {
        if (done) return;
        done = true;
        cleanup();
        fn(value);
      };
      const loaded = function () { finish(resolve, element); };
      const failed = function () { finish(reject, new Error('The media could not be loaded.')); };
      element.addEventListener('loadedmetadata', loaded, { once: true });
      element.addEventListener('error', failed, { once: true });
      try { element.load(); } catch (_) { /* Some test and embedded elements omit load(). */ }
      if (element.readyState >= 1) finish(resolve, element);
    });
  }

  async function loadVideo(fileOrUrl, metadata) {
    const info = validateMedia(fileOrUrl, metadata);
    if (info.type !== 'video') throw error('Choose an MP4 or WebM video file.');
    ensureElements();
    const next = makeUrl(fileOrUrl);
    const previous = roleUrls.video;
    stopScreenStream(false);
    if (state.videoEl) {
      state.videoEl.pause();
      state.videoEl.removeAttribute('src');
      if (state.videoEl.srcObject) state.videoEl.srcObject = null;
      state.videoEl.load();
    }
    roleUrls.video = next.owned ? next.url : '';
    state.videoUrl = next.url;
    state.videoFileName = info.name;
    state.videoMetadata = Object.assign({}, metadata || {}, { name: info.name, mimeType: info.mime, source: metadata && metadata.source || 'local' });
    state.videoSource = state.videoMetadata.source;
    state.duration = 0;
    if (previous && previous !== next.url) releaseUrl(previous);
    if (state.videoEl) {
      state.videoEl.volume = 1;
      state.videoEl.src = next.url;
      ensureAudioGraph();
    }
    setLoading(true, 'video');
    mediaChanged('video-loading');
    try {
      if (state.videoEl) await waitForMetadata(state.videoEl, true);
      state.duration = state.videoEl && Number.isFinite(state.videoEl.duration) ? state.videoEl.duration : 0;
      setLoading(false, 'video');
      mediaChanged('video-loaded');
      return state.videoEl;
    } catch (cause) {
      setLoading(false, 'video');
      throw error('The video could not be loaded. Try a supported MP4 or WebM file.', cause);
    }
  }

  async function loadMusic(fileOrUrl, metadata) {
    const info = validateMedia(fileOrUrl, metadata);
    if (info.type !== 'audio') throw error('Choose an MP3, WAV, or OGG audio file.');
    ensureElements();
    const next = makeUrl(fileOrUrl);
    const previous = roleUrls.music;
    if (state.musicEl) {
      state.musicEl.pause();
      state.musicEl.removeAttribute('src');
      state.musicEl.load();
    }
    roleUrls.music = next.owned ? next.url : '';
    state.musicUrl = next.url;
    state.musicMetadata = Object.assign({}, metadata || {}, { name: info.name, mimeType: info.mime, source: metadata && metadata.source || 'local' });
    state.musicSource = state.musicMetadata.source;
    if (previous && previous !== next.url) releaseUrl(previous);
    if (state.musicEl) {
      state.musicEl.volume = 1;
      state.musicEl.src = next.url;
      ensureAudioGraph();
    }
    setLoading(true, 'music');
    mediaChanged('music-loading');
    try {
      if (state.musicEl) await waitForMetadata(state.musicEl, false);
      setLoading(false, 'music');
      mediaChanged('music-loaded');
      return state.musicEl;
    } catch (cause) {
      setLoading(false, 'music');
      throw error('The audio file could not be loaded. Try a supported MP3, WAV, or OGG file.', cause);
    }
  }

  async function loadFiles(files) {
    const list = Array.from(files || []);
    const outcomes = [];
    for (const file of list) {
      try {
        const info = validateMedia(file);
        if (info.type === 'image') {
          const url = makeUrl(file).url;
          const record = { name: info.name, url, type: 'image' };
          state.images.push(record);
          state.assets.push(record);
          outcomes.push(record);
        } else if (info.type === 'video') {
          outcomes.push(await loadVideo(file, { name: info.name, mimeType: info.mime, source: 'local' }));
        } else {
          outcomes.push(await loadMusic(file, { name: info.name, mimeType: info.mime, source: 'local' }));
        }
      } catch (cause) {
        if (!(cause instanceof Error)) error('This file type is not supported.', cause);
      }
    }
    if (state.images.length) await integratePngtuber();
    assetsChanged();
    mediaChanged('files-loaded');
    return outcomes;
  }

  async function integratePngtuber() {
    const module = root.pnuber;
    if (!module || typeof module.addAssets !== 'function') return null;
    try { return await module.addAssets(state.images.slice()); } catch (cause) { error('PNGtuber images were loaded, but could not be added to the layer list.', cause); return null; }
  }

  function stopScreenStream(emitChange) {
    if (!screenStream) return;
    const stream = screenStream;
    screenStream = null;
    state.streams = state.streams.filter(function (item) { return item !== stream; });
    stream.getTracks().forEach(function (track) {
      try { track.stop(); } catch (_) { /* Best-effort cleanup. */ }
    });
    if (state.videoEl && state.videoEl.srcObject === stream) {
      state.videoEl.pause();
      state.videoEl.srcObject = null;
    }
    if (emitChange !== false) mediaChanged('screen-share-stopped');
  }

  async function startScreenShare() {
    const mediaDevices = window.navigator && window.navigator.mediaDevices;
    if (!mediaDevices || typeof mediaDevices.getDisplayMedia !== 'function') {
      throw error('Screen sharing is unavailable. Use a supported browser over HTTPS or localhost.');
    }
    setLoading(true, 'screen-share');
    try {
      const stream = await mediaDevices.getDisplayMedia({ video: true, audio: true });
      ensureElements();
      const oldUrl = roleUrls.video;
      roleUrls.video = '';
      state.videoUrl = '';
      state.videoFileName = 'Screen share';
      state.videoMetadata = { name: 'Screen share', mimeType: 'video/webm', source: 'screen' };
      state.videoSource = 'screen';
      state.duration = 0;
      if (oldUrl) releaseUrl(oldUrl);
      stopScreenStream(false);
      if (state.videoEl) {
        state.videoEl.pause();
        state.videoEl.removeAttribute('src');
        state.videoEl.srcObject = stream;
        state.videoEl.play().catch(function () {});
        ensureAudioGraph();
      }
      screenStream = stream;
      state.streams.push(stream);
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) videoTrack.addEventListener('ended', function () { stopScreenStream(true); });
      stream.getTracks().forEach(function (track) {
        if (track.kind === 'audio') track.addEventListener('ended', function () { mediaChanged('screen-audio-ended'); });
      });
      setLoading(false, 'screen-share');
      mediaChanged('screen-share-started');
      return stream;
    } catch (cause) {
      setLoading(false, 'screen-share');
      if (cause && (cause.name === 'NotAllowedError' || cause.name === 'PermissionDeniedError')) {
        throw error('Screen sharing was cancelled or permission was denied. Your current media was kept.', cause);
      }
      throw error('Could not start screen sharing. Your current media was kept.', cause);
    }
  }

  function authObject() { return root.auth || null; }

  async function authValue(methodNames, propertyNames) {
    const auth = authObject();
    if (!auth) return null;
    for (const name of methodNames) {
      if (typeof auth[name] === 'function') {
        try {
          const value = await auth[name]();
          if (value) return value;
        } catch (_) { /* Try another explicitly named auth helper. */ }
      }
    }
    for (const name of propertyNames) if (auth[name]) return auth[name];
    return null;
  }

  async function driveToken() {
    const value = await authValue(
      ['getDriveAccessToken', 'getGoogleAccessToken', 'getDriveToken'],
      ['driveAccessToken', 'googleAccessToken', 'driveToken']
    );
    if (typeof value === 'string') return value;
    if (value && typeof value.access_token === 'string') return value.access_token;
    if (value && typeof value.token === 'string') return value.token;
    return null;
  }

  async function listDriveFiles() {
    const auth = authObject();
    if (!auth) throw error('Connect Google Drive in Settings before browsing Drive files.');
    setLoading(true, 'drive-list');
    try {
      if (typeof auth.listDriveFiles === 'function') {
        let folderId = 'FSTuber';
        if (typeof auth.ensureDriveFolders === 'function') {
          const folders = await auth.ensureDriveFolders();
          folderId = folders && folders.root ? folders.root : folderId;
        }
        const helperResult = await auth.listDriveFiles(folderId);
        if (Array.isArray(helperResult)) return helperResult.filter(isAllowedDescriptor);
      }
      const token = await driveToken();
      if (!token) throw new Error('Google Drive is not connected.');
      const folderQuery = "name = 'FSTuber' and mimeType = 'application/vnd.google-apps.folder' and trashed = false";
      const folderResponse = await fetch('https://www.googleapis.com/drive/v3/files?' + new URLSearchParams({
        q: folderQuery, fields: 'files(id,name,mimeType)', pageSize: '100'
      }), { headers: { Authorization: 'Bearer ' + token } });
      if (!folderResponse.ok) throw new Error('Google Drive folder lookup failed (' + folderResponse.status + ').');
      const folders = (await folderResponse.json()).files || [];
      const files = [];
      for (const folder of folders) {
        let pageToken = '';
        do {
          const params = new URLSearchParams({
            q: "'" + folder.id + "' in parents and trashed = false",
            fields: 'nextPageToken,files(id,name,mimeType,size,modifiedTime,thumbnailLink)', pageSize: '100'
          });
          if (pageToken) params.set('pageToken', pageToken);
          const response = await fetch('https://www.googleapis.com/drive/v3/files?' + params, { headers: { Authorization: 'Bearer ' + token } });
          if (!response.ok) throw new Error('Google Drive file listing failed (' + response.status + ').');
          const data = await response.json();
          files.push.apply(files, (data.files || []).map(function (file) {
            return Object.assign({}, file, { source: 'drive', driveId: file.id });
          }));
          pageToken = data.nextPageToken || '';
        } while (pageToken);
      }
      return files.filter(isAllowedDescriptor);
    } catch (cause) {
      throw error('Could not list FSTuber files in Google Drive. Check the Drive connection and permissions.', cause);
    } finally {
      setLoading(false, 'drive-list');
    }
  }

  function isAllowedDescriptor(file) {
    if (!file) return false;
    const info = classify(file.name || file.path, file.mimeType || file.type);
    return Boolean(info);
  }

  async function githubHeaders() {
    const auth = authObject();
    if (!auth) return null;
    let headers = await authValue(['getGitHubHeaders', 'githubHeaders'], []);
    if (headers && typeof headers === 'object' && !(headers instanceof Headers)) return headers;
    if (headers instanceof Headers) return headers;
    const tokenValue = await authValue(['getGitHubToken', 'getGitHubPAT'], ['githubToken', 'githubPAT', 'gitHubToken']);
    const token = typeof tokenValue === 'string' ? tokenValue : tokenValue && (tokenValue.token || tokenValue.access_token);
    return token ? { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' } : null;
  }

  async function listGitHubContents(owner, repo, branch, headers) {
    const rootUrl = 'https://api.github.com/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo) + '/contents';
    const directories = [''];
    const files = [];
    let scannedDirectories = 0;
    let truncated = false;
    while (directories.length) {
      if (scannedDirectories >= 5000 || files.length >= 10000) { truncated = true; break; }
      const path = directories.shift();
      const suffix = path ? '/' + path.split('/').map(encodeURIComponent).join('/') : '';
      const url = rootUrl + suffix + '?ref=' + encodeURIComponent(branch);
      scannedDirectories += 1;
      let response;
      try { response = await fetch(url, { headers: Object.assign({ Accept: 'application/vnd.github+json' }, headers) }); }
      catch (cause) {
        if (files.length) { truncated = true; break; }
        throw cause;
      }
      if (!response.ok) {
        if (files.length) { truncated = true; break; }
        throw new Error('GitHub directory listing failed (' + response.status + ').');
      }
      const entries = await response.json();
      if (!Array.isArray(entries)) {
        if (files.length) { truncated = true; break; }
        throw new Error('GitHub did not return a directory listing.');
      }
      entries.forEach(function (item) {
        if (item.type === 'dir') directories.push(item.path);
        else if (item.type === 'file' && isAllowedDescriptor({ name: item.path })) {
          files.push({ type: 'blob', path: item.path, sha: item.sha, size: item.size });
        }
      });
    }
    return { items: files, truncated: truncated || directories.length > 0 };
  }

  async function listGitHubFiles(owner, repo, branch) {
    if (!owner || !repo || !branch) throw error('Choose a GitHub owner, repository, and branch first.');
    setLoading(true, 'github-list');
    try {
      const headers = await githubHeaders();
      if (!headers) throw new Error('GitHub is not connected. Add a session token in Settings.');
      const url = 'https://api.github.com/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo) + '/git/trees/' + encodeURIComponent(branch) + '?recursive=1';
      const response = await fetch(url, { headers: Object.assign({ Accept: 'application/vnd.github+json' }, headers) });
      if (!response.ok) throw new Error('GitHub repository request failed (' + response.status + ').');
      const data = await response.json();
      let tree = data.tree || [];
      let truncated = Boolean(data.truncated);
      if (truncated) {
        const fallback = await listGitHubContents(owner, repo, branch, headers);
        tree = fallback.items;
        truncated = fallback.truncated;
      }
      const files = tree.filter(function (item) {
        return item.type === 'blob' && isAllowedDescriptor({ name: item.path });
      }).map(function (item) {
        return {
          name: basename(item.path), path: item.path, sha: item.sha, size: item.size,
          type: 'github', source: 'github', owner, repo, branch,
          downloadUrl: 'https://api.github.com/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo) + '/contents/' + item.path.split('/').map(encodeURIComponent).join('/') + '?ref=' + encodeURIComponent(branch)
        };
      });
      files.truncated = truncated;
      return files;
    } catch (cause) {
      throw error('Could not list GitHub media. Check the token and repository read access.', cause);
    } finally {
      setLoading(false, 'github-list');
    }
  }

  async function fetchRemoteBlob(descriptor) {
    const source = descriptor.source || descriptor.provider || descriptor.type;
    if (source === 'drive' || descriptor.driveId || descriptor.id && descriptor.mimeType && !descriptor.owner) {
      const token = await driveToken();
      if (!token) throw new Error('Google Drive is not connected.');
      const id = descriptor.driveId || descriptor.id;
      const response = await fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) + '?alt=media', {
        headers: { Authorization: 'Bearer ' + token }
      });
      if (!response.ok) throw new Error('Google Drive download failed (' + response.status + ').');
      return response.blob();
    }
    if (source === 'github' || descriptor.owner && descriptor.repo) {
      const headers = await githubHeaders();
      if (!headers) throw new Error('GitHub is not connected. Add a session token in Settings.');
      const url = descriptor.downloadUrl || descriptor.url;
      if (!url) throw new Error('GitHub file URL is missing.');
      const response = await fetch(url, { headers: Object.assign({ Accept: 'application/vnd.github.raw+json' }, headers) });
      if (!response.ok) throw new Error('GitHub download failed (' + response.status + ').');
      const blob = await response.blob();
      const contentType = response.headers.get('content-type') || descriptor.mimeType || '';
      return contentType.includes('application/json') ? decodeGitHubContents(blob, descriptor) : blob;
    }
    const url = descriptor.downloadUrl || descriptor.url;
    if (!url) throw new Error('Remote media URL is missing.');
    const response = await fetch(url);
    if (!response.ok) throw new Error('Media download failed (' + response.status + ').');
    return response.blob();
  }

  async function decodeGitHubContents(blob, descriptor) {
    const payload = await blob.text();
    const data = JSON.parse(payload);
    if (!data.content || data.encoding !== 'base64') throw new Error('GitHub did not return a readable file.');
    const binary = atob(data.content.replace(/\s/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new Blob([bytes], { type: descriptor.mimeType || '' });
  }

  async function loadRemoteThumbnail(fileDescriptor) {
    if (!fileDescriptor || !isAllowedDescriptor(fileDescriptor)) return '';
    const info = validateMedia(fileDescriptor.name || fileDescriptor.path, fileDescriptor.mimeType || fileDescriptor.type);
    if (info.type !== 'image' || Number(fileDescriptor.size) > 2_000_000) return '';
    const blob = await fetchRemoteBlob(fileDescriptor);
    const typedBlob = blob.type ? blob : new Blob([blob], { type: info.mime });
    const url = URL.createObjectURL(typedBlob);
    objectUrls.add(url);
    thumbnailUrls.add(url);
    return url;
  }

  async function importRemoteFile(fileDescriptor) {
    if (!fileDescriptor || !isAllowedDescriptor(fileDescriptor)) throw error('This remote file type is not supported.');
    const info = validateMedia(fileDescriptor.name || fileDescriptor.path, fileDescriptor.mimeType || fileDescriptor.type);
    setLoading(true, 'remote-import');
    try {
      const blob = await fetchRemoteBlob(fileDescriptor);
      const typedBlob = blob.type ? blob : new Blob([blob], { type: info.mime });
      const metadata = Object.assign({}, fileDescriptor, { name: info.name, mimeType: info.mime, source: fileDescriptor.source || fileDescriptor.provider || fileDescriptor.type });
      if (info.type === 'image') {
        const url = makeUrl(typedBlob).url;
        const record = { name: info.name, url, type: 'image' };
        state.images.push(record);
        state.assets.push(record);
        await integratePngtuber();
        assetsChanged();
        mediaChanged('remote-image-imported');
        return record;
      }
      if (info.type === 'video') return await loadVideo(typedBlob, metadata);
      return await loadMusic(typedBlob, metadata);
    } catch (cause) {
      throw error('Could not import the selected remote file. Check its access and try again.', cause);
    } finally {
      setLoading(false, 'remote-import');
    }
  }

  function clearAssets() {
    clearThumbnails();
    stopScreenStream(false);
    if (state.videoEl) {
      try { state.videoEl.pause(); state.videoEl.removeAttribute('src'); if (state.videoEl.srcObject) state.videoEl.srcObject = null; state.videoEl.load(); } catch (_) { /* Best-effort element cleanup. */ }
    }
    if (state.musicEl) {
      try { state.musicEl.pause(); state.musicEl.removeAttribute('src'); state.musicEl.load(); } catch (_) { /* Best-effort element cleanup. */ }
    }
    Array.from(objectUrls).forEach(releaseUrl);
    roleUrls.video = '';
    roleUrls.music = '';
    state.videoUrl = '';
    state.musicUrl = '';
    state.videoFileName = '';
    state.duration = 0;
    state.images = [];
    state.assets = [];
    state.videoMetadata = null;
    state.musicMetadata = null;
    state.videoSource = null;
    state.musicSource = null;
    assetsChanged();
    mediaChanged('cleared');
  }

  function setVideoVolume(value) {
    const volume = clampVolume(value);
    if (ensureAudioGraph() && state.videoGain) {
      state.videoGain.gain.value = volume;
      if (state.videoEl) state.videoEl.volume = 1;
    } else if (state.videoEl) state.videoEl.volume = volume;
    return volume;
  }

  function setMusicVolume(value) {
    const volume = clampVolume(value);
    if (ensureAudioGraph() && state.musicGain) {
      state.musicGain.gain.value = volume;
      if (state.musicEl) state.musicEl.volume = 1;
    } else if (state.musicEl) state.musicEl.volume = volume;
    return volume;
  }

  function getAudioLevels() {
    ensureAudioGraph();
    function level(analyser) {
      if (!analyser || typeof analyser.getByteTimeDomainData !== 'function') return 0;
      const samples = new Uint8Array(analyser.fftSize);
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (let index = 0; index < samples.length; index += 1) {
        const sample = (samples[index] - 128) / 128;
        sum += sample * sample;
      }
      return Math.max(0, Math.min(1, Math.sqrt(sum / samples.length) * 3));
    }
    return { video: level(state.videoAnalyser), music: level(state.musicAnalyser) };
  }

  function clampVolume(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : 1;
  }

  function getMixedAudioStream() {
    ensureElements();
    if (!ensureAudioGraph() || !state.audioDestination) return null;
    if (state.audioContext.state === 'suspended') state.audioContext.resume().catch(function () {});
    return state.audioDestination.stream;
  }

  function stopStreams() {
    state.streams.slice().forEach(function (stream) {
      stream.getTracks().forEach(function (track) {
        try { track.stop(); } catch (_) { /* Best-effort cleanup. */ }
      });
    });
    state.streams = [];
    if (screenStream) stopScreenStream(false);
    if (state.videoEl && state.videoEl.srcObject) {
      try { state.videoEl.pause(); state.videoEl.srcObject = null; } catch (_) { /* Best-effort cleanup. */ }
    }
    mediaChanged('streams-stopped');
  }

  function init() {
    if (initialized) return getState();
    initialized = true;
    ensureElements();
    ensureAudioGraph();
    return getState();
  }

  root.media = {
    init,
    getState,
    loadFiles,
    loadVideo,
    loadMusic,
    startScreenShare,
    listDriveFiles,
    listGitHubFiles,
    importRemoteFile,
    loadRemoteThumbnail,
    clearThumbnails,
    clearAssets,
    setVideoVolume,
    setMusicVolume,
    getAudioLevels,
    getMixedAudioStream,
    stopStreams
  };
})(window);
