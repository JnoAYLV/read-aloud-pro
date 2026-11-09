// Lets the shared extension code run unchanged in the desktop app: provides chrome.storage and
// chrome.runtime on top of the desktop bridge.
(() => {
  const B = window.rapBridge;
  const listeners = [];
  B.onStoreChanged(ch => listeners.forEach(f => f(ch, 'local')));
  const local = { get: q => B.storeGet(q), set: o => B.storeSet(o), remove: k => B.storeRemove(k) };
  const msgListeners = [];
  B.onCommand(m => msgListeners.forEach(f => f(m, {}, () => {})));
  window.RAP_DESKTOP = true;
  window.chrome = {
    storage: { local, sync: local, onChanged: { addListener: f => listeners.push(f) } },
    runtime: { id: 'desktop', getURL: p => p, sendMessage: m => B.send(m), onMessage: { addListener: f => msgListeners.push(f) } }
  };
})();
