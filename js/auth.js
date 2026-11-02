/* Responsibility: optional client-side Google Drive, Spotify PKCE, and GitHub connections. */
(function initializeAuthModule(root) {
  'use strict';

  const app = root.FSTuber = root.FSTuber || {};
  const GOOGLE_API = 'https://www.googleapis.com/drive/v3';
  const GITHUB_API = 'https://api.github.com';
  const SPOTIFY_AUTH = 'https://accounts.spotify.com/authorize';
  const SPOTIFY_TOKEN = 'https://accounts.spotify.com/api/token';
  const SPOTIFY_SCOPES = 'user-read-playback-state user-modify-playback-state user-read-currently-playing playlist-read-private user-library-read';
  const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';
  const GITHUB_SESSION_KEY = 'fstuber-github-token';
  const SPOTIFY_VERIFIER_KEY = 'fstuber-spotify-pkce-verifier';
  const SPOTIFY_STATE_KEY = 'fstuber-spotify-oauth-state';

  const state = {
    googleToken: null,
    spotifyAccessToken: null,
    spotifyRefreshToken: null,
    spotifyExpiresAt: 0,
    githubToken: null,
    user: { google: null, spotify: null, github: null },
    status: { google: 'disconnected', spotify: 'disconnected', github: 'disconnected' }
  };

  let googleTokenClient = null;
  let googleRequestPending = null;
  let spotifyRefreshPromise = null;
  let folderIds = { root: null, configuration: null };

  function settings() {
    try { return app.settings && typeof app.settings.get === 'function' ? app.settings.get() : {}; }
    catch (_) { return {}; }
  }

  function toast(message, type) {
    try {
      if (app.ui && typeof app.ui.toast === 'function') {
        app.ui.toast(message, type || 'info');
        return;
      }
    } catch (_) { /* The integrations remain usable before the UI mounts. */ }
    try { root.dispatchEvent(new CustomEvent('fstuber:toast', { detail: { message, type: type || 'info' } })); }
    catch (_) { if (root.console && root.console.warn) root.console.warn(message); }
  }

  function statusChanged(service) {
    const connected = state.status[service] === 'connected';
    const user = state.user[service];
    try {
      if (app.ui && typeof app.ui.setConnectionStatus === 'function') {
        app.ui.setConnectionStatus(service, connected, user);
      }
    } catch (_) { /* Status events are advisory; they must not break auth. */ }
    try {
      root.dispatchEvent(new CustomEvent('fstuber:connection-status', {
        detail: { service, connected, status: state.status[service], user }
      }));
    } catch (_) { /* Custom events may be unavailable in non-browser test contexts. */ }
  }

  function setStatus(service, connected, user) {
    state.status[service] = connected ? 'connected' : 'disconnected';
    state.user[service] = connected ? (user || null) : null;
    statusChanged(service);
  }

  function missingCredential(service, fieldId, label) {
    const credential = label === 'GitHub token' ? 'token' : 'Client ID';
    const message = `Please add your ${service} ${credential} first. Instructions are below the field.`;
    try {
      if (app.ui && typeof app.ui.openSettings === 'function') app.ui.openSettings('api-setup');
    } catch (_) { /* Fall back to the standard settings event. */ }
    try {
      root.dispatchEvent(new CustomEvent('fstuber:open-settings', { detail: { section: 'api-setup', fieldId } }));
    } catch (_) { /* Optional UI integration. */ }
    const focusField = () => {
      if (!root.document) return;
      const field = root.document.getElementById(fieldId) || root.document.querySelector(`[name="${fieldId}"]`);
      if (!field) return;
      try {
        field.scrollIntoView({ block: 'center', behavior: 'smooth' });
        field.focus({ preventScroll: true });
        field.classList.add('field-needs-attention');
        field.setAttribute('aria-invalid', 'true');
        root.setTimeout(() => {
          field.classList.remove('field-needs-attention');
          field.removeAttribute('aria-invalid');
        }, 5000);
      } catch (_) { /* The settings UI may not be mounted yet. */ }
    };
    root.setTimeout(focusField, 50);
    toast(message, 'warning');
    return false;
  }

  function configuredNotice() {
    const values = settings();
    if (values.googleClientId && values.spotifyClientId && getGitHubToken()) return;
    toast('Google / GitHub / Spotify connection requires a client ID. See Settings → API Setup for instructions. GitHub uses a fine-grained read token instead of a client ID.', 'info');
  }

  function safeError(error, fallback) {
    const text = error && typeof error.message === 'string' ? error.message : '';
    if (!text || /token|secret|authorization|bearer|code_verifier|access_token/i.test(text)) return fallback;
    return text.slice(0, 220);
  }

  function apiError(response, service) {
    const status = response && response.status ? ` (${response.status})` : '';
    return new Error(`${service} request failed${status}.`);
  }

  function normalizeDrivePath(path) {
    if (/^https:\/\//i.test(String(path))) {
      const absolute = new URL(String(path));
      if (absolute.origin !== 'https://www.googleapis.com' || !absolute.pathname.startsWith('/drive/v3/')) {
        throw new Error('Unsupported Google Drive API URL.');
      }
      return absolute.toString();
    }
    const clean = String(path || '').replace(/^\/+/, '');
    return `${GOOGLE_API}/${clean}`;
  }

  async function driveRequest(path, options) {
    if (!state.googleToken) throw new Error('Google Drive is not connected.');
    const opts = options || {};
    const headers = new Headers(opts.headers || {});
    headers.set('Authorization', `Bearer ${state.googleToken}`);
    let response;
    try {
      response = await root.fetch(normalizeDrivePath(path), { ...opts, headers });
    } catch (_) {
      throw new Error('Google Drive is unavailable. Check your connection and try again.');
    }
    if (response.status === 401) {
      state.googleToken = null;
      setStatus('google', false);
      throw new Error('Google Drive authorization expired. Reconnect Google Drive.');
    }
    return response;
  }

  async function findDriveFolder(name, parentId) {
    const clauses = [`name = '${String(name).replace(/'/g, "\\'")}'`, `mimeType = '${DRIVE_FOLDER_MIME}'`, 'trashed = false'];
    if (parentId) clauses.push(`'${parentId}' in parents`);
    else clauses.push("'root' in parents");
    const query = new URLSearchParams({ q: clauses.join(' and '), fields: 'files(id,name,mimeType,parents)', pageSize: '100' });
    const response = await driveRequest(`/files?${query.toString()}`);
    if (!response.ok) throw apiError(response, 'Google Drive');
    const result = await response.json();
    return Array.isArray(result.files) ? result.files.find(file => file.name === name && file.mimeType === DRIVE_FOLDER_MIME) || null : null;
  }

  async function createDriveFolder(name, parentId) {
    const metadata = { name, mimeType: DRIVE_FOLDER_MIME };
    if (parentId) metadata.parents = [parentId];
    const response = await driveRequest('/files?fields=id,name,mimeType,parents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metadata)
    });
    if (!response.ok) throw apiError(response, 'Google Drive');
    return response.json();
  }

  async function getFolderId(name, parentId) {
    if (name === 'configuration' && !parentId && !folderIds.root) {
      const rootFolder = await findDriveFolder('FSTuber');
      if (!rootFolder) return null;
      folderIds.root = rootFolder.id;
    }
    const actualParent = parentId || (name === 'configuration' ? folderIds.root : null);
    if (name === 'FSTuber' && !actualParent && folderIds.root) return folderIds.root;
    if (name === 'configuration' && actualParent && folderIds.configuration) return folderIds.configuration;
    const folder = await findDriveFolder(name, actualParent);
    if (!folder) return null;
    if (name === 'FSTuber' && !actualParent) folderIds.root = folder.id;
    if (name === 'configuration' && actualParent === folderIds.root) folderIds.configuration = folder.id;
    return folder.id;
  }

  async function ensureDriveFolders() {
    if (!state.googleToken) throw new Error('Google Drive is not connected.');
    let rootId = await getFolderId('FSTuber');
    if (!rootId) rootId = (await createDriveFolder('FSTuber')).id;
    folderIds.root = rootId;
    let configurationId = await getFolderId('configuration', rootId);
    if (!configurationId) configurationId = (await createDriveFolder('configuration', rootId)).id;
    folderIds.configuration = configurationId;
    return { root: rootId, configuration: configurationId };
  }

  function loadGoogleIdentity() {
    return new Promise((resolve, reject) => {
      const clientId = settings().googleClientId;
      if (!clientId) return reject(new Error('missing-google-client-id'));
      if (!root.google || !root.google.accounts || !root.google.accounts.oauth2) {
        return reject(new Error('Google sign-in is not ready. Check the network and try again.'));
      }
      try {
        if (!googleTokenClient) {
          googleTokenClient = root.google.accounts.oauth2.initTokenClient({
            client_id: clientId,
            scope: 'https://www.googleapis.com/auth/drive.file',
            callback: response => {
              if (googleRequestPending) {
                const pending = googleRequestPending;
                googleRequestPending = null;
                if (response && response.access_token) pending.resolve(response.access_token);
                else pending.reject(new Error('Google authorization was not completed.'));
              }
            },
            error_callback: () => {
              if (googleRequestPending) {
                const pending = googleRequestPending;
                googleRequestPending = null;
                pending.reject(new Error('Google authorization was not completed.'));
              }
            }
          });
        }
        googleRequestPending = { resolve, reject };
        googleTokenClient.requestAccessToken({ prompt: 'consent' });
      } catch (_) {
        googleRequestPending = null;
        reject(new Error('Google sign-in could not be started.'));
      }
    });
  }

  async function connectGoogle() {
    if (!settings().googleClientId) return missingCredential('Google', 'google-client-id');
    if (googleRequestPending) return false;
    try {
      state.status.google = 'connecting';
      statusChanged('google');
      state.googleToken = await loadGoogleIdentity();
      setStatus('google', true, 'Google Drive');
      await ensureDriveFolders();
      toast('Google Drive connected.', 'success');
      return true;
    } catch (error) {
      state.googleToken = null;
      setStatus('google', false);
      const message = error && error.message === 'missing-google-client-id'
        ? 'Google sign-in could not start.'
        : safeError(error, 'Google Drive connection failed. Check your client ID and authorized origin.');
      toast(message, 'error');
      return false;
    }
  }

  async function listDriveFiles(folderId) {
    if (!state.googleToken) throw new Error('Google Drive is not connected.');
    const targetFolder = folderId || (await ensureDriveFolders()).root;
    const files = [];
    let pageToken = '';
    do {
      const query = new URLSearchParams({
        q: `'${targetFolder}' in parents and trashed = false`,
        fields: 'nextPageToken,files(id,name,mimeType,size,modifiedTime,thumbnailLink,webViewLink,parents)',
        orderBy: 'name',
        pageSize: '1000'
      });
      if (pageToken) query.set('pageToken', pageToken);
      const response = await driveRequest(`/files?${query.toString()}`);
      if (!response.ok) throw apiError(response, 'Google Drive');
      const result = await response.json();
      if (Array.isArray(result.files)) files.push(...result.files);
      pageToken = result.nextPageToken || '';
    } while (pageToken);
    return files;
  }

  function uniqueName(candidate, names) {
    if (!names.has(candidate)) return candidate;
    const dot = candidate.lastIndexOf('.');
    const stem = dot > 0 ? candidate.slice(0, dot) : candidate;
    const extension = dot > 0 ? candidate.slice(dot) : '';
    let index = 2;
    while (names.has(`${stem} (${index})${extension}`)) index += 1;
    return `${stem} (${index})${extension}`;
  }

  async function uploadDriveFile(file, name, folderId) {
    if (!state.googleToken) throw new Error('Google Drive is not connected.');
    if (!file) throw new Error('Choose a file to upload.');
    const folders = folderId ? null : await ensureDriveFolders();
    const targetFolder = folderId || folders.root;
    const current = await listDriveFiles(targetFolder);
    const requestedName = String(name || file.name || 'export');
    const uploadName = uniqueName(requestedName, new Set(current.map(item => item.name)));
    const metadata = JSON.stringify({ name: uploadName, parents: [targetFolder] });
    const boundary = `fstuber_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    const fileBlob = file instanceof Blob ? file : new Blob([file], { type: 'application/octet-stream' });
    const multipart = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${fileBlob.type || 'application/octet-stream'}\r\n\r\n`,
      fileBlob,
      `\r\n--${boundary}--`
    ], { type: `multipart/related; boundary=${boundary}` });
    const response = await driveRequest('/files?uploadType=multipart&fields=id,name,mimeType,size,webViewLink,parents', {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: multipart
    });
    if (!response.ok) throw apiError(response, 'Google Drive upload');
    const uploaded = await response.json();
    if (uploadName !== requestedName) toast(`File already existed; saved as ${uploadName}.`, 'info');
    return uploaded;
  }

  function spotifyRedirectUri() {
    return `${root.location.origin}${root.location.pathname}`;
  }

  function randomString(length) {
    const bytes = new Uint8Array(length);
    root.crypto.getRandomValues(bytes);
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function base64Url(bytes) {
    let binary = '';
    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    return root.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  async function createCodeChallenge(verifier) {
    const encoded = new TextEncoder().encode(verifier);
    const digest = await root.crypto.subtle.digest('SHA-256', encoded);
    return base64Url(new Uint8Array(digest));
  }

  function clearSpotifyRedirect() {
    try { root.history.replaceState({}, root.document.title, `${root.location.pathname}${root.location.hash || ''}`); }
    catch (_) { /* URL cleanup is best effort. */ }
  }

  async function connectSpotify() {
    const clientId = settings().spotifyClientId;
    if (!clientId) return missingCredential('Spotify', 'spotify-client-id');
    if (!root.crypto || !root.crypto.subtle || !root.sessionStorage) {
      toast('Spotify PKCE is unavailable in this browser context. Use the app on HTTPS.', 'error');
      return false;
    }
    try {
      const verifier = randomString(64);
      const challenge = await createCodeChallenge(verifier);
      const oauthState = randomString(24);
      root.sessionStorage.setItem(SPOTIFY_VERIFIER_KEY, verifier);
      root.sessionStorage.setItem(SPOTIFY_STATE_KEY, oauthState);
      const params = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        scope: SPOTIFY_SCOPES,
        redirect_uri: spotifyRedirectUri(),
        state: oauthState,
        code_challenge_method: 'S256',
        code_challenge: challenge
      });
      root.location.assign(`${SPOTIFY_AUTH}?${params.toString()}`);
      return true;
    } catch (_) {
      toast('Spotify authorization could not be started. Check the client ID and exact redirect URI.', 'error');
      return false;
    }
  }

  async function checkSpotifyCallback() {
    if (!root.location || !root.location.search) return false;
    const params = new URLSearchParams(root.location.search);
    const code = params.get('code');
    const receivedState = params.get('state');
    const oauthError = params.get('error');
    if (!code && !oauthError) return false;
    const expectedState = root.sessionStorage && root.sessionStorage.getItem(SPOTIFY_STATE_KEY);
    const verifier = root.sessionStorage && root.sessionStorage.getItem(SPOTIFY_VERIFIER_KEY);
    if (root.sessionStorage) {
      root.sessionStorage.removeItem(SPOTIFY_STATE_KEY);
      root.sessionStorage.removeItem(SPOTIFY_VERIFIER_KEY);
    }
    clearSpotifyRedirect();

    if (oauthError) {
      toast(oauthError === 'access_denied' ? 'Spotify authorization was canceled.' : 'Spotify authorization failed. Check your client ID and redirect URI.', 'warning');
      return false;
    }
    if (!code || !expectedState || receivedState !== expectedState || !verifier) {
      toast('Spotify authorization could not be verified. Reconnect and try again.', 'error');
      return false;
    }

    const clientId = settings().spotifyClientId;
    if (!clientId) return missingCredential('Spotify', 'spotify-client-id');
    const form = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: spotifyRedirectUri(),
      client_id: clientId,
      code_verifier: verifier
    });
    try {
      const response = await root.fetch(SPOTIFY_TOKEN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString()
      });
      if (!response.ok) {
        let details = {};
        try { details = await response.json(); } catch (_) { /* Ignore provider response content. */ }
        const description = String(details.error_description || details.error || '').toLowerCase();
        if (description.includes('redirect')) {
          toast('Spotify rejected the redirect URI. Add this exact URI in the Spotify Dashboard: ' + spotifyRedirectUri(), 'error');
        } else if (description.includes('client')) {
          toast('Spotify rejected the client ID. Verify it in the Spotify Dashboard.', 'error');
        } else {
          toast('Spotify token exchange failed. Check the client ID and exact redirect URI.', 'error');
        }
        return false;
      }
      const tokenData = await response.json();
      if (!tokenData.access_token) throw new Error('No access token received.');
      state.spotifyAccessToken = tokenData.access_token;
      state.spotifyRefreshToken = tokenData.refresh_token || null;
      state.spotifyExpiresAt = Date.now() + Math.max(60, Number(tokenData.expires_in) || 3600) * 1000;
      let displayName = 'Spotify';
      try {
        const profileResponse = await root.fetch('https://api.spotify.com/v1/me', {
          headers: { Authorization: `Bearer ${state.spotifyAccessToken}` }
        });
        if (profileResponse.ok) {
          const profile = await profileResponse.json();
          displayName = profile.display_name || profile.id || displayName;
        }
      } catch (_) { /* Profile display is optional. */ }
      setStatus('spotify', true, displayName);
      toast('Spotify connected. Playback availability depends on your account and an active device.', 'success');
      return true;
    } catch (_) {
      state.spotifyAccessToken = null;
      state.spotifyRefreshToken = null;
      state.spotifyExpiresAt = 0;
      setStatus('spotify', false);
      toast('Spotify token exchange failed. Check your network, client ID, and redirect URI.', 'error');
      return false;
    }
  }

  async function refreshSpotifyAccessToken() {
    if (spotifyRefreshPromise) return spotifyRefreshPromise;
    const refreshToken = state.spotifyRefreshToken;
    const clientId = settings().spotifyClientId;
    if (!refreshToken || !clientId) return false;
    spotifyRefreshPromise = (async function () {
      const form = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId });
      try {
        const response = await root.fetch(SPOTIFY_TOKEN, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: form.toString()
        });
        if (!response.ok) {
          if (response.status === 400 || response.status === 401) {
            state.spotifyAccessToken = null;
            state.spotifyRefreshToken = null;
            state.spotifyExpiresAt = 0;
            setStatus('spotify', false);
          }
          return false;
        }
        const tokenData = await response.json();
        if (!tokenData.access_token) return false;
        state.spotifyAccessToken = tokenData.access_token;
        state.spotifyRefreshToken = tokenData.refresh_token || refreshToken;
        state.spotifyExpiresAt = Date.now() + Math.max(60, Number(tokenData.expires_in) || 3600) * 1000;
        return true;
      } catch (_) {
        return false;
      }
    })();
    try { return await spotifyRefreshPromise; }
    finally { spotifyRefreshPromise = null; }
  }

  async function validSpotifyAccessToken() {
    if (!state.spotifyAccessToken) return await refreshSpotifyAccessToken() ? state.spotifyAccessToken : '';
    if (!state.spotifyExpiresAt || Date.now() < state.spotifyExpiresAt - 60000) return state.spotifyAccessToken;
    return await refreshSpotifyAccessToken() ? state.spotifyAccessToken : '';
  }

  async function requestSpotify(endpoint, options) {
    const url = new URL(String(endpoint || ''), 'https://api.spotify.com/v1/');
    if (url.origin !== 'https://api.spotify.com' || !url.pathname.startsWith('/v1/')) throw new Error('Unsupported Spotify API URL.');
    const accessToken = await validSpotifyAccessToken();
    if (!accessToken) throw new Error('Spotify authorization has expired. Reconnect Spotify from Settings → API Setup.');
    const makeRequest = (token) => root.fetch(url.toString(), Object.assign({}, options || {}, {
      headers: Object.assign({}, options && options.headers || {}, { Authorization: `Bearer ${token}` })
    }));
    let response = await makeRequest(accessToken);
    if (response.status === 401) {
      const refreshed = await refreshSpotifyAccessToken();
      if (!refreshed) throw new Error('Spotify authorization could not be refreshed. Reconnect Spotify from Settings → API Setup.');
      response = await makeRequest(state.spotifyAccessToken);
    }
    if (!response.ok) throw apiError(response, 'Spotify');
    return response;
  }

  function getGitHubToken() {
    if (state.githubToken) return state.githubToken;
    try {
      const stored = root.sessionStorage && root.sessionStorage.getItem(GITHUB_SESSION_KEY);
      if (stored) state.githubToken = stored;
    } catch (_) { /* Private browsing may disable session storage. */ }
    return state.githubToken || '';
  }

  async function validateGitHubToken(token) {
    let response;
    try {
      response = await root.fetch(`${GITHUB_API}/user`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28'
        }
      });
    } catch (_) {
      throw new Error('GitHub is unavailable. Check your connection and try again.');
    }
    if (response.status === 401 || response.status === 403) throw new Error('GitHub rejected this token. Check its expiration and selected permissions.');
    if (!response.ok) throw apiError(response, 'GitHub');
    const user = await response.json();
    return user.login || user.name || 'GitHub user';
  }

  async function saveGitHubToken(token) {
    const candidate = String(token || '').trim();
    if (!candidate) return missingCredential('GitHub', 'github-token', 'GitHub token');
    try {
      const username = await validateGitHubToken(candidate);
      try { root.sessionStorage.setItem(GITHUB_SESSION_KEY, candidate); }
      catch (_) {
        toast('GitHub token could not be kept for this browser session.', 'error');
        return false;
      }
      state.githubToken = candidate;
      setStatus('github', true, username);
      toast(`GitHub connected as ${username}.`, 'success');
      return true;
    } catch (error) {
      state.githubToken = null;
      try { root.sessionStorage.removeItem(GITHUB_SESSION_KEY); } catch (_) { /* Ignore storage cleanup failure. */ }
      setStatus('github', false);
      toast(safeError(error, 'GitHub token validation failed.'), 'error');
      return false;
    }
  }

  async function connectGitHub(token) {
    const candidate = String(token || getGitHubToken() || '').trim();
    if (!candidate) return missingCredential('GitHub', 'github-token', 'GitHub token');
    return saveGitHubToken(candidate);
  }

  function disconnect(service) {
    if (!service || service === 'google') {
      const oldToken = state.googleToken;
      state.googleToken = null;
      folderIds = { root: null, configuration: null };
      setStatus('google', false);
      try {
        if (oldToken && root.google && root.google.accounts && root.google.accounts.oauth2) {
          root.google.accounts.oauth2.revoke(oldToken, () => {});
        }
      } catch (_) { /* Clearing local connection state is sufficient. */ }
    }
    if (!service || service === 'spotify') {
      state.spotifyAccessToken = null;
      state.spotifyRefreshToken = null;
      state.spotifyExpiresAt = 0;
      try {
        root.sessionStorage.removeItem(SPOTIFY_VERIFIER_KEY);
        root.sessionStorage.removeItem(SPOTIFY_STATE_KEY);
      } catch (_) { /* Ignore unavailable session storage. */ }
      setStatus('spotify', false);
    }
    if (!service || service === 'github') {
      state.githubToken = null;
      try { root.sessionStorage.removeItem(GITHUB_SESSION_KEY); } catch (_) { /* Ignore unavailable session storage. */ }
      setStatus('github', false);
    }
    return true;
  }

  function getStatus() {
    return {
      google: { connected: state.status.google === 'connected', status: state.status.google, user: state.user.google },
      spotify: { connected: state.status.spotify === 'connected', status: state.status.spotify, user: state.user.spotify },
      github: { connected: state.status.github === 'connected', status: state.status.github, user: state.user.github }
    };
  }

  app.auth = {
    state,
    connectGoogle,
    connectSpotify,
    connectGitHub,
    disconnect,
    driveRequest,
    getDriveAccessToken: () => state.googleToken,
    getGoogleAccessToken: () => state.googleToken,
    getSpotifyAccessToken: () => state.spotifyAccessToken,
    requestSpotify,
    ensureDriveFolders,
    getFolderId,
    listDriveFiles,
    uploadDriveFile,
    getGitHubToken,
    getStatus,
    saveGitHubToken,
    checkSpotifyCallback
  };

  root.setTimeout(configuredNotice, 0);
})(typeof window !== 'undefined' ? window : globalThis);
