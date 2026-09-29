/**
 * electronAPI shim for the Tauri shell.
 *
 * The React app was built against Electron's preload bridge. Under Tauri we
 * implement the same surface on top of Tauri's invoke() so src/ runs
 * unmodified. Loaded by index.html BEFORE the app bundle; it becomes
 * window.electronAPI only when running inside the Tauri shell
 * (window.__TAURI_INTERNALS__ exists there).
 *
 * Under Electron the real preload still wins: index.html only installs this
 * shim when the Tauri internals are detected.
 */
(function () {
  'use strict';

  var isTauri = !!(window.__TAURI_INTERNALS__ || window.__TAURI__);
  if (!isTauri) return; // Electron/browser: leave window.electronAPI alone.

  var invoke = function (cmd, args) {
    // Tauri v2 global: __TAURI_INTERNALS__.invoke
    var inv = (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) ||
              (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke);
    if (!inv) return Promise.reject(new Error('tauri invoke unavailable'));
    return inv(cmd, args || {});
  };

  /** Listen to engine-ready, which carries { port, token }. */
  var engineCreds = null;
  var engineWaiters = [];
  var pending = [];

  try {
    var listen = (window.__TAURI__ && window.__TAURI__.event && window.__TAURI__.event.listen) || null;
    if (listen) {
      listen('engine-ready', function (ev) {
        engineCreds = ev.payload;
        engineWaiters.forEach(function (w) { w(engineCreds); });
        engineWaiters = [];
      });
    } else {
      // Fallback: read credentials by invoking the command directly once the
      // backend registered them. Retry briefly in case we beat the spawn.
      var poll = function (tries) {
        invoke('engine_info')
          .then(function (info) {
            if (info && info.port) {
              engineCreds = info;
              engineWaiters.forEach(function (w) { w(engineCreds); });
              engineWaiters = [];
            } else if (tries > 0) setTimeout(function () { poll(tries - 1); }, 300);
          })
          .catch(function () {
            if (tries > 0) setTimeout(function () { poll(tries - 1); }, 300);
          });
      };
      poll(50);
    }
  } catch (e) { /* creds arrive via poll above */ }

  var waitForCreds = function () {
    if (engineCreds) return Promise.resolve(engineCreds);
    return new Promise(function (resolve) {
      engineWaiters.push(resolve);
      // The poll fallback fills engineCreds; nothing else to do here.
    });
  };

  /** All apiBase-relative fetches must carry the token header. */
  var patchFetch = function () {
    if (window.__ndmFetchPatched) return;
    window.__ndmFetchPatched = true;
    var orig = window.fetch.bind(window);
    window.fetch = function (input, init) {
      init = init || {};
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      var isLocalApi = /^\/api\//.test(url) || /^\/ws(\?|$)/.test(url) ||
        /^http:\/\/127\.0\.0\.1:50\d\d\//.test(url);
      if (isLocalApi) {
        init = Object.assign({}, init);
        init.headers = Object.assign({}, init.headers);
        var h = init.headers;
        if (!h['X-NDM-Token']) {
          // headers may be a Headers instance
          try { h = new Headers(h); } catch (e) { h = {}; }
          if (h.set) h.set('X-NDM-Token', engineCreds ? engineCreds.token : '');
          else h['X-NDM-Token'] = engineCreds ? engineCreds.token : '';
          init.headers = h;
        }
      }
      // Rewrite relative API paths to the engine origin once known.
      if (engineCreds && (/^\/(api|ws)/.test(url))) {
        var base = 'http://127.0.0.1:' + engineCreds.port;
        url = url.replace(/^\/api\//, base + '/api/').replace(/^\/ws\??/, base + '/ws?');
        input = url;
      }
      return orig(input, init);
    };
  };
  patchFetch();
  // Re-patch once creds arrive (base URL rewrite needs the port).
  waitForCreds().then(patchFetch);

  /** WebSocket: ws://127.0.0.1:<port>/ws?token=... */
  var patchWebSocket = function () {
    if (window.__ndmWsPatched || !engineCreds) return;
    window.__ndmWsPatched = true;
    var OrigWS = window.WebSocket;
    window.WebSocket = function (url, protocols) {
      if (/^ws:\/\/127\.0\.0\.1:50\d\d\/ws/.test(url)) {
        url = url.replace('127.0.0.1:5088', '127.0.0.1:' + engineCreds.port)
                 .replace('127.0.0.1:5090', '127.0.0.1:' + engineCreds.port);
        var sep = url.indexOf('?') === -1 ? '?' : '&';
        url += sep + 'token=' + encodeURIComponent(engineCreds.token);
      }
      return protocols !== undefined ? new OrigWS(url, protocols) : new OrigWS(url);
    };
    window.WebSocket.prototype = OrigWS.prototype;
    window.WebSocket.CONNECTING = OrigWS.CONNECTING;
    window.WebSocket.OPEN = OrigWS.OPEN;
    window.WebSocket.CLOSING = OrigWS.CLOSING;
    window.WebSocket.CLOSED = OrigWS.CLOSED;
  };
  waitForCreds().then(patchWebSocket);

  var shim = {
    /* ---- window controls ---- */
    minimize: function () { return invoke('minimize'); },
    maximize: function () { return invoke('maximize'); },
    close: function () { return invoke('close'); },
    resizeStep: function (dx, dy) { return invoke('resize_step', { dx: dx, dy: dy }); },
    autoFitWindowHeight: function () { return Promise.resolve(); }, // auto-size not needed in Tauri phase 1

    /* ---- windows / dialogs ---- */
    openWindow: function (type, params) { return invoke('open_window', { windowType: type, params: params || {} }); },
    openDownloadWindow: function (id) { return invoke('open_download_window', { id: id }); },

    /* ---- system ---- */
    beep: function () { return invoke('beep'); },
    flashWindow: function (state) { return invoke('flash_window', { activeCount: state && state.activeCount }); },
    showNativeMessageBox: function (opts) {
      return invoke('show_native_message_box', {
        title: (opts && opts.title) || 'NDM',
        message: (opts && (opts.message || opts.detail)) || '',
        kind: (opts && opts.kind) || null,
      });
    },
    notify: function (opts) {
      return invoke('notify', { title: (opts && opts.title) || 'NDM', body: (opts && opts.body) || '' });
    },
    openExternal: function (url) { return invoke('open_external', { url: url }); },
    setNativeTheme: function (mode) { return invoke('set_native_theme', { theme: mode }); },

    /* ---- fs helpers ---- */
    selectFolder: function (current) { return invoke('select_folder', { current: current || null }); },
    selectFile: function (filters) { return invoke('select_file', { filters: filters || null }); },
    checkFolderExists: function (path) { return invoke('check_folder_exists', { path: path }); },
    createFolder: function (path) { return invoke('create_folder', { path: path }); },
    getDownloadsPath: function () { return invoke('get_downloads_path'); },
    getFileIcon: function (opts) {
      return invoke('get_file_icon', { filePath: (opts && opts.filePath) || '', filename: (opts && opts.filename) || '' });
    },
    exportDiagnostics: function () {
      // The engine already writes the diagnostics bundle; open the folder.
      return invoke('open_folder', { target: '' }).catch(function () { return null; });
    },

    /* ---- updater: real implementations via the Rust shell ---- */
    checkForUpdates: function () { return invoke('check_for_updates'); },
    downloadUpdate: function () { return invoke('download_update'); },
    installUpdate: function () { return invoke('install_update'); },
    quitAndInstall: function () { return invoke('quit_and_install'); },
    getUpdateState: function () { return invoke('get_update_state'); },
    setUpdateChannel: function (ch) { return invoke('set_update_channel', { channel: ch }); },
    setUpdatePolicy: function (policy) {
      return invoke('set_update_policy', {
        checkAutomatically: policy && policy.checkAutomatically,
        notifyWhenReady: policy && policy.notifyWhenReady,
        installAutomatically: policy && policy.installAutomatically,
      });
    },
    onUpdaterStateChanged: function (cb) {
      return onEvent('updater-state-changed', cb);
    },

    /* ---- event subscriptions from the shell ---- */
    onOpenNewDownload: function (cb) {
      return onEvent('open-new-download', cb);
    },
    onShowAddressDialog: function (cb) {
      return onEvent('show-address-dialog', cb);
    },
    requestAddressDialog: function () { return Promise.resolve(); },
    showItemInFolder: function (target) { return invoke('open_folder', { target: target }); },
    openFile: function (target) { return invoke('open_file', { target: target }); },
    openFolder: function (target) { return invoke('open_folder', { target: target }); },
  };

  /** Tauri event -> Electron-style subscription returning an unsubscribe fn. */
  function onEvent(name, cb) {
    try {
      var listen = (window.__TAURI__ && window.__TAURI__.event && window.__TAURI__.event.listen) ||
        (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.listen) || null;
      if (!listen) return function () {};
      var un = listen(name, function (ev) { cb(ev.payload); });
      if (un && typeof un.then === 'function') {
        // tauri v2 returns a promise of an unlisten fn
        var captured = null;
        un.then(function (f) { captured = f; });
        return function () { if (captured) captured(); };
      }
      return typeof un === 'function' ? un : function () {};
    } catch (e) {
      return function () {};
    }
  }

  window.electronAPI = shim;

  // Announce to the app (its bootstrap may check for the bridge).
  document.addEventListener('DOMContentLoaded', function () {
    window.dispatchEvent(new Event('ndm-shell-tauri'));
  });
})();
