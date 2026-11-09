// Builds one WAV with several Kokoro voices, and times fp32 vs q8 on this PC.
import { KokoroTTS } from 'kokoro-js';
import { writeFileSync } from 'node:fs';
const picks = [['af_heart', 'Heart'], ['af_bella', 'Bella'], ['am_michael', 'Michael'], ['bf_emma', 'Emma, British'], ['am_fenrir', 'Fenrir']];
const timing = {};
for (const dtype of ['fp32', 'q8']) {
  const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype, device: 'cpu' });
  const t = Date.now(); await tts.generate('The departure was late by twenty two minutes because the build team was short staffed.', { voice: 'af_heart' });
  timing[dtype] = Date.now() - t;
  if (dtype !== 'fp32') continue;
  const parts = []; let rate = 24000;
  for (const [v, name] of picks) {
    const a = await tts.generate(`This is ${name}. The departure was late by twenty two minutes. Root cause: the build team was short staffed.`, { voice: v });
    rate = a.sampling_rate; parts.push(a.audio, new Float32Array(Math.round(rate * 0.6)));
  }
  const len = parts.reduce((n, p) => n + p.length, 0), pcm = new Int16Array(len); let o = 0;
  for (const p of parts) for (let i = 0; i < p.length; i++) pcm[o++] = Math.max(-1, Math.min(1, p[i])) * 32767;
  const h = Buffer.alloc(44); h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.byteLength, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.byteLength, 40);
  writeFileSync(process.argv[2], Buffer.concat([h, Buffer.from(pcm.buffer)]));
}
console.log(JSON.stringify(timing));
