'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('deck', {
  platform: process.platform, // sync: keyboard chords are chosen before any IPC answers
  spawn: (opts) => ipcRenderer.invoke('pty:spawn', opts),
  input: (id, data) => ipcRenderer.send('pty:input', { id, data }),
  resize: (id, cols, rows) => ipcRenderer.send('pty:resize', { id, cols, rows }),
  kill: (id) => ipcRenderer.send('pty:kill', { id }),
  onData: (cb) => ipcRenderer.on('pty:data', (_e, p) => cb(p)),
  onExit: (cb) => ipcRenderer.on('pty:exit', (_e, p) => cb(p)),
  gitDiff: (cwd, baseRef) => ipcRenderer.invoke('git:diff', { cwd, baseRef }),
  gitMerge: (opts) => ipcRenderer.invoke('git:merge', opts),
  gitPr: (opts) => ipcRenderer.invoke('git:pr', opts),
  isRepo: (dir) => ipcRenderer.invoke('git:isRepo', { dir }),
  openDir: () => ipcRenderer.invoke('dialog:openDir'),
  appInfo: () => ipcRenderer.invoke('app:info'),
  reposList: () => ipcRenderer.invoke('repos:list'),
  reposAdd: (dir) => ipcRenderer.invoke('repos:add', { path: dir }),
  reposRemove: (id) => ipcRenderer.invoke('repos:remove', { id }),
  clipboardWrite: (text) => ipcRenderer.invoke('clipboard:write', text),
  clipboardRead: () => ipcRenderer.invoke('clipboard:read'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  onUpdateAvailable: (cb) => ipcRenderer.on('update:available', (_e, p) => cb(p)),
  openExternal: (url) => ipcRenderer.send('update:open', url),
});
