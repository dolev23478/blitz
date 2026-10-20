import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { execFile, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  radioDataDirectory,
  type RadioSettings,
  type RadioStation,
} from './radio.config.js';
import { captureResultSchema, type CaptureResult } from './radio.types.js';

@Injectable()
export class LocalRadioWorker implements OnModuleDestroy {
  private readonly children = new Map<ChildProcess, Promise<unknown>>();
  private closing = false;

  capture(
    station: RadioStation,
    audioPath: string,
    settings: RadioSettings,
  ): Promise<CaptureResult> {
    if (this.closing)
      return Promise.reject(new Error('Radio worker is shutting down.'));
    const dataDirectory = radioDataDirectory(settings.RADIO_DATA_DIR);
    let child: ChildProcess;
    const pending = new Promise<CaptureResult>((accept, reject) => {
      child = execFile(
        resolve(settings.RADIO_PYTHON_PATH),
        [fileURLToPath(new URL('./local_worker.py', import.meta.url))],
        {
          windowsHide: true,
          timeout: settings.RADIO_JOB_TIMEOUT_SECONDS * 1000,
          maxBuffer: 2 * 1024 * 1024,
          killSignal: 'SIGKILL',
          env: {
            ...process.env,
            PYTHONUTF8: '1',
            HF_HOME: resolve(dataDirectory, 'models'),
            XDG_CACHE_HOME: resolve(dataDirectory, 'cache'),
            TMP: resolve(dataDirectory, 'tmp'),
            TEMP: resolve(dataDirectory, 'tmp'),
            TMPDIR: resolve(dataDirectory, 'tmp'),
          },
        },
        (error, stdout, stderr) => {
          this.children.delete(child);
          if (error) {
            const reason = error.killed
              ? 'timed out or stopped'
              : stderr.trim().slice(-1500) || error.message;
            reject(new Error(`Local radio job failed: ${reason}`));
            return;
          }
          try {
            const result = captureResultSchema.parse(JSON.parse(stdout));
            if (result.durationSeconds > settings.recordingSeconds + 0.01)
              throw new Error('Audio exceeded the configured duration.');
            accept(result);
          } catch {
            reject(
              new Error('Local transcription returned an invalid result.'),
            );
          }
        },
      );
      child.stdin?.on('error', () => undefined); // execFile's callback handles process failures.
      child.stdin?.end(
        JSON.stringify({
          streamUrl: station.streamUrl,
          language: station.language,
          seconds: settings.recordingSeconds,
          audioPath,
          model: settings.RADIO_MODEL,
          cpuThreads: settings.RADIO_CPU_THREADS,
          modelCache: resolve(dataDirectory, 'models'),
        }),
      );
    });
    this.children.set(child!, pending);
    return pending;
  }

  async onModuleDestroy(): Promise<void> {
    this.closing = true;
    const pending = [...this.children.values()];
    for (const child of this.children.keys()) child.kill('SIGKILL');
    await Promise.allSettled(pending);
  }
}
