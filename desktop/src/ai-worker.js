// Runs in its own process so speech generation never freezes the window.
//   tts : Kokoro text-to-speech (free, on this PC). Returns 16-bit WAV + per-character start times.
//   stt : Whisper speech-to-text for push-to-talk commands (free, on this PC).
// Models download once from Hugging Face on first use and are then cached on disk.
const path = require('path');
let kokoro = null, whisper = null, kokoroLoading = null, whisperLoading = null;
const CACHE = process.env.RAP_MODEL_CACHE;

async function getKokoro() {
  if (kokoro) return kokoro;
  if (!kokoroLoading) kokoroLoading = (async () => {
    const { env } = await import('@huggingface/transformers');
    if (CACHE) env.cacheDir = CACHE;
    const { KokoroTTS } = await import('kokoro-js');
    kokoro = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'fp32', device: 'cpu' });
    return kokoro;
  })();
  return kokoroLoading;
}
async function getWhisper() {
  if (whisper) return whisper;
  if (!whisperLoading) whisperLoading = (async () => {
    const { pipeline, env } = await import('@huggingface/transformers');
    if (CACHE) env.cacheDir = CACHE;
    whisper = await pipeline('automatic-speech-recognition', 'onnx-community/whisper-base.en', { dtype: 'fp32', device: 'cpu' });
    return whisper;
  })();
  return whisperLoading;
}

// Kokoro gives audio but no word timings. Spread the real audio length over the characters,
// giving punctuation extra weight for the pauses the voice makes there.
function charStarts(text, seconds) {
  const w = [...text].map(ch => /[.!?]/.test(ch) ? 7 : /[,;:]/.test(ch) ? 4 : /\s/.test(ch) ? 0.6 : /[\p{L}\p{N}]/u.test(ch) ? 1 : 0.3);
  const lead = 0.06 * seconds, tail = 0.08 * seconds;            // short silence at both ends of each clip
  const total = w.reduce((a, b) => a + b, 0) || 1, span = Math.max(0.1, seconds - lead - tail);
  let acc = 0; return w.map(x => { const t = lead + (acc / total) * span; acc += x; return +t.toFixed(3); });
}
function wav(float32, rate) {
  const pcm = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) pcm[i] = Math.max(-1, Math.min(1, float32[i])) * 32767;
  const h = Buffer.alloc(44); h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.byteLength, 4); h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.byteLength, 40);
  return Buffer.concat([h, Buffer.from(pcm.buffer)]);
}

process.parentPort.on('message', async ({ data: m }) => {
  const reply = r => process.parentPort.postMessage({ id: m.id, ...r });
  try {
    if (m.op === 'tts') {
      const tts = await getKokoro();
      const a = await tts.generate(m.text, { voice: m.voice || 'af_heart', speed: m.speed || 1 });
      const secs = a.audio.length / a.sampling_rate;
      reply({ audio: wav(a.audio, a.sampling_rate).toString('base64'), starts: charStarts(m.text, secs), seconds: secs });
    } else if (m.op === 'voices') {
      const tts = await getKokoro();
      reply({ voices: Object.entries(tts.voices).map(([id, v]) => ({ id, name: v.name, language: v.language, gender: v.gender })) });
    } else if (m.op === 'stt') {
      const asr = await getWhisper();
      const r = await asr(new Float32Array(m.pcm), { language: 'english' });
      reply({ text: String(r.text || '').trim() });
    } else if (m.op === 'warm') {
      await getKokoro(); reply({ ok: true });
    } else reply({ error: 'unknown op' });
  } catch (e) { reply({ error: e.message || String(e) }); }
});
