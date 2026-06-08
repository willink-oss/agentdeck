'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('deck', {
  spawn: (opts) => ipcRenderer.invoke('pty:spawn', opts),
  input: (id, data) => ipcRenderer.send('pty:input', { id, data }),
  resize: (id, cols, rows) => ipcRenderer.send('pty:resize', { id, cols, rows }),
  kill: (id) => ipcRenderer.send('pty:kill', { id }),
  onData: (cb) => ipcRenderer.on('pty:data', (_e, p) => cb(p)),
  onExit: (cb) => ipcRenderer.on('pty:exit', (_e, p) => cb(p)),
  gitDiff: (cwd, baseRef) => ipcRenderer.invoke('git:diff', { cwd, baseRef }),
  gitMerge: (opts) => ipcRenderer.invoke('git:merge', opts),
  isRepo: (dir) => ipcRenderer.invoke('git:isRepo', { dir }),
  openDir: () => ipcRenderer.invoke('dialog:openDir'),
  appInfo: () => ipcRenderer.invoke('app:info'),
  reposList: () => ipcRenderer.invoke('repos:list'),
  reposAdd: (dir) => ipcRenderer.invoke('repos:add', { path: dir }),
  reposRemove: (id) => ipcRenderer.invoke('repos:remove', { id }),
});
