import * as cheerio from 'cheerio';
import type { Cheerio, CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';
import type { ChannelPage, MediaItem, ParsedMessage } from '../types.js';

/** Parses "1.2K", "5.82M", "834" into a number. */
export function parseViews(raw: string | undefined): number | null {
  if (!raw) return null;
  const m = raw.trim().replace(',', '.').match(/^([\d.]+)\s*([KMB])?$/i);
  if (!m) return null;
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] ?? '').toUpperCase() as 'K' | 'M' | 'B'] ?? 1;
  return Math.round(parseFloat(m[1]!) * mult);
}

function backgroundUrl(style: string | undefined): string | undefined {
  const m = style?.match(/background-image:\s*url\(['"]?(.*?)['"]?\)/);
  if (!m?.[1]) return undefined;
  return m[1].startsWith('//') ? `https:${m[1]}` : m[1];
}

function extractText($: CheerioAPI, el: Cheerio<Element>): string | null {
  if (el.length === 0) return null;
  const clone = el.first().clone();
  clone.find('br').replaceWith('\n');
  const text = clone.text().trim();
  return text || null;
}

function extractMedia($: CheerioAPI, msg: Cheerio<Element>): MediaItem[] {
  const media: MediaItem[] = [];
  msg.find('.tgme_widget_message_photo_wrap').each((_, e) => {
    const url = backgroundUrl($(e).attr('style'));
    if (url) media.push({ type: 'photo', url });
  });
  msg.find('.tgme_widget_message_video_player, .tgme_widget_message_roundvideo_player').each((_, e) => {
    const player = $(e);
    const url = player.find('video').attr('src');
    const thumbnail = backgroundUrl(player.find('[class*="_thumb"]').attr('style'));
    if (url) media.push({ type: 'video', url, ...(thumbnail ? { thumbnail } : {}) });
    else if (thumbnail) media.push({ type: 'video', url: player.attr('href') ?? '', thumbnail });
  });
  msg.find('.tgme_widget_message_document_wrap').each((_, e) => {
    const href = $(e).attr('href');
    if (href) media.push({ type: 'document', url: href });
  });
  msg.find('audio').each((_, e) => {
    const src = $(e).attr('src');
    if (src) media.push({ type: 'audio', url: src });
  });
  return media;
}

function extractLinks($: CheerioAPI, msg: Cheerio<Element>): string[] {
  const links = new Set<string>();
  msg.find('.tgme_widget_message_text a[href], a.tgme_widget_message_link_preview[href]').each((_, e) => {
    const href = $(e).attr('href');
    if (href && /^https?:\/\//.test(href)) links.add(href);
  });
  return [...links];
}

export function parseChannelPage(html: string): ChannelPage {
  const $ = cheerio.load(html);
  const title = $('.tgme_channel_info_header_title').first().text().trim() || null;
  const messages: ParsedMessage[] = [];

  $('.tgme_widget_message[data-post]').each((_, e) => {
    const msg = $(e);
    if (msg.hasClass('service_message')) return;
    const post = msg.attr('data-post') ?? '';
    const messageId = Number(post.split('/').pop());
    const datetime = msg.find('.tgme_widget_message_date time').attr('datetime');
    if (!Number.isInteger(messageId) || !datetime) return;

    const fwd = msg.find('.tgme_widget_message_forwarded_from_name').first();
    const forwardedFrom = fwd.text().trim() || fwd.attr('href') || (fwd.length ? 'unknown' : null);

    messages.push({
      messageId,
      postedAt: new Date(datetime),
      text: extractText($, msg.find('.tgme_widget_message_text').first() as Cheerio<Element>),
      views: parseViews(msg.find('.tgme_widget_message_views').first().text()),
      media: extractMedia($, msg),
      links: extractLinks($, msg),
      forwardedFrom,
      edited: /\bedited\b/.test(msg.find('.tgme_widget_message_meta').text()),
      url: `https://t.me/${post}`,
    });
  });

  messages.sort((a, b) => a.messageId - b.messageId);
  return { title, messages };
}
