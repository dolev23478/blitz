// Real HTTP capture and local ASR. No Telegram, X, Transformer, Redis or Kafka imports.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Module } from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';

process.env.RADIO_ENABLED = 'false';
process.env.RADIO_DATA_DIR = '.radio/demo';
process.env.API_KEY = 'radio-local-demo-only';
const { RadioModule } = await import('../../dist/radio/radio.module.js');
const { RadioService } = await import('../../dist/radio/radio.service.js');
const { ApiKeyGuard } = await import('../../dist/common/api-key.guard.js');
const directory = resolve('.radio/demo');
await mkdir(directory, { recursive: true });
const samplePath = resolve(directory, 'jfk.wav');
let speech;
try {
  speech = await readFile(samplePath);
} catch {
  console.log('Downloading the public JFK speech sample into .radio/demo ...');
  const response = await fetch(
    'https://raw.githubusercontent.com/ggml-org/whisper.cpp/master/samples/jfk.wav',
    {
      signal: AbortSignal.timeout(60000),
    },
  );
  assert(response.ok, `Sample download failed: HTTP ${response.status}`);
  speech = Buffer.from(await response.arrayBuffer());
  assert(speech.length < 5 * 1024 * 1024, 'Unexpected sample size');
  assert.equal(speech.toString('ascii', 0, 4), 'RIFF');
  await writeFile(samplePath, speech);
}
const silence = Buffer.alloc(44 + 16000 * 2 * 2);
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
silence.writeUInt32LE(silence.length - 44, 40);
const server = createServer((req, res) => {
  const audio = req.url === '/silence.wav' ? silence : speech;
  res.writeHead(200, {
    'content-type': 'audio/wav',
    'content-length': audio.length,
  });
  res.end(audio);
});
await new Promise((accept, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', accept);
});
const streamBase = `http://127.0.0.1:${server.address().port}`;
class RadioDemoModule {}
Module({
  imports: [RadioModule],
  providers: [{ provide: APP_GUARD, useClass: ApiKeyGuard }],
})(RadioDemoModule);
let app;
try {
  app = await NestFactory.create(RadioDemoModule, new FastifyAdapter(), {
    logger: ['log', 'warn', 'error'],
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const radio = app.get(RadioService);
  const result = await radio.collectOnce([
    {
      id: 'speech-demo',
      name: 'Public JFK speech sample',
      streamUrl: `${streamBase}/speech.wav`,
      language: 'en',
    },
    {
      id: 'silence-demo',
      name: 'Generated silence',
      streamUrl: `${streamBase}/silence.wav`,
      language: 'en',
    },
  ]);
  assert.deepEqual(result.failedStations, [], JSON.stringify(result));
  assert.equal(result.clips.length, 2);
  const [spoken, quiet] = result.clips;
  assert.notEqual(spoken.clipId, quiet.clipId);
  assert.match(spoken.text.toLowerCase(), /country/);
  assert.equal(spoken.language, 'en');
  assert.equal(spoken.status, 'transcribed');
  assert.equal(quiet.text, '');
  assert.equal(quiet.status, 'no_speech');
  assert.equal(quiet.language, 'unknown');
  const http = app.getHttpAdapter().getInstance();
  const headers = { 'x-api-key': process.env.API_KEY };
  assert.equal(
    (await http.inject({ method: 'GET', url: '/api/radio/clips' })).statusCode,
    401,
  );
  for (const clip of result.clips) {
    const url = `/api/radio/clips/${clip.clipId}`;
    const json = await http.inject({ method: 'GET', url, headers });
    assert.equal(json.statusCode, 200);
    assert.equal(json.json().text, clip.text);
    const audio = await http.inject({
      method: 'GET',
      url: url + '/audio',
      headers,
    });
    assert.equal(audio.statusCode, 200);
    assert.match(audio.headers['content-type'], /audio\/wav/);
    assert.equal(audio.rawPayload.toString('ascii', 0, 4), 'RIFF');
    const wav = await readFile(
      resolve(directory, 'clips', clip.clipId + '.wav'),
    );
    assert.equal(wav.readUInt32LE(24), 16000);
    assert(
      Math.abs(wav.readUInt32LE(40) / 32000 - clip.durationSeconds) < 0.01,
    );
    assert.equal(
      (
        await readFile(
          resolve(directory, 'clips', clip.clipId + '.txt'),
          'utf8',
        )
      ).trim(),
      clip.text,
    );
  }
  assert.equal(
    (
      await http.inject({
        method: 'GET',
        url: '/api/radio/clips/not-a-uuid',
        headers,
      })
    ).statusCode,
    400,
  );
  const summary = {
    verifiedAt: new Date().toISOString(),
    source: 'Public recorded English speech over local HTTP, not live radio',
    downstreamServicesConnected: false,
    actualPythonAndASR: true,
    httpAndAuthVerified: true,
    ...result,
  };
  await writeFile(
    resolve(directory, 'sample-run.json'),
    JSON.stringify(summary, null, 2) + '\n',
  );
  console.log(
    'Real capture + transcription + silence + protected HTTP checks passed.',
  );
  console.log(`Transcript: ${spoken.text}`);
  console.log(`Evidence: ${resolve(directory, 'sample-run.json')}`);
} finally {
  await app?.close();
  await new Promise((accept, reject) =>
    server.close((error) => (error ? reject(error) : accept())),
  );
}
