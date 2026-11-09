// One-off check: does Kokoro load and speak on this PC, and how fast?
import { KokoroTTS } from 'kokoro-js';
import { writeFileSync } from 'node:fs';
const t0 = Date.now();
const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'q8', device: 'cpu' });
const tLoad = Date.now() - t0;
const text = 'At two fourteen, a tug driver reported a near miss with a ULD dolly on the north ramp. No one was hurt.';
const t1 = Date.now();
const audio = await tts.generate(text, { voice: 'af_heart' });
const tGen = Date.now() - t1;
const secs = audio.audio.length / audio.sampling_rate;
writeFileSync(process.argv[2] || 'kokoro-test.wav', Buffer.from(audio.toWav()));
console.log(JSON.stringify({ loadMs: tLoad, genMs: tGen, audioSeconds: +secs.toFixed(2), realtimeFactor: +(tGen / 1000 / secs).toFixed(2), voices: Object.keys(tts.voices).length, sample: Object.keys(tts.voices).slice(0, 12) }));
