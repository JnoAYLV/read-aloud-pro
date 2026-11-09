// Simple key-value store saved as JSON in the app's data folder (replaces chrome.storage.local).
const fs = require('fs'), path = require('path');
let file = null, data = {}, timer = null;
const listeners = [];
function init(dir) {
  fs.mkdirSync(dir, { recursive: true });
  file = path.join(dir, 'store.json');
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { data = {}; }
}
function flush() { clearTimeout(timer); timer = null; if (file) { fs.writeFileSync(file + '.tmp', JSON.stringify(data)); fs.renameSync(file + '.tmp', file); } }
function schedule() { if (!timer) timer = setTimeout(flush, 300); }
const get = k => data[k];
function getMany(q) {
  if (q == null) return { ...data };
  if (typeof q === 'string') return { [q]: data[q] };
  if (Array.isArray(q)) return Object.fromEntries(q.map(k => [k, data[k]]));
  const o = { ...q }; for (const k in q) if (k in data) o[k] = data[k]; return o;
}
function set(obj) { const ch = {}; for (const k in obj) { ch[k] = { newValue: obj[k], oldValue: data[k] }; data[k] = obj[k]; } schedule(); listeners.forEach(f => f(ch)); }
function remove(keys) { const ch = {}; for (const k of [].concat(keys)) { ch[k] = { newValue: undefined, oldValue: data[k] }; delete data[k]; } schedule(); listeners.forEach(f => f(ch)); }
module.exports = { init, get, getMany, set, remove, flush, onChanged: f => listeners.push(f) };
