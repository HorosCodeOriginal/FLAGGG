// preload.js — sichere Brücke: exponiert genau die eine Astra-API an den Renderer.
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel, fn) => {
  const listener = (_e, payload) => fn(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('api', {
  // die eine API: Astra (env 01) — Token liegt im Main-Prozess, nie im DOM
  astro: {
    info: () => ipcRenderer.invoke('astro:info'),
  },
  usage: {
    get: () => ipcRenderer.invoke('usage:get'),
  },
  spaces: {
    list: () => ipcRenderer.invoke('spaces:list'),
    save: item => ipcRenderer.invoke('spaces:save', item),
  },
  roles: {
    list: () => ipcRenderer.invoke('roles:list'),
    save: item => ipcRenderer.invoke('roles:save', item),
  },
  chat: {
    send: (nr, messages, model, params) => ipcRenderer.invoke('chat:send', { nr, messages, model, params }),
    stop: (nr, key) => ipcRenderer.invoke('chat:stop', { nr, key }),
    models: nr => ipcRenderer.invoke('chat:models', nr),
    onToken: cb => on('chat:token', p => cb(p.nr, p.delta)),
    onDone: cb => on('chat:done', p => cb(p.nr, p)),
    onError: cb => on('chat:error', p => cb(p.nr, p)),
  },
  dashboard: {
    listEnvs: () => ipcRenderer.invoke('astro:envs'),
  },
  prefs: {
    check: () => ipcRenderer.invoke('prefs:check'),
  },
});
