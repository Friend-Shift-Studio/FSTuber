/* Responsibility: default and persisted preferences, Drive-backed settings synchronization, themes, and user CSS. */
(function initializeSettingsModule(root) {
  'use strict';

  const app = root.FSTuber = root.FSTuber || {};
  const STORAGE_KEY = 'fstuber-settings';
  const DRIVE_SETTINGS_NAME = 'settings.json';

  const DEFAULT_SETTINGS = {
    theme: 'dark',
    customCSS: '',
    shortcuts: { '1': 'idle', '2': 'talk', '3': 'laugh' },
    musicVolume: 0.5,
    videoVolume: 1,
    lastExportName: '',
    lastExportPath: '',
    pnuberPosition: { x: 20, y: 20, scale: 1 },
    googleClientId: '',
    spotifyClientId: '',
    mediaPaths: [],
    lastMediaPath: '',
    lastDriveFolder: '',
    lastGitHubRepo: '',
    customStates: [],
    loops: {},
    layers: [],
    pnuberLayers: [],
    markers: [],
    exportPresets: [],
    exportProfiles: [
      { id: 'source-webm', name: 'Source WebM', format: 'webm', resolution: 'source' },
      { id: '720p-mp4', name: '720p MP4', format: 'mp4', resolution: '720p' },
      { id: '1080p-mp4', name: '1080p MP4', format: 'mp4', resolution: '1080p' }
    ],
    recordingResolution: 'source',
    showRecordingFps: false,
    backgroundColor: '#202124'
  };

  root.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
  app.DEFAULT_SETTINGS = DEFAULT_SETTINGS;

  let settings = clone(DEFAULT_SETTINGS);
  let loaded = false;
  let saveQueue = Promise.resolve();

  function clone(value) {
    if (typeof root.structuredClone === 'function') return root.structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function merge(base, incoming) {
    const result = isPlainObject(base) ? clone(base) : {};
    if (!isPlainObject(incoming)) return result;
    for (const [key, value] of Object.entries(incoming)) {
      if (key === 'githubToken' || key === 'githubPAT' || key === 'githubAccessToken') continue;
      if (key === 'shortcuts' && isPlainObject(value)) result[key] = clone(value);
      else if (isPlainObject(value) && isPlainObject(result[key])) result[key] = merge(result[key], value);
      else result[key] = value;
    }
    return result;
  }

  function toast(message, type) {
    try {
      if (app.ui && typeof app.ui.toast === 'function') {
        app.ui.toast(message, type || 'info');
        return;
      }
    } catch (_) { /* Keep settings usable without the UI module. */ }
    try { root.dispatchEvent(new CustomEvent('fstuber:toast', { detail: { message, type: type || 'info' } })); }
    catch (_) { if (root.console && root.console.warn) root.console.warn(message); }
  }

  function readLocalSettings() {
    try {
      const raw = root.localStorage.getItem(STORAGE_KEY);
      if (!raw) return { found: false, value: null };
      const parsed = JSON.parse(raw);
      if (!isPlainObject(parsed)) throw new Error('Settings must be an object.');
      return { found: true, value: parsed };
    } catch (error) {
      if (error && error.name !== 'SecurityError' && root.console && root.console.warn) {
        root.console.warn('Saved settings could not be read; defaults will be used.');
      }
      return { found: false, value: null };
    }
  }

  function connectedGoogle() {
    return Boolean(app.auth && app.auth.state && app.auth.state.googleToken);
  }

  async function readDriveSettings() {
    if (!connectedGoogle() || !app.auth || typeof app.auth.getFolderId !== 'function' || typeof app.auth.driveRequest !== 'function') return null;
    try {
      if (typeof app.auth.ensureDriveFolders === 'function') await app.auth.ensureDriveFolders();
      const folderId = await app.auth.getFolderId('configuration');
      if (!folderId) return null;
      const query = new URLSearchParams({
        q: `name = '${DRIVE_SETTINGS_NAME}' and '${folderId}' in parents and trashed = false`,
        fields: 'files(id,name,mimeType)',
        pageSize: '10'
      });
      const response = await app.auth.driveRequest(`/files?${query.toString()}`);
      if (!response || !response.ok) return null;
      const listing = await response.json();
      const file = Array.isArray(listing.files) ? listing.files.find(item => item.mimeType !== 'application/vnd.google-apps.folder') : null;
      if (!file) return null;
      const contentResponse = await app.auth.driveRequest(`/files/${encodeURIComponent(file.id)}?alt=media`);
      if (!contentResponse || !contentResponse.ok) return null;
      const data = await contentResponse.json();
      return isPlainObject(data) ? data : null;
    } catch (error) {
      if (root.console && root.console.warn) root.console.warn('Drive settings could not be loaded.');
      return null;
    }
  }

  async function writeDriveSettings(snapshot) {
    if (!connectedGoogle() || !app.auth || typeof app.auth.getFolderId !== 'function' || typeof app.auth.driveRequest !== 'function') return false;
    if (typeof app.auth.ensureDriveFolders === 'function') await app.auth.ensureDriveFolders();
    const configurationId = await app.auth.getFolderId('configuration');
    if (!configurationId) throw new Error('Configuration folder unavailable.');

    const query = new URLSearchParams({
      q: `name = '${DRIVE_SETTINGS_NAME}' and '${configurationId}' in parents and trashed = false`,
      fields: 'files(id,name,mimeType)',
      pageSize: '10'
    });
    const listResponse = await app.auth.driveRequest(`/files?${query.toString()}`);
    if (!listResponse || !listResponse.ok) throw new Error('Unable to check the settings file.');
    const listing = await listResponse.json();
    const existing = Array.isArray(listing.files) ? listing.files.find(item => item.mimeType !== 'application/vnd.google-apps.folder') : null;
    const body = JSON.stringify(snapshot, null, 2);

    if (existing) {
      const response = await app.auth.driveRequest(`/files/${encodeURIComponent(existing.id)}?uploadType=media`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body
      });
      if (!response || !response.ok) throw new Error('Unable to update the app settings file.');
      return true;
    }

    const boundary = `fstuber_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    const metadata = JSON.stringify({ name: DRIVE_SETTINGS_NAME, mimeType: 'application/json', parents: [configurationId] });
    const multipart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${body}\r\n--${boundary}--`;
    const response = await app.auth.driveRequest('/files?uploadType=multipart&fields=id,name', {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: multipart
    });
    if (!response || !response.ok) throw new Error('Unable to create the app settings file.');
    return true;
  }

  function sanitizedSnapshot(candidate) {
    const snapshot = merge(DEFAULT_SETTINGS, candidate);
    delete snapshot.githubToken;
    delete snapshot.githubPAT;
    delete snapshot.githubAccessToken;
    return snapshot;
  }

  async function loadSettings() {
    const local = readLocalSettings();
    settings = merge(DEFAULT_SETTINGS, local.value || {});
    const driveValue = await readDriveSettings();
    if (driveValue) settings = merge(settings, driveValue);
    settings = sanitizedSnapshot(settings);
    loaded = true;

    applyTheme(settings.theme);
    applyCustomCSS(settings.customCSS);

    if (!local.found) {
      persistLocal(settings);
      if (connectedGoogle()) {
        try { await writeDriveSettings(settings); }
        catch (_) { toast('Defaults were saved locally; Drive sync is unavailable.', 'warning'); }
      }
    }
    return get();
  }

  function persistLocal(candidate) {
    const snapshot = sanitizedSnapshot(candidate);
    try {
      root.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
      return true;
    } catch (error) {
      toast('Settings could not be saved in this browser.', 'error');
      return false;
    }
  }

  async function saveSettings(partialOrWhole) {
    const updates = isPlainObject(partialOrWhole) ? partialOrWhole : {};
    const previousCustomCSS = settings.customCSS;
    settings = merge(settings, updates);
    if (isPlainObject(updates.shortcuts)) settings.shortcuts = clone(updates.shortcuts);
    settings = sanitizedSnapshot(settings);
    if (Object.prototype.hasOwnProperty.call(updates, 'theme')) applyTheme(settings.theme);
    if (Object.prototype.hasOwnProperty.call(updates, 'customCSS') && !applyCustomCSS(settings.customCSS)) {
      settings.customCSS = previousCustomCSS;
    }

    const localSaved = persistLocal(settings);
    if (connectedGoogle()) {
      const queued = saveQueue.then(() => writeDriveSettings(settings));
      saveQueue = queued.catch(() => {});
      try { await queued; }
      catch (_) { toast('Settings are saved locally; Drive sync failed.', 'warning'); }
    }
    return localSaved ? get() : false;
  }

  function get() {
    return clone(settings);
  }

  function setPath(target, path, value) {
    const parts = String(path).split('.').filter(Boolean);
    if (!parts.length) return;
    let cursor = target;
    for (const part of parts.slice(0, -1)) {
      if (!isPlainObject(cursor[part])) cursor[part] = {};
      cursor = cursor[part];
    }
    cursor[parts[parts.length - 1]] = value;
  }

  function update(key, value) {
    if (typeof key === 'string') {
      const next = get();
      setPath(next, key, value);
      return saveSettings(next);
    }
    return saveSettings(key);
  }

  async function reset() {
    settings = clone(DEFAULT_SETTINGS);
    applyTheme(settings.theme);
    applyCustomCSS('', { quiet: true });
    return saveSettings(settings);
  }

  function applyTheme(theme) {
    const selected = theme === 'light' ? 'light' : 'dark';
    if (root.document && root.document.documentElement) root.document.documentElement.dataset.theme = selected;
    if (root.document) {
      let meta = root.document.querySelector('meta[name="theme-color"]');
      if (!meta) {
        meta = root.document.createElement('meta');
        meta.name = 'theme-color';
        root.document.head.appendChild(meta);
      }
      meta.content = selected === 'light' ? '#f5f5f7' : '#08090a';
    }
    return selected;
  }

  function validateCustomCSS(css) {
    if (typeof css !== 'string') return { valid: false, reason: 'Custom CSS must be text.' };
    if (!css.trim()) return { valid: true, css: '' };

    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
    if (/\/\*/.test(withoutComments)) return { valid: false, reason: 'Custom CSS contains an unfinished comment.' };
    if (/@\s*import\b/i.test(withoutComments)) return { valid: false, reason: '@import is not allowed in custom CSS.' };
    if (/\burl\s*\(/i.test(withoutComments)) return { valid: false, reason: 'url(...) is not allowed in custom CSS.' };
    if (/<\s*\/\s*style/i.test(withoutComments)) return { valid: false, reason: 'A style-closing tag is not allowed.' };
    if (/\bexpression\s*\(/i.test(withoutComments)) return { valid: false, reason: 'Unsafe CSS expressions are not allowed.' };

    let depth = 0;
    let quote = '';
    let escaped = false;
    for (const char of withoutComments) {
      if (escaped) { escaped = false; continue; }
      if (char === '\\') { escaped = true; continue; }
      if (quote) { if (char === quote) quote = ''; continue; }
      if (char === '"' || char === "'") { quote = char; continue; }
      if (char === '{') depth += 1;
      if (char === '}') { depth -= 1; if (depth < 0) return { valid: false, reason: 'Custom CSS has unmatched braces.' }; }
    }
    if (quote || depth !== 0) return { valid: false, reason: 'Custom CSS has unfinished quotes or braces.' };

    const hazardousProperties = /\b(?:all|display|position|inset|top|right|bottom|left|width|min-width|max-width|height|min-height|max-height|margin(?:-[\w-]+)?|padding(?:-[\w-]+)?|overflow(?:-[\w-]+)?)\s*:/i;
    const globalRule = /([^{}]+)\{([^{}]*)\}/g;
    let match;
    while ((match = globalRule.exec(withoutComments))) {
      const selectors = match[1].trim().split(',');
      const targetsGlobalLayout = selectors.some(selector => /^(?:\*|\*::(?:before|after)|html|body|:root)(?:$|\b|\s|[:.#[])/i.test(selector.trim()));
      if (targetsGlobalLayout && hazardousProperties.test(match[2])) {
        return { valid: false, reason: 'A global layout reset could break the editor. Use a specific component selector instead.' };
      }
    }
    return { valid: true, css };
  }

  function applyCustomCSS(css, options) {
    const opts = options || {};
    const validation = validateCustomCSS(css);
    if (!validation.valid) {
      if (!opts.quiet) toast(validation.reason, 'warning');
      return false;
    }
    if (!root.document) return false;

    let style = root.document.getElementById('user-custom-css');
    if (!validation.css) {
      if (style) style.remove();
      return true;
    }

    if (!style) {
      style = root.document.createElement('style');
      style.id = 'user-custom-css';
      root.document.head.appendChild(style);
    }
    const previousText = style.textContent;
    style.textContent = validation.css;
    try {
      if (style.sheet && style.sheet.cssRules.length === 0 && validation.css.trim()) {
        style.textContent = previousText;
        if (!opts.quiet) toast('Custom CSS could not be parsed; previous styling was kept.', 'warning');
        return false;
      }
    } catch (_) {
      style.textContent = previousText;
      if (!opts.quiet) toast('Custom CSS could not be parsed; previous styling was kept.', 'warning');
      return false;
    }
    return true;
  }

  app.settings = {
    DEFAULT_SETTINGS,
    loadSettings,
    saveSettings,
    get,
    update,
    reset,
    applyTheme,
    applyCustomCSS,
    validateCustomCSS,
    isLoaded: () => loaded
  };
})(typeof window !== 'undefined' ? window : globalThis);
