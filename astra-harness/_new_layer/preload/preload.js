// preload.js — contextBridge: exposes eine sichere api an den renderer.
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel, fn) => {
  const listener = (_e, payload) => fn(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('api', {
  dashboard: {
    listEnvs: () => ipcRenderer.invoke('env:list'),
    openEnv: nr => ipcRenderer.invoke('env:open', nr),
    closeEnv: nr => ipcRenderer.invoke('env:close', nr),
    openStudio: () => ipcRenderer.invoke('studio:open'),
    getFleet: () => ipcRenderer.invoke('fleet:get'),
  },
  chat: {
    send: (nr, messages, model, params) => ipcRenderer.invoke('chat:send', { nr, messages, model, params }),
    stop: (nr, key) => ipcRenderer.invoke('chat:stop', { nr, key }),
    models: nr => ipcRenderer.invoke('chat:models', nr),
    onToken: cb => on('chat:token', p => cb(p.nr, p.delta)),
    onDone: cb => on('chat:done', p => cb(p.nr, p)),
    onError: cb => on('chat:error', p => cb(p.nr, p)),
    onReady: cb => on('env:ready', p => cb(p.nr, p.def)),
  },
  files: {
    tree: (nr, p) => ipcRenderer.invoke('files:tree', { nr, path: p }),
    read: (nr, p) => ipcRenderer.invoke('file:read', { nr, path: p }),
    write: (nr, p, content) => ipcRenderer.invoke('file:write', { nr, path: p, content }),
    create: (nr, p, type) => ipcRenderer.invoke('file:create', { nr, path: p, type }),
    remove: (nr, p) => ipcRenderer.invoke('file:delete', { nr, path: p }),
  },
  term: {
    data: (nr, data) => ipcRenderer.invoke('term:data', { nr, data }),
    resize: (nr, cols, rows) => ipcRenderer.invoke('term:resize', { nr, cols, rows }),
    kill: nr => ipcRenderer.invoke('term:kill', nr),
    run: (nr, code, runtime) => ipcRenderer.invoke('term:run', { nr, code, runtime }),
    onData: cb => on('term:data', p => cb(p.nr, p.data)),
    onExit: cb => on('term:exit', p => cb(p.nr, p.code)),
  },
  config: {
    get: nr => ipcRenderer.invoke('config:get', nr),
    set: (nr, config) => ipcRenderer.invoke('config:set', { nr, config }),
    getHistory: nr => ipcRenderer.invoke('history:get', nr),
    setHistory: (nr, messages) => ipcRenderer.invoke('history:set', { nr, messages }),
  },
  shell: {
    openExternal: url => ipcRenderer.invoke('shell:openExternal', url),
  },
  clipboard: {
    write: text => ipcRenderer.invoke('clipboard:write', text),
  },
  astra: {
    info: () => ipcRenderer.invoke('astra:info'),
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
  failover: {
    list: () => ipcRenderer.invoke('failover:list'),
    get: () => ipcRenderer.invoke('failover:get'),
    save: conf => ipcRenderer.invoke('failover:save', conf),
  },
});
