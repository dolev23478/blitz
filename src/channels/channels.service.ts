import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { CollectorService } from '../collector/collector.service.js';
import { ScraperService } from '../scraper/scraper.service.js';
import { NumericChannelIdError, normalizeUsername } from '../scraper/username.js';
import { extractNumericId } from '../telegram/telegram.mapper.js';
import { TelegramService, TelegramSourceError } from '../telegram/telegram.service.js';
import type { Channel } from '../types.js';
import { ChannelsRepository } from './channels.repository.js';

export type ChannelView = Channel & { busy: boolean };

@Injectable()
export class ChannelsService {
  constructor(
    @Inject(ChannelsRepository) private readonly repo: ChannelsRepository,
    @Inject(CollectorService) private readonly collector: CollectorService,
    @Inject(ScraperService) private readonly scraper: ScraperService,
    @Inject(TelegramService) private readonly telegram: TelegramService,
  ) {}

  view(c: Channel): ChannelView {
    return { ...c, busy: this.collector.isBusy(c.id) || this.telegram.isBusy(c.id) };
  }

  async list(): Promise<ChannelView[]> {
    return (await this.repo.list()).map((c) => this.view(c));
  }

  /** A channel reference in the URL is either its numeric id or its username. */
  async find(ref: string): Promise<Channel> {
    let channel: Channel | null = null;
    if (/^\d+$/.test(ref)) channel = await this.repo.get(Number(ref));
    else {
      const username = normalizeUsername(ref);
      channel = username ? await this.repo.getByUsername(username) : null;
    }
    if (!channel) throw new NotFoundException('Channel not found');
    return channel;
  }

  async get(ref: string): Promise<ChannelView> {
    return this.view(await this.find(ref));
  }

  async add(input: string): Promise<ChannelView> {
    const numericId = extractNumericId(input);
    if (numericId !== null) {
      if (!this.telegram.ready) {
        throw new BadRequestException(
          'Numeric chat ids need the Telegram account (set TG_API_ID, TG_API_HASH and TG_SESSION_STRING; run "npm run auth" locally to create it)',
        );
      }
      return this.addViaTelegram(numericId);
    }

    let username: string | null;
    try {
      username = normalizeUsername(input);
    } catch (err) {
      if (err instanceof NumericChannelIdError) throw new BadRequestException(err.message);
      throw err;
    }
    if (!username) throw new BadRequestException('Invalid channel username or link');
    if (await this.repo.getByUsername(username)) throw new ConflictException(`Channel @${username} already exists`);

    let title: string | null;
    try {
      title = await this.scraper.validateChannel(username);
    } catch (err) {
      // Groups and channels without a web preview: fall back to the Telegram account.
      if (this.telegram.ready) return this.addViaTelegram(username);
      throw new UnprocessableEntityException(err instanceof Error ? err.message : String(err));
    }

    const channel = await this.repo.create(username, title);
    this.collector.runNow(channel);
    return this.view(channel);
  }

  async setActive(ref: string, active: boolean): Promise<ChannelView> {
    const channel = await this.find(ref);
    return this.view((await this.repo.setActive(channel.id, active))!);
  }

  async remove(ref: string): Promise<void> {
    const channel = await this.find(ref);
    await this.repo.remove(channel.id);
    this.telegram.untrack(channel);
  }

  async backfill(ref: string, days?: number): Promise<void> {
    const channel = await this.find(ref);
    const started = channel.source === 'mtproto'
      ? this.telegram.backfill(channel, days)
      : this.collector.backfillNow(channel, days);
    if (!started) throw new ConflictException('Channel is busy, try again shortly');
  }

  private async addViaTelegram(ref: string | number): Promise<ChannelView> {
    try {
      return this.view(await this.telegram.addChannel(ref));
    } catch (err) {
      if (err instanceof TelegramSourceError) throw new HttpException(err.message, err.status);
      throw err;
    }
  }
}
