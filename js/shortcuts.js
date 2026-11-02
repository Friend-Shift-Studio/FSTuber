/* Responsibility: normalize and persist keyboard mappings, dispatch PNGtuber/transport actions, and expose help/export. */
(function (window, document) {
  'use strict';

  var FSTuber = window.FSTuber = window.FSTuber || {};
  var map = Object.create(null);
  var initialized = false;
  var heldKeys = new Map();
  var toggledState = null;
  var visibilityKey = 'v';
  var helpKey = '?';
  var transportKeys = new Set([' ', 'arrowleft', 'arrowright']);

  function settingsRoot() {
    try {
      var settings = FSTuber.settings;
      return settings && typeof settings.get === 'function' ? (settings.get() || {}) : (settings || {});
    } catch (error) { return {}; }
  }

  function normalizeKey(key) {
    var value = String(key == null ? '' : key).trim();
    if (!value) return '';
    if (value === 'Spacebar') return ' ';
    if (value === 'Space') return ' ';
    if (value.length === 1) return value.toLowerCase();
    return value.toLowerCase();
  }

  function keyFromEvent(event) {
    if (!event) return '';
    if (event.key === ' ') return ' ';
    return normalizeKey(event.key || event.code);
  }

  function normalizeAction(action) {
    if (typeof action === 'string') {
      var text = action.trim();
      if (!text) return null;
      return { state: text, mode: 'hold' };
    }
    if (!action || typeof action !== 'object') return null;
    var target = action.state || action.image || action.assetName || action.name;
    if (!target) return null;
    var mode = String(action.mode || 'hold').toLowerCase();
    if (mode !== 'toggle') mode = 'hold';
    var result = { state: String(target), mode: mode };
    if (action.label) result.label = String(action.label);
    return result;
  }

  function normalizedMap(source) {
    var result = Object.create(null);
    if (!source || typeof source !== 'object') return result;
    Object.keys(source).forEach(function (rawKey) {
      var key = normalizeKey(rawKey);
      var action = normalizeAction(source[rawKey]);
      if (key && action && key !== visibilityKey && key !== helpKey && !transportKeys.has(key)) result[key] = action;
    });
    return result;
  }

  function persist() {
    var settings = FSTuber.settings;
    var serializable = {};
    Object.keys(map).sort().forEach(function (key) { serializable[key] = Object.assign({}, map[key]); });
    try {
      if (settings && typeof settings.update === 'function') settings.update({ shortcuts: serializable });
      else if (settings && typeof settings === 'object') settings.shortcuts = serializable;
      if (settings && typeof settings.saveSettings === 'function') settings.saveSettings();
      else if (settings && typeof settings.save === 'function') settings.save();
    } catch (error) {
      emit('fstuber:shortcuts:error', { message: 'Could not save shortcut mappings.' });
      toast('Could not save shortcut mappings.', 'error');
    }
  }

  function emit(name, detail) {
    try { window.dispatchEvent(new CustomEvent(name, { detail: detail || {} })); } catch (error) { /* optional */ }
  }

  function toast(message, kind) {
    var ui = FSTuber.ui;
    if (!ui) return;
    try {
      if (typeof ui.toast === 'function') ui.toast(message, kind || 'info');
      else if (typeof ui.showToast === 'function') ui.showToast(message, kind || 'info');
      else if (typeof ui.setStatus === 'function') ui.setStatus(message);
    } catch (error) { /* status UI is optional */ }
  }

  function isTypingTarget(target) {
    if (!target) return false;
    var element = target.nodeType === 1 ? target : target.parentElement;
    if (!element) return false;
    var tag = String(element.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || element.isContentEditable) return true;
    if (element.closest) {
      if (element.closest('[contenteditable="true"], [contenteditable=""], [role="textbox"]')) return true;
      var modal = element.closest('[role="dialog"], dialog, .modal, [aria-modal="true"]');
      if (modal && modal.querySelector('input:focus, textarea:focus, select:focus, [contenteditable="true"]:focus, [role="textbox"]:focus')) return true;
    }
    return false;
  }

  function setState(state, options) {
    if (!FSTuber.pnuber || typeof FSTuber.pnuber.setState !== 'function') return;
    var pnuber = FSTuber.pnuber;
    var target = String(state || 'idle');
    var layers = typeof pnuber.getLayers === 'function' ? pnuber.getLayers() : [];
    var exists = layers.some(function (layer) { return String(layer.state || '').toLowerCase() === target.toLowerCase() || String(layer.assetName || '').toLowerCase() === target.toLowerCase(); });
    if (!exists && typeof pnuber.addLayer === 'function' && typeof pnuber.getAssets === 'function') {
      var asset = pnuber.getAssets().find(function (item) { return String(item.name).toLowerCase() === target.toLowerCase() || String(item.filename || '').toLowerCase() === target.toLowerCase(); });
      if (asset) pnuber.addLayer(asset.name);
    }
    pnuber.setState(target, options || {});
  }

  function activate(key, action, event) {
    if (!action) return;
    if (action.mode === 'toggle') {
      if (toggledState === action.state) {
        toggledState = null;
        setState('idle', { source: 'shortcut-toggle', key: key });
      } else {
        toggledState = action.state;
        setState(action.state, { source: 'shortcut-toggle', key: key });
      }
    } else {
      heldKeys.set(key, action.state);
      toggledState = null;
      setState(action.state, { source: 'shortcut-hold', key: key });
    }
    emit('fstuber:shortcuts:action', { key: key, action: Object.assign({}, action), event: event || null });
  }

  function release(key, event) {
    if (!heldKeys.has(key)) return;
    heldKeys.delete(key);
    var remaining = Array.from(heldKeys.entries());
    if (remaining.length) {
      setState(remaining[remaining.length - 1][1], { source: 'shortcut-hold-release', key: key });
    } else {
      setState(toggledState || 'idle', { source: 'shortcut-hold-release', key: key });
    }
    emit('fstuber:shortcuts:release', { key: key, event: event || null });
  }

  function delegateTransport(key, event) {
    emit('fstuber:transport', { key: key, originalEvent: event });
    var ui = FSTuber.ui;
    try {
      if (key === ' ') {
        if (ui && typeof ui.togglePlayback === 'function') ui.togglePlayback();
        else if (ui && typeof ui.togglePlayPause === 'function') ui.togglePlayPause();
        else if (ui && ui.video && typeof ui.video.play === 'function') {
          if (ui.video.paused) ui.video.play(); else ui.video.pause();
        }
      } else {
        var amount = Number(ui && ui.seekStep) || 5;
        var direction = key === 'arrowleft' ? -1 : 1;
        if (ui && typeof ui.seekBy === 'function') ui.seekBy(direction * amount);
        else if (ui && ui.video && Number.isFinite(ui.video.currentTime)) ui.video.currentTime = Math.max(0, ui.video.currentTime + direction * amount);
        else if (ui && ui.videoElement && Number.isFinite(ui.videoElement.currentTime)) ui.videoElement.currentTime = Math.max(0, ui.videoElement.currentTime + direction * amount);
      }
    } catch (error) {
      toast('The transport shortcut could not be applied.', 'error');
    }
  }

  function handleKeyDown(event) {
    if (!event || event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || isTypingTarget(event.target)) return;
    var key = keyFromEvent(event);
    if (!key) return;
    if (key === helpKey || (event.key === '?' && event.shiftKey)) {
      if (event.preventDefault) event.preventDefault();
      showHelp();
      return;
    }
    if (key === visibilityKey) {
      if (event.repeat) return;
      if (event.preventDefault) event.preventDefault();
      if (FSTuber.pnuber && typeof FSTuber.pnuber.toggleVisibility === 'function') FSTuber.pnuber.toggleVisibility();
      return;
    }
    if (transportKeys.has(key)) {
      if (event.repeat) return;
      if (event.preventDefault) event.preventDefault();
      delegateTransport(key, event);
      return;
    }
    var action = map[key];
    if (!action || event.repeat) return;
    if (event.preventDefault) event.preventDefault();
    activate(key, action, event);
  }

  function handleKeyUp(event) {
    if (!event) return;
    var key = keyFromEvent(event);
    if (!key) return;
    if (isTypingTarget(event.target)) {
      heldKeys.delete(key);
      return;
    }
    release(key, event);
  }

  function init() {
    if (initialized) return FSTuber.shortcuts;
    var current = settingsRoot();
    map = normalizedMap(current.shortcuts || {});
    if (!Object.keys(map).length) map = normalizedMap({ '1': { state: 'idle', mode: 'hold' }, '2': { state: 'talk', mode: 'hold' }, '3': { state: 'laugh', mode: 'hold' } });
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        heldKeys.forEach(function (_, key) { release(key); });
      }
    });
    initialized = true;
    return FSTuber.shortcuts;
  }

  function destroy() {
    if (!initialized) return;
    document.removeEventListener('keydown', handleKeyDown);
    document.removeEventListener('keyup', handleKeyUp);
    Array.from(heldKeys.keys()).forEach(function (key) { release(key); });
    heldKeys.clear();
    initialized = false;
  }

  function assign(key, action) {
    var normalizedKey = normalizeKey(key);
    var normalized = normalizeAction(action);
    if (!normalizedKey || !normalized) return false;
    if (normalizedKey === visibilityKey || normalizedKey === helpKey || transportKeys.has(normalizedKey)) {
      toast('That key is reserved by a global shortcut.', 'error');
      return false;
    }
    map[normalizedKey] = normalized;
    persist();
    emit('fstuber:shortcuts:changed', { mapping: exportMap(false) });
    return true;
  }

  function remove(key) {
    var normalizedKey = normalizeKey(key);
    if (!normalizedKey || !Object.prototype.hasOwnProperty.call(map, normalizedKey)) return false;
    delete map[normalizedKey];
    heldKeys.delete(normalizedKey);
    persist();
    emit('fstuber:shortcuts:changed', { mapping: exportMap(false) });
    return true;
  }

  function getMap() {
    var result = {};
    Object.keys(map).sort().forEach(function (key) { result[key] = Object.assign({}, map[key]); });
    return result;
  }

  function exportMap(download) {
    var serialized = JSON.stringify({ version: 1, shortcuts: getMap(), global: { visibility: visibilityKey, help: helpKey, transport: ['Space', 'ArrowLeft', 'ArrowRight'] } }, null, 2);
    if (download !== false && typeof Blob === 'function' && window.URL && typeof window.URL.createObjectURL === 'function' && document.createElement) {
      try {
        var blob = new Blob([serialized], { type: 'application/json' });
        var url = window.URL.createObjectURL(blob);
        var anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = 'fstuber-shortcuts.json';
        anchor.style.display = 'none';
        (document.body || document.documentElement).appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(function () { window.URL.revokeObjectURL(url); }, 0);
      } catch (error) {
        toast('Could not download shortcut mappings.', 'error');
      }
    }
    return serialized;
  }

  function showHelp() {
    var ui = FSTuber.ui;
    if (ui && typeof ui.openHelp === 'function') {
      ui.openHelp();
      return true;
    }
    var detail = { mappings: getMap(), global: { visibility: visibilityKey, help: helpKey, transport: ['Space', 'ArrowLeft', 'ArrowRight'] } };
    emit('fstuber:shortcuts:help', detail);
    if (typeof window.CustomEvent === 'function') window.dispatchEvent(new CustomEvent('fstuber:help:open', { detail: detail }));
    return true;
  }

  FSTuber.shortcuts = {
    init: init,
    destroy: destroy,
    exportMap: exportMap,
    handleKeyDown: handleKeyDown,
    handleKeyUp: handleKeyUp,
    showHelp: showHelp,
    assign: assign,
    remove: remove,
    getMap: getMap
  };
})(window, document);
