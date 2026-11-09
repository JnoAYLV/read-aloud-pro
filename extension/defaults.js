// Shared defaults and settings helpers. Loaded by the content script, the options page and the background worker.
// All settings live in chrome.storage.local under the key "settings".
// In a term list, a * matches any ending (injur* = injury, injured). Plurals (no show -> no shows) match automatically.

self.RAP_PALETTE = ['#9b59ff', '#ff3b30', '#ff9500', '#34c759', '#00c7be', '#007aff', '#ff2d55', '#a2845e', '#5856d6', '#ffcc00'];

self.RAP_DEFAULT_PROFILE = () => ({
  id: 'ops',
  name: 'Operations',
  categories: [
    { id: 'name', label: 'Your name', color: '#9b59ff', enabled: true, isName: true, terms: '' },
    {
      id: 'safety', label: 'Safety', color: '#ff3b30', enabled: true, terms: [
        'safety', 'unsafe', 'injur*', 'incident', 'near miss', 'accident', 'hazard*',
        'first aid', 'OSHA', 'recordable', 'lost time', 'PPE', 'spill', 'collision', 'collided',
        'struck', 'slip', 'trip and fall', 'fell', 'damage*', 'AC damage', 'aircraft damage',
        'W&B', 'weight and balance', 'FOD', 'smoke', 'ergonomic', 'laceration', 'sprain', 'emergency'
      ].join(', ')
    },
    {
      id: 'ctrl', label: 'Controllable failures', color: '#ff9500', enabled: true, terms: [
        'controllable', 'controllable failure', 'missed', 'missort*', 'mis-sort*', 'late', 'delay*',
        'no show', 'call out', 'callout', 'short staffed', 'understaffed', 'staffing', 'absent',
        'rework', 'error', 'mistake', 'human error', 'process failure', 'not followed',
        'non-compliance', 'noncompliant', 'root cause', 'preventable', 'avoidable'
      ].join(', ')
    },
    {
      id: 'action', label: 'Actions & deadlines', color: '#34c759', enabled: true, terms: [
        'action required', 'action item', 'please confirm', 'please review', 'please send', 'please advise',
        'deadline', 'due by', 'due date', 'EOD', 'COB', 'ASAP', 'urgent', 'by tomorrow', 'follow up', 'follow-up'
      ].join(', ')
    }
  ]
});

self.RAP_DEFAULTS = {
  voiceURI: '',
  rate: 1,
  engine: 'browser',                  // 'browser' (free built-in voices) | 'elevenlabs' (uses your ElevenLabs characters)
  elVoice: '', elVoiceName: '', elModel: 'eleven_flash_v2_5',
  speakerLabel: '',                   // output device for ElevenLabs audio ('' = Windows default)
  followScroll: true,
  clickToRead: true,
  autoScan: false,
  saveFolder: 'Read Aloud Notes',     // used when saveTarget is 'downloads'
  saveTarget: 'downloads',            // 'downloads' | 'folder' (any folder, e.g. Google Drive; needs the helper)
  savePath: '',
  writeFormat: 'auto',                // 'auto' | 'outlook' | 'word' | 'teams' | 'slack'
  claudeMode: 'off',                 // 'off' | 'code' (Claude Code on this computer) | 'api' (Anthropic API key)
  model: 'claude-sonnet-5-5',        // API model
  codeModel: 'sonnet',               // Claude Code model alias
  kbBuiltin: { 'email-writing': true, 'house-style': true, 'operations': true, 'aviation-ground-ops': true },
  activeProfile: 'ops',
  profiles: { ops: self.RAP_DEFAULT_PROFILE() }
};

self.RAP_BUILTIN_KB = [
  { id: 'email-writing', title: 'Email writing skills', file: 'knowledge/email-writing.md' },
  { id: 'house-style', title: 'House style (edit to suit)', file: 'knowledge/house-style.md' },
  { id: 'operations', title: 'Operations management knowledge', file: 'knowledge/operations.md' },
  { id: 'aviation-ground-ops', title: 'Aviation and air cargo ground operations', file: 'knowledge/aviation-ground-ops.md' }
];

self.RAP_mergeSettings = saved => {
  const s = Object.assign(structuredClone(self.RAP_DEFAULTS), saved || {});
  s.kbBuiltin = Object.assign({}, self.RAP_DEFAULTS.kbBuiltin, (saved || {}).kbBuiltin || {});
  if (!s.profiles || !Object.keys(s.profiles).length) s.profiles = { ops: self.RAP_DEFAULT_PROFILE() };
  if (!s.profiles[s.activeProfile]) s.activeProfile = Object.keys(s.profiles)[0];
  return s;
};
self.RAP_getSettings = async () => self.RAP_mergeSettings((await chrome.storage.local.get('settings')).settings);
self.RAP_setSettings = async patch => {
  const s = await self.RAP_getSettings();
  Object.assign(s, patch);
  await chrome.storage.local.set({ settings: s });
  return s;
};
self.RAP_newId = () => 'c' + Math.random().toString(36).slice(2, 9);
