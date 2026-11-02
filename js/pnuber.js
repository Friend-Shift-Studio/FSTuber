/* Responsibility: manage PNGtuber image assets, layered canvas drawing, state, positioning, and persistence. */
(function (window) {
  'use strict';

  var FSTuber = window.FSTuber = window.FSTuber || {};
  var assets = new Map();
  var layers = [];
  var deferredLayerRecords = [];
  var nextLayerId = 1;
  var currentState = 'idle';
  var globallyVisible = true;
  var canvasSize = { width: 0, height: 0 };
  var drag = null;
  var stateStartedAt = Date.now();
  var activeLoopFrame = null;

  function settingsRoot() {
    try {
      var settings = FSTuber.settings;
      return settings && typeof settings.get === 'function' ? (settings.get() || {}) : (settings || {});
    } catch (error) {
      return {};
    }
  }

  function emit(name, detail) {
    try {
      window.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
    } catch (error) {
      // Custom events are optional in non-browser test contexts.
    }
  }

  function notify(message, kind) {
    var ui = FSTuber.ui;
    if (!ui) return;
    try {
      if (typeof ui.toast === 'function') ui.toast(message, kind || 'info');
      else if (typeof ui.showToast === 'function') ui.showToast(message, kind || 'info');
      else if (typeof ui.setStatus === 'function') ui.setStatus(message);
    } catch (error) {
      // Status presentation must never block editing.
    }
  }

  function basename(value) {
    var name = String(value || '').split(/[\\/]/).pop();
    return name.replace(/\.[^.]+$/, '').trim() || 'image';
  }

  function cleanState(value) {
    return String(value || 'idle').trim().toLowerCase().replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/g, '_') || 'idle';
  }

  function inferredState(value) {
    var state = cleanState(value);
    var tokens = state.split(/[_-]+/);
    var builtIns = ['idle', 'talk', 'laugh'];
    for (var index = 0; index < builtIns.length; index += 1) {
      if (tokens.indexOf(builtIns[index]) !== -1) return builtIns[index];
    }
    return state;
  }

  function isSupportedImage(fileOrItem) {
    var type = String(fileOrItem && fileOrItem.type || '').toLowerCase();
    var name = String(fileOrItem && (fileOrItem.name || fileOrItem.filename || '')).toLowerCase();
    return type.indexOf('image/') === 0 || /\.(png|jpe?g|gif|apng|webp)$/.test(name);
  }

  function readPosition(raw) {
    var fallback = { x: 0.78, y: 0.68 };
    var p = raw && typeof raw === 'object' ? raw : {};
    var nested = p.position && typeof p.position === 'object' ? p.position : p;
    var x = Number(nested.x);
    var y = Number(nested.y);
    var unit = String(nested.unit || p.unit || '').toLowerCase();
    if (!Number.isFinite(x)) x = fallback.x;
    if (!Number.isFinite(y)) y = fallback.y;
    if (unit === 'percent' || Math.abs(x) > 1 || Math.abs(y) > 1) {
      x /= 100;
      y /= 100;
    }
    return { x: x, y: y };
  }

  function configuredPosition() {
    var s = settingsRoot();
    return readPosition(s.pnuberPosition || s.pngtuberPosition);
  }

  function numericScale(raw, fallback) {
    var value = Number(raw);
    return Number.isFinite(value) && value > 0 ? Math.min(value, 8) : fallback;
  }

  function normalizeItem(fileOrItem) {
    if (!fileOrItem) return null;
    var file = fileOrItem.file || (typeof File !== 'undefined' && fileOrItem instanceof File ? fileOrItem : null);
    var name = String(fileOrItem.name || fileOrItem.filename || (file && file.name) || 'image');
    var url = fileOrItem.url || fileOrItem.src || '';
    if (!url && file && window.URL && typeof window.URL.createObjectURL === 'function') {
      try { url = window.URL.createObjectURL(file); } catch (error) { url = ''; }
    }
    if (!url) return null;
    return {
      name: basename(name),
      filename: name,
      url: String(url),
      type: 'image',
      mimeType: String(fileOrItem.mimeType || (file && file.type) || ''),
      ownedUrl: Boolean(file && url && window.URL && String(url).indexOf('blob:') === 0),
      state: inferredState(fileOrItem.state || basename(name)),
      scale: numericScale(fileOrItem.scale, null),
      position: fileOrItem.position ? readPosition(fileOrItem.position) : null
    };
  }

  function loadAsset(item) {
    return new Promise(function (resolve) {
      if (typeof window.Image !== 'function') {
        item.image = null;
        item.loadError = 'Image is not available in this environment.';
        resolve(item);
        return;
      }
      var image = new window.Image();
      item.image = image;
      item.loaded = false;
      image.onload = function () {
        item.loaded = true;
        item.width = image.naturalWidth || image.width || 0;
        item.height = image.naturalHeight || image.height || 0;
        emit('fstuber:pnuber:asset-loaded', { asset: publicAsset(item) });
        resolve(item);
      };
      image.onerror = function () {
        item.loadError = 'Could not load image: ' + item.filename;
        notify(item.loadError, 'error');
        emit('fstuber:pnuber:asset-error', { name: item.name, url: item.url });
        resolve(item);
      };
      image.src = item.url;
      if (image.complete && (image.naturalWidth || image.width)) image.onload();
    });
  }

  function publicAsset(item) {
    return { name: item.name, filename: item.filename, url: item.url, type: 'image', loaded: Boolean(item.loaded), width: item.width || 0, height: item.height || 0 };
  }

  function persist() {
    var settings = FSTuber.settings;
    if (!settings) return;
    var position = layers.length ? { x: layers[0].x, y: layers[0].y, unit: 'relative' } : configuredPosition();
    var layerData = layers.map(function (layer) {
      return { id: layer.id, assetName: layer.assetName, name: layer.name, state: layer.state, visible: layer.userVisible, enabled: layer.enabled, scale: layer.scale, x: layer.x, y: layer.y, unit: 'relative' };
    });
    var currentIds = new Set(layerData.map(function (layer) { return String(layer.id); }));
    var pending = deferredLayerRecords.filter(function (record) {
      return record && (!record.id || !currentIds.has(String(record.id)));
    }).map(function (record) { return Object.assign({}, record); });
    layerData = layerData.concat(pending);
    try {
      if (typeof settings.update === 'function') settings.update({ pnuberPosition: position, pnuberLayers: layerData });
      else {
        var root = settingsRoot();
        root.pnuberPosition = position;
        root.pnuberLayers = layerData;
      }
      if (typeof settings.saveSettings === 'function') settings.saveSettings();
      else if (typeof settings.save === 'function') settings.save();
    } catch (error) {
      notify('Could not save PNGtuber positions.', 'error');
    }
  }

  function triggerLayerChange(action, layer) {
    var detail = { action: action, layer: layer || null, layers: layers };
    emit('fstuber:pnuber:layers-changed', detail);
    emit('fstuber:pnuber:layerchange', detail);
  }

  function addAssets(items) {
    if (!Array.isArray(items)) items = items ? [items] : [];
    var promises = [];
    items.forEach(function (entry) {
      var item = normalizeItem(entry);
      if (!item || !isSupportedImage(entry)) {
        if (entry) notify('Unsupported PNGtuber image. Use PNG, JPG, GIF, APNG, or WebP.', 'error');
        return;
      }
      var existing = assets.get(item.name);
      if (existing && existing.ownedUrl && existing.url !== item.url && window.URL && typeof window.URL.revokeObjectURL === 'function') {
        try { window.URL.revokeObjectURL(existing.url); } catch (error) { /* ignore */ }
      }
      assets.set(item.name, item);
      promises.push(loadAsset(item));
    });
    return Promise.all(promises).then(function () {
      restoreLayers();
      emit('fstuber:pnuber:assets-changed', { assets: Array.from(assets.values()).map(publicAsset) });
      return Array.from(assets.values()).map(publicAsset);
    });
  }

  function restoreLayers(recordsOverride) {
    var stored = settingsRoot();
    var records = Array.isArray(recordsOverride) ? recordsOverride : deferredLayerRecords.length ? deferredLayerRecords :
      (Array.isArray(stored.pnuberLayers) ? stored.pnuberLayers : Array.isArray(stored.layers) ? stored.layers : []);
    var saved = records.filter(function (record) { return record && typeof record === 'object'; }).map(function (record) { return Object.assign({}, record); });
    saved.forEach(function (record) { if (!String(record.id || '').trim()) record.id = allocateLayerId(); });
    deferredLayerRecords = saved.slice();
    var restored = 0;
    saved.forEach(function (record) {
      var name = record.assetName || record.filename || record.name || '';
      var key = basename(name).toLowerCase();
      var asset = assets.get(basename(name)) || Array.from(assets.values()).find(function (candidate) {
        return candidate.name.toLowerCase() === key || candidate.filename.toLowerCase() === String(name).toLowerCase();
      });
      if (!asset) return;
      var id = String(record.id || '').trim();
      if (id && layers.some(function (layer) { return layer.id === id; })) {
        deferredLayerRecords = deferredLayerRecords.filter(function (pendingRecord) { return pendingRecord !== record; });
        return;
      }
      deferredLayerRecords = deferredLayerRecords.filter(function (pendingRecord) { return pendingRecord !== record; });
      var position = readPosition(record);
      var layer = addLayer(asset.name, {
        id: id,
        state: record.state || asset.state,
        x: position.x,
        y: position.y,
        scale: record.scale,
        visible: record.userVisible !== false && record.visible !== false,
        enabled: record.enabled !== false
      });
      if (layer) restored += 1;
      else deferredLayerRecords.push(record);
    });
    persist();
    return restored;
  }

  function addAsset(fileOrItem) {
    return addAssets([fileOrItem]).then(function (result) { return result[0] || null; });
  }

  function makeLayer(asset, options) {
    options = options || {};
    var configured = configuredPosition();
    var position = asset.position || configured;
    var state = inferredState(options.state || asset.state || asset.name);
    var userVisible = options.visible !== false;
    var requestedId = String(options.id || '').trim();
    var layerId = requestedId && !layers.some(function (existing) { return existing.id === requestedId; }) ? requestedId : allocateLayerId();
    var layer = {
      id: layerId,
      assetName: asset.name,
      name: asset.filename,
      url: asset.url,
      type: 'image',
      state: state,
      x: Number.isFinite(Number(options.x)) ? Number(options.x) : position.x,
      y: Number.isFinite(Number(options.y)) ? Number(options.y) : position.y,
      scale: numericScale(options.scale, numericScale(asset.scale, 1)),
      visible: userVisible && (!state || state === currentState),
      userVisible: userVisible,
      enabled: options.enabled !== false,
      image: asset.image,
      loaded: Boolean(asset.loaded),
      loop: null,
      frameAsset: null,
      _naturalWidth: asset.width || 0,
      _naturalHeight: asset.height || 0
    };
    return layer;
  }

  function allocateLayerId() {
    var id;
    do { id = 'pnuber-layer-' + nextLayerId++; }
    while (layers.some(function (layer) { return layer.id === id; }));
    return id;
  }

  function addLayer(assetName, options) {
    options = typeof options === 'string' ? { state: options } : Object.assign({}, options || {});
    if (assetName && typeof assetName === 'object') {
      var input = assetName;
      options = Object.assign({}, input, options);
      if (input.url || input.src || input.file) {
        return addAsset(input).then(function (asset) { return asset ? addLayer(asset.name, options) : null; });
      }
      assetName = input.assetName || input.name;
    }
    var key = basename(assetName);
    var asset = assets.get(key);
    if (!asset) {
      var found = Array.from(assets.values()).find(function (candidate) { return candidate.filename === assetName || candidate.name.toLowerCase() === String(assetName || '').toLowerCase(); });
      asset = found || null;
    }
    if (!asset) {
      notify('PNGtuber image not found: ' + String(assetName || ''), 'error');
      return null;
    }
    var layer = makeLayer(asset, options);
    layers.push(layer);
    triggerLayerChange('add', layer);
    persist();
    return layer;
  }

  function removeLayer(id) {
    var index = layers.findIndex(function (layer) { return layer.id === id; });
    if (index < 0) return false;
    var removed = layers.splice(index, 1)[0];
    triggerLayerChange('remove', removed);
    persist();
    return true;
  }

  function clearLayers() {
    layers = [];
    deferredLayerRecords = [];
    drag = null;
    triggerLayerChange('clear', null);
    persist();
  }

  function getLayers() { return layers.slice(); }

  function setLayerVisibility(id, value) {
    var layer = layers.find(function (item) { return item.id === id; });
    if (!layer) return false;
    layer.userVisible = Boolean(value);
    layer.visible = layer.userVisible && layer.enabled && (!layer.state || layer.state === currentState);
    triggerLayerChange('visibility', layer);
    persist();
    return layer.visible;
  }

  function getLoopConfig(stateName) {
    var s = settingsRoot();
    var loops = s.pnuberLoops || s.pngtuberLoops || s.animationLoops || s.stateLoops || s.loops || {};
    if (Array.isArray(loops)) {
      return loops.find(function (item) { return cleanState(item.state || item.name) === stateName; }) || null;
    }
    return loops && (loops[stateName] || loops[String(stateName).toLowerCase()]) || null;
  }

  function stateAssetName(frame) {
    if (typeof frame === 'string') return basename(frame);
    if (frame && typeof frame === 'object') return basename(frame.assetName || frame.image || frame.name || '');
    return '';
  }

  function setState(stateName, options) {
    options = options || {};
    currentState = cleanState(stateName);
    stateStartedAt = Date.now();
    var loop = getLoopConfig(currentState);
    activeLoopFrame = null;
    layers.forEach(function (layer) {
      layer.visible = layer.userVisible && layer.enabled && (!layer.state || layer.state === currentState);
      layer.loop = null;
      layer.frameAsset = null;
    });
    if (loop && Array.isArray(loop.frames) && loop.frames.length) {
      var fps = Number(loop.fps);
      if (!Number.isFinite(fps) || fps <= 0) fps = 8;
      var frames = loop.frames.map(stateAssetName).filter(Boolean);
      layers.forEach(function (layer) {
        if (layer.state === currentState && frames.length) {
          layer.loop = { frames: frames, fps: fps, startedAt: stateStartedAt, repeat: loop.repeat !== false };
        }
      });
      activeLoopFrame = { frames: frames, fps: fps };
    }
    emit('fstuber:pnuber:state-changed', { state: currentState, previousState: options.previousState || null, options: options });
    emit('fstuber:pnuber:statechange', { state: currentState, options: options });
    triggerLayerChange('state', null);
    return currentState;
  }

  function getState() { return currentState; }

  function frameImage(layer, now) {
    if (!layer.loop || !layer.loop.frames.length) return layer.image;
    var loop = layer.loop;
    var frameDuration = 1000 / loop.fps;
    var index = Math.floor((now - loop.startedAt) / frameDuration);
    if (!loop.repeat) index = Math.min(index, loop.frames.length - 1);
    else index %= loop.frames.length;
    var asset = assets.get(loop.frames[index]);
    if (!asset && loop.frames[index]) {
      asset = Array.from(assets.values()).find(function (entry) { return entry.filename === loop.frames[index]; }) || null;
    }
    if (asset && asset.image && asset.loaded) {
      layer.frameAsset = asset;
      layer._naturalWidth = asset.width;
      layer._naturalHeight = asset.height;
      return asset.image;
    }
    return layer.image;
  }

  function dimensionsFor(layer, image, width, height) {
    var naturalWidth = (image && (image.naturalWidth || image.width)) || layer._naturalWidth || 0;
    var naturalHeight = (image && (image.naturalHeight || image.height)) || layer._naturalHeight || 0;
    if (!naturalWidth || !naturalHeight) return null;
    var s = settingsRoot();
    var baseScale = numericScale(s.pnuberScale || s.pngtuberScale, 0.24);
    var maxWidth = width * Math.min(0.8, Math.max(0.05, baseScale * layer.scale));
    var maxHeight = height * Math.min(0.8, Math.max(0.05, baseScale * layer.scale));
    var factor = Math.min(maxWidth / naturalWidth, maxHeight / naturalHeight);
    return { width: naturalWidth * factor, height: naturalHeight * factor };
  }

  function pointFromEvent(event, rect) {
    if (!rect || !rect.width || !rect.height) return null;
    var cx = event.clientX;
    var cy = event.clientY;
    return { x: (cx - rect.left) * canvasSize.width / rect.width, y: (cy - rect.top) * canvasSize.height / rect.height };
  }

  function draw(ctx, width, height) {
    if (!ctx) return;
    canvasSize = { width: Number(width) || ctx.canvas && ctx.canvas.width || 0, height: Number(height) || ctx.canvas && ctx.canvas.height || 0 };
    if (!globallyVisible || canvasSize.width <= 0 || canvasSize.height <= 0) return;
    var now = Date.now();
    layers.forEach(function (layer) {
      if (!layer.visible || !layer.enabled || !layer.image || layer.image.complete === false) return;
      var image = frameImage(layer, now);
      if (!image) return;
      var size = dimensionsFor(layer, image, canvasSize.width, canvasSize.height);
      if (!size) return;
      var x = layer.x * canvasSize.width;
      var y = layer.y * canvasSize.height;
      var left = Math.max(-canvasSize.width, Math.min(canvasSize.width * 2, x));
      var top = Math.max(-canvasSize.height, Math.min(canvasSize.height * 2, y));
      try {
        ctx.drawImage(image, left, top, size.width, size.height);
        if (drag && drag.layer === layer) {
          ctx.save();
          ctx.strokeStyle = '#7170ff';
          ctx.lineWidth = Math.max(1, canvasSize.width / 1000);
          ctx.setLineDash && ctx.setLineDash([5, 3]);
          ctx.strokeRect(left, top, size.width, size.height);
          ctx.fillStyle = '#7170ff';
          ctx.fillRect(left + size.width - 9, top + size.height - 9, 9, 9);
          ctx.restore();
        }
      } catch (error) {
        // Broken or cross-origin images are skipped rather than breaking the render loop.
      }
    });
  }

  function pointerDown(event, canvasRect) {
    if (!event || !canvasRect || !globallyVisible) return false;
    var point = pointFromEvent(event, canvasRect);
    if (!point) return false;
    for (var index = layers.length - 1; index >= 0; index--) {
      var layer = layers[index];
      if (!layer.visible || !layer.enabled || !layer.image) continue;
      var size = dimensionsFor(layer, layer.image, canvasSize.width || canvasRect.width, canvasSize.height || canvasRect.height);
      if (!size) continue;
      var x = layer.x * (canvasSize.width || canvasRect.width);
      var y = layer.y * (canvasSize.height || canvasRect.height);
      if (point.x < x || point.y < y || point.x > x + size.width || point.y > y + size.height) continue;
      var handleSize = Math.max(14, Math.min(24, Math.min(size.width, size.height) * 0.08));
      var resizing = point.x >= x + size.width - handleSize && point.y >= y + size.height - handleSize;
      drag = { layer: layer, mode: resizing ? 'resize' : 'move', startX: point.x, startY: point.y, originX: layer.x, originY: layer.y, originScale: layer.scale, originWidth: size.width, originHeight: size.height };
      if (event.preventDefault) event.preventDefault();
      return true;
    }
    return false;
  }

  function pointerMove(event, canvasRect) {
    if (!drag) return false;
    var point = pointFromEvent(event, canvasRect);
    if (!point) return false;
    var scaleX = Math.max(1, canvasSize.width || canvasRect.width);
    var scaleY = Math.max(1, canvasSize.height || canvasRect.height);
    if (drag.mode === 'move') {
      drag.layer.x = Math.max(-1, Math.min(1, drag.originX + (point.x - drag.startX) / scaleX));
      drag.layer.y = Math.max(-1, Math.min(1, drag.originY + (point.y - drag.startY) / scaleY));
    } else {
      var delta = ((point.x - drag.startX) / Math.max(1, drag.originWidth) + (point.y - drag.startY) / Math.max(1, drag.originHeight)) / 2;
      drag.layer.scale = Math.max(0.1, Math.min(8, drag.originScale * (1 + delta * 2)));
    }
    if (event.preventDefault) event.preventDefault();
    return true;
  }

  function pointerUp() {
    if (!drag) return false;
    var layer = drag.layer;
    drag = null;
    persist();
    triggerLayerChange('update', layer);
    return true;
  }

  function setVisible(value) {
    globallyVisible = Boolean(value);
    emit('fstuber:pnuber:visibility-changed', { visible: globallyVisible });
    return globallyVisible;
  }

  function toggleVisibility() { return setVisible(!globallyVisible); }

  function clear() {
    layers = [];
    deferredLayerRecords = [];
    assets.forEach(function (asset) {
      if (asset.ownedUrl && window.URL && typeof window.URL.revokeObjectURL === 'function') {
        try { window.URL.revokeObjectURL(asset.url); } catch (error) { /* ignore */ }
      }
    });
    assets.clear();
    drag = null;
    triggerLayerChange('clear', null);
    emit('fstuber:pnuber:assets-changed', { assets: [] });
    persist();
  }

  FSTuber.pnuber = {
    addAssets: addAssets,
    addAsset: addAsset,
    addLayer: addLayer,
    removeLayer: removeLayer,
    clearLayers: clearLayers,
    getLayers: getLayers,
    restoreLayers: restoreLayers,
    setLayerVisibility: setLayerVisibility,
    setState: setState,
    getState: getState,
    draw: draw,
    pointerDown: pointerDown,
    pointerMove: pointerMove,
    pointerUp: pointerUp,
    toggleVisibility: toggleVisibility,
    setVisible: setVisible,
    clear: clear,
    getAssets: function () { return Array.from(assets.values()).map(publicAsset); },
    getVisible: function () { return globallyVisible; }
  };
})(window);
