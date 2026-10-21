import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { LocalRadioWorker } from './local-radio.worker.js';
import {
  radioDataDirectory,
  radioStationsSchema,
  readRadioSettings,
  type RadioStation,
} from './radio.config.js';
import {
  radioTranscriptSchema,
  type RadioCycleResult,
  type RadioTranscript,
} from './radio.types.js';

const clipIdPattern =
  /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;

@Injectable()
export class RadioService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(RadioService.name);
  readonly settings;
  private timer?: NodeJS.Timeout;
  private active?: Promise<RadioCycleResult>;
  private closing = false;
  private finishHandoffOnShutdown!: () => void;
  private readonly shutdown = new Promise<void>((resolve) => {
    this.finishHandoffOnShutdown = resolve;
  });
  private readonly transcriptListeners = new Set<
    (clip: RadioTranscript) => Promise<void>
  >();

  /** Collection stays usable alone; the application registers its Transformer handoff. */
  watchTranscripts(
    listener: (clip: RadioTranscript) => Promise<void>,
  ): () => void {
    this.transcriptListeners.add(listener);
    return () => {
      this.transcriptListeners.delete(listener);
    };
  }

  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    @Inject(LocalRadioWorker) private readonly worker: LocalRadioWorker,
  ) {
    this.settings = readRadioSettings(config);
  }

  onApplicationBootstrap(): void {
    if (!this.settings.RADIO_ENABLED) return;
    this.logger.log({
      event: 'radio_started',
      stations: this.settings.stations.length,
      recordingSeconds: this.settings.recordingSeconds,
      pauseSeconds: this.settings.pauseSeconds,
    });
    void this.scheduledCycle();
  }

  private async scheduledCycle(): Promise<void> {
    try {
      await this.collectOnce();
    } catch (error) {
      this.logger.error({
        event: 'radio_cycle_failed',
        reason: this.reason(error),
      });
    } finally {
      if (!this.closing) {
        this.logger.log({
          event: 'radio_paused',
          seconds: this.settings.pauseSeconds,
        });
        this.timer = setTimeout(() => {
          void this.scheduledCycle();
        }, this.settings.pauseSeconds * 1000);
      }
    }
  }

  /** One sequential cycle; waits for any registered handoff before moving to the next station. */
  async collectOnce(input?: RadioStation[]): Promise<RadioCycleResult> {
    if (this.active || this.closing)
      return {
        skipped: true,
        archiveFull: false,
        clips: [],
        failedStations: [],
      };
    const stations = radioStationsSchema.parse(input ?? this.settings.stations);
    this.active = this.captureStations(stations);
    try {
      return await this.active;
    } finally {
      this.active = undefined;
    }
  }

  private async captureStations(
    stations: RadioStation[],
  ): Promise<RadioCycleResult> {
    const result: RadioCycleResult = {
      skipped: false,
      archiveFull: false,
      clips: [],
      failedStations: [],
    };
    await mkdir(this.clipsDirectory(), { recursive: true });
    await mkdir(resolve(this.dataDirectory(), 'tmp'), { recursive: true });
    for (const station of stations) {
      if (this.closing) break;
      if ((await this.archiveSize()) >= this.settings.RADIO_MAX_CLIPS) {
        result.archiveFull = true;
        this.logger.warn({
          event: 'radio_archive_full',
          capacity: this.settings.RADIO_MAX_CLIPS,
        });
        break; // Pause collection; never evict audio or the user's saves directory.
      }
      const clipId = randomUUID();
      try {
        this.logger.log({
          event: 'radio_capture_started',
          stationId: station.id,
          stationName: station.name,
          clipId,
          clipSeconds: this.settings.recordingSeconds,
        });
        const captured = await this.worker.capture(
          station,
          this.audioPath(clipId),
          this.settings,
        );
        const clip: RadioTranscript = radioTranscriptSchema.parse({
          ...captured,
          clipId,
          station,
          status: captured.text.trim() ? 'transcribed' : 'no_speech',
        });
        // JSON is the completion marker; rename exposes a complete file to HTTP readers.
        await writeFile(this.clipFile(clipId, 'txt'), clip.text + '\n', {
          flag: 'wx',
        });
        await writeFile(
          this.clipFile(clipId, 'json.tmp'),
          JSON.stringify(clip, null, 2) + '\n',
          { flag: 'wx' },
        );
        await rename(
          this.clipFile(clipId, 'json.tmp'),
          this.clipFile(clipId, 'json'),
        );
        result.clips.push(clip);
        this.logger.log({
          event:
            clip.status === 'transcribed'
              ? 'radio_transcribed'
              : 'radio_no_speech',
          stationId: station.id,
          clipId,
          durationSeconds: clip.durationSeconds,
          language: clip.language,
          transcript: clip.text,
        });
        for (const listener of this.transcriptListeners) {
          if (this.closing) break;
          // The pipeline logs a filter decision for every clip, including no-speech input.
          // Publisher shutdown retains admitted reports in Redis; do not block Nest teardown on retries.
          await Promise.race([listener(clip), this.shutdown]);
        }
      } catch (error) {
        result.failedStations.push(station.id);
        const reason = this.reason(error);
        this.logger.warn({
          event: 'radio_station_failed',
          stationId: station.id,
          clipId,
          reason,
        });
        await writeFile(
          this.clipFile(clipId, 'error.json'),
          JSON.stringify(
            {
              clipId,
              station,
              failedAt: new Date().toISOString(),
              reason,
            },
            null,
            2,
          ) + '\n',
          { flag: 'wx' },
        ).catch(() => undefined);
      }
    }
    return result;
  }

  async readClip(id: string): Promise<RadioTranscript> {
    return radioTranscriptSchema.parse(
      JSON.parse(await readFile(this.clipFile(id, 'json'), 'utf8')),
    );
  }

  /** Newest completed clips only; partial/failed jobs are left intact on disk. */
  async listClips(): Promise<RadioTranscript[]> {
    const files = await readdir(this.clipsDirectory()).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return [];
        throw error;
      },
    );
    const clips: RadioTranscript[] = [];
    for (const file of files) {
      const id = file.replace(/\.json$/, '');
      if (!clipIdPattern.test(id)) continue;
      try {
        clips.push(await this.readClip(id));
      } catch {
        this.logger.warn({ event: 'radio_archive_unreadable', clipId: id });
      }
    }
    return clips.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  audioPath(id: string): string {
    return this.clipFile(id, 'wav');
  }

  private clipFile(id: string, extension: string): string {
    if (!clipIdPattern.test(id)) throw new Error('Invalid radio clip ID.');
    return resolve(this.clipsDirectory(), `${id}.${extension}`);
  }
  private dataDirectory(): string {
    return radioDataDirectory(this.settings.RADIO_DATA_DIR);
  }
  private clipsDirectory(): string {
    return resolve(this.dataDirectory(), 'clips');
  }
  private reason(error: unknown): string {
    return error instanceof Error
      ? error.message.slice(0, 2000)
      : 'Unknown radio failure.';
  }
  private async archiveSize(): Promise<number> {
    const files = await readdir(this.clipsDirectory());
    return new Set(
      files
        .map((file) => file.split('.')[0]!)
        .filter((id) => clipIdPattern.test(id)),
    ).size;
  }

  async onModuleDestroy(): Promise<void> {
    this.closing = true;
    this.finishHandoffOnShutdown();
    clearTimeout(this.timer);
    await this.worker.onModuleDestroy();
    await this.active?.catch(() => undefined);
  }
}
