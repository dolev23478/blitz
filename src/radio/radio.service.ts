import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { LocalRadioWorker } from './local-radio.worker.js';
import { analyzeText } from '../text-analyzer.js';
import {
  radioStationsSchema,
  readRadioSettings,
  type RadioStation,
} from './radio.config.js';
import {
  radioTranscriptSchema,
  type RadioCycleResult,
  type RadioTranscript,
} from './radio.types.js';

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
    (
      clip: RadioTranscript,
      analysis: ReturnType<typeof analyzeText>,
    ) => Promise<void>
  >();

  /** Collection stays usable alone; the application registers its Transformer handoff. */
  watchTranscripts(
    listener: (
      clip: RadioTranscript,
      analysis: ReturnType<typeof analyzeText>,
    ) => Promise<void>,
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
      clips: [],
      failedStations: [],
    };
    for (const station of stations) {
      if (this.closing) break;
      const clipId = randomUUID();
      try {
        this.logger.log({
          event: 'radio_capture_started',
          stationId: station.id,
          stationName: station.name,
          clipId,
          clipSeconds: this.settings.recordingSeconds,
        });
        const captured = await this.worker.capture(station, this.settings);
        const clip: RadioTranscript = radioTranscriptSchema.parse({
          ...captured,
          clipId,
          station,
          status: captured.text.trim() ? 'transcribed' : 'no_speech',
        });
        const analysis = clip.text.trim()
          ? analyzeText(clip.text, 'auto')
          : undefined;
        this.logger.log({
          event: 'radio_filter_result',
          clipId,
          stationId: station.id,
          passed: analysis?.matched ?? false,
          reason: !analysis
            ? 'no_speech'
            : analysis.matched
              ? 'dictionary_match'
              : 'no_dictionary_match',
        });
        if (!analysis?.matched) continue;

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
          // Publisher shutdown retains admitted reports in Redis; do not block Nest teardown on retries.
          await Promise.race([listener(clip, analysis), this.shutdown]);
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
      }
    }
    return result;
  }

  private reason(error: unknown): string {
    return error instanceof Error
      ? error.message.slice(0, 2000)
      : 'Unknown radio failure.';
  }
  async onModuleDestroy(): Promise<void> {
    this.closing = true;
    this.finishHandoffOnShutdown();
    clearTimeout(this.timer);
    await this.worker.onModuleDestroy();
    await this.active?.catch(() => undefined);
  }
}
