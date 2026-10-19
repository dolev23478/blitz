import { Inject, Injectable } from '@nestjs/common';
import type { ChannelPage } from '../types.js';
import { HttpClientService } from './http-client.service.js';
import { parseChannelPage } from './parser.js';

/** Reads the public `t.me/s/<name>` web preview of a channel. */
@Injectable()
export class ScraperService {
  constructor(@Inject(HttpClientService) private readonly http: HttpClientService) {}

  async fetchChannelPage(username: string, before?: number): Promise<ChannelPage> {
    const url = `https://t.me/s/${username}${before ? `?before=${before}` : ''}`;
    const { html, finalUrl } = await this.http.fetchHtml(url);
    // Telegram redirects to https://t.me/<name> when the channel has no public preview.
    if (!new URL(finalUrl).pathname.startsWith('/s/')) {
      throw new Error(`Channel "${username}" is not public or has no web preview`);
    }
    return parseChannelPage(html);
  }

  /** Verifies the channel exists and is publicly previewable. Returns its title. */
  async validateChannel(username: string): Promise<string | null> {
    const page = await this.fetchChannelPage(username);
    if (!page.title && page.messages.length === 0) {
      throw new Error(`Channel "${username}" not found or not public`);
    }
    return page.title;
  }
}
