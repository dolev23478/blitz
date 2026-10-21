// Real RAM-only HTTP capture and local ASR. No Redis/Kafka or retained recordings.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

process.env.RADIO_ENABLED = 'false';
process.env.RADIO_DATA_DIR = `.tmp/radio-memory-demo-${randomUUID()}`;
const { RadioModule } = await import('../../dist/radio/radio.module.js');
const { RadioService } = await import('../../dist/radio/radio.service.js');
const { LocalRadioWorker } =
  await import('../../dist/radio/local-radio.worker.js');
const { analyzeText } = await import('../../dist/text-analyzer.js');
let speech;
try {
  speech = await readFile('.radio/demo/jfk.wav');
} catch {
  const response = await fetch(
    'https://raw.githubusercontent.com/ggml-org/whisper.cpp/master/samples/jfk.wav',
    { signal: AbortSignal.timeout(60000) },
  );
  assert(response.ok, `Sample download failed: ${response.status}`);
  speech = Buffer.from(await response.arrayBuffer());
}
assert(speech.length < 5 * 1024 * 1024);
assert.equal(speech.toString('ascii', 0, 4), 'RIFF');
const silence = Buffer.alloc(44 + 64000);
silence.write('RIFF');
silence.writeUInt32LE(silence.length - 8, 4);
silence.write('WAVEfmt ', 8);
silence.writeUInt32LE(16, 16);
silence.writeUInt16LE(1, 20);
silence.writeUInt16LE(1, 22);
silence.writeUInt32LE(16000, 24);
silence.writeUInt32LE(32000, 28);
silence.writeUInt16LE(2, 32);
silence.writeUInt16LE(16, 34);
silence.write('data', 36);
silence.writeUInt32LE(64000, 40);
const server = createServer((req, res) => {
  const audio = req.url === '/silence.wav' ? silence : speech;
  res.writeHead(200, {
    'content-type': 'audio/wav',
    'content-length': audio.length,
  });
  res.end(audio);
});
await new Promise((accept) => server.listen(0, '127.0.0.1', accept));
const base = `http://127.0.0.1:${server.address().port}`;
class DemoModule {}
Module({ imports: [RadioModule] })(DemoModule);
let app;
try {
  app = await NestFactory.createApplicationContext(DemoModule, {
    logger: ['log', 'warn', 'error'],
  });
  const radio = app.get(RadioService);
  const worker = app.get(LocalRadioWorker);
  const capture = worker.capture.bind(worker);
  const raw = [];
  worker.capture = async (...args) => {
    const value = await capture(...args);
    raw.push(value);
    return value;
  };
  const result = await radio.collectOnce([
    {
      id: 'speech',
      name: 'Public JFK speech sample',
      streamUrl: `${base}/speech.wav`,
      language: 'en',
    },
    {
      id: 'silence',
      name: 'Generated silence',
      streamUrl: `${base}/silence.wav`,
      language: 'en',
    },
  ]);
  assert.deepEqual(result.failedStations, []);
  assert.equal(raw.length, 2);
  assert.match(raw[0].text.toLowerCase(), /country/);
  assert.equal(raw[1].text, '');
  assert.equal(
    result.clips.length,
    analyzeText(raw[0].text, 'auto').matched ? 1 : 0,
  );
  await assert.rejects(readdir(resolve(process.env.RADIO_DATA_DIR)), {
    code: 'ENOENT',
  });
  console.log(
    JSON.stringify({
      actualPythonAndASR: true,
      accepted: result.clips.length,
      silenceRejected: true,
      recordingsWritten: 0,
    }),
  );
} finally {
  await app?.close();
  await new Promise((accept) => server.close(accept));
}
