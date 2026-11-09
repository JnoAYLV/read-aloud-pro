// Gives the app's pages a safe, narrow bridge to the main program (storage, messages, hotkey events).
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('rapBridge', {
  storeGet: q => ipcRenderer.invoke('store:get', q),
  storeSet: o => ipcRenderer.invoke('store:set', o),
  storeRemove: k => ipcRenderer.invoke('store:remove', k),
  send: m => ipcRenderer.invoke('msg', m),
  onStoreChanged: f => ipcRenderer.on('store:changed', (_e, ch) => f(ch)),
  onCommand: f => ipcRenderer.on('command', (_e, m) => f(m)),
  onLoadText: f => ipcRenderer.on('load-text', (_e, m) => f(m)),
  onStatus: f => ipcRenderer.on('status', (_e, m) => f(m))
});
