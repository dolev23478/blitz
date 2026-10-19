import { Injectable } from '@nestjs/common';
import type { ScrapedPost, ScrapedPostMedia } from '../contracts/x-scraper.interfaces.js';

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

@Injectable()
export class ManagedApiNormalizer {
  public normalizeTwitterApiIo(response: unknown): ScrapedPost[] {
    return this.normalizePayload(response, 'twitterapi_io');
  }

  public normalizeApify(response: unknown): ScrapedPost[] {
    return this.normalizePayload(response, 'apify');
  }

  public normalize(
    providerOrPayload: string | unknown,
    payloadOrProvider?: unknown,
  ): ScrapedPost[] {
    if (typeof providerOrPayload === 'string') {
      const provider = providerOrPayload.toLowerCase();
      if (provider.includes('apify')) {
        return this.normalizeApify(payloadOrProvider);
      }
      return this.normalizeTwitterApiIo(payloadOrProvider);
    }

    if (typeof payloadOrProvider === 'string') {
      const provider = payloadOrProvider.toLowerCase();
      if (provider.includes('apify')) {
        return this.normalizeApify(providerOrPayload);
      }
      return this.normalizeTwitterApiIo(providerOrPayload);
    }

    return this.normalizeTwitterApiIo(providerOrPayload);
  }

  public normalizeTwitterApiIoPost(item: unknown): ScrapedPost | null {
    return this.normalizeSingleItem(item, 'twitterapi_io');
  }

  public normalizeApifyPost(item: unknown): ScrapedPost | null {
    return this.normalizeSingleItem(item, 'apify');
  }

  private normalizePayload(
    response: unknown,
    provider: 'twitterapi_io' | 'apify',
  ): ScrapedPost[] {
    if (!response) {
      return [];
    }

    const items = this.extractItems(response);
    const posts: ScrapedPost[] = [];

    for (const item of items) {
      try {
        const post = this.normalizeSingleItem(item, provider);
        if (post) {
          posts.push(post);
        }
      } catch {
        // Never throw on a single malformed post object; skip invalid items and continue
        continue;
      }
    }

    return posts;
  }

  private extractItems(raw: unknown): unknown[] {
    if (Array.isArray(raw)) {
      return raw;
    }

    if (!isRecord(raw)) {
      return [];
    }

    // Direct tweets array
    if (Array.isArray(raw.tweets)) {
      return raw.tweets;
    }

    // Direct items array (e.g. Apify dataset)
    if (Array.isArray(raw.items)) {
      return raw.items;
    }

    // Nested data object
    if (isRecord(raw.data)) {
      if (Array.isArray(raw.data.tweets)) {
        return raw.data.tweets;
      }
      if (Array.isArray(raw.data.items)) {
        return raw.data.items;
      }
      if (Array.isArray(raw.data.data)) {
        return raw.data.data;
      }
      if (Array.isArray(raw.data.results)) {
        return raw.data.results;
      }
      if (Array.isArray(raw.data)) {
        return raw.data;
      }
    }

    if (Array.isArray(raw.results)) {
      return raw.results;
    }

    if (Array.isArray(raw.data)) {
      return raw.data;
    }

    // Single post object
    if (raw.id || raw.id_str) {
      return [raw];
    }

    return [];
  }

  private normalizeSingleItem(
    item: unknown,
    provider: 'twitterapi_io' | 'apify',
  ): ScrapedPost | null {
    if (!isRecord(item)) {
      return null;
    }

    // Unify id extraction
    const id = this.getString(item, 'id_str', 'id', 'tweet_id');
    if (!id) {
      return null;
    }

    // Text extraction (prefer untruncated note_tweet / full_text)
    let text: string | undefined = undefined;

    const noteTweet = isRecord(item.note_tweet)
      ? item.note_tweet
      : isRecord(item.noteTweet)
        ? item.noteTweet
        : undefined;

    if (noteTweet) {
      text = this.getString(noteTweet, 'text', 'full_text');
    }

    if (!text) {
      text = this.getString(item, 'full_text', 'fullText', 'text', 'tweet_text');
    }

    if (typeof text !== 'string' || text.trim().length === 0) {
      return null;
    }

    // Extract Author
    const authorHandle = this.extractAuthorHandle(item, provider);
    const authorName = this.extractAuthorName(item, provider) || authorHandle || '';
    const authorAvatarUrl = this.extractAuthorAvatar(item, provider);

    // URL
    let url = this.getString(item, 'url', 'twitterUrl');
    if (!url) {
      url = authorHandle
        ? `https://x.com/${authorHandle}/status/${id}`
        : `https://x.com/i/web/status/${id}`;
    }

    // Date
    const rawDate =
      this.getString(item, 'createdAt', 'created_at', 'publishedAt', 'timestamp') ??
      item.createdAt ??
      item.created_at ??
      item.publishedAt ??
      item.timestamp;
    const publishedAt = this.toIsoString(rawDate);

    // Metrics
    const metrics = {
      replies: this.getNumber(item, 'replyCount', 'reply_count', 'replies'),
      retweets: this.getNumber(item, 'retweetCount', 'retweet_count', 'retweets'),
      likes: this.getNumber(
        item,
        'likeCount',
        'like_count',
        'favorite_count',
        'favoriteCount',
        'likes',
        'favorites',
      ),
      views: this.getNumber(
        item,
        'viewCount',
        'view_count',
        'views_count',
        'viewsCount',
        'views',
        'impression_count',
      ),
      bookmarks: this.getNumber(item, 'bookmarkCount', 'bookmark_count', 'bookmarks'),
    };

    // Media
    const media = this.extractMedia(item);

    // isRetweet
    const isRetweet =
      this.getBoolean(item, 'isRetweet', 'is_retweet', 'retweeted') ||
      isRecord(item.retweeted_status) ||
      isRecord(item.retweetedStatus) ||
      text.startsWith('RT @');

    // isPinned
    const isPinned = this.getBoolean(item, 'isPinned', 'is_pinned', 'pinned');

    // rawHtmlSnippet
    const rawHtmlSnippet = this.getString(item, 'rawHtmlSnippet', 'html', 'rawHtml');

    const result: ScrapedPost = {
      id,
      url,
      authorHandle,
      authorName,
      text,
      publishedAt,
      metrics,
      media,
      isRetweet,
      isPinned,
    };

    if (authorAvatarUrl) {
      result.authorAvatarUrl = authorAvatarUrl;
    }

    if (rawHtmlSnippet) {
      result.rawHtmlSnippet = rawHtmlSnippet;
    }

    return result;
  }

  private extractAuthorHandle(
    post: Record<string, unknown>,
    _provider: 'twitterapi_io' | 'apify',
  ): string {
    const authorObj = isRecord(post.author)
      ? post.author
      : isRecord(post.user)
        ? post.user
        : undefined;

    let handle: string | undefined = undefined;

    if (authorObj) {
      handle = this.getString(authorObj, 'userName', 'screen_name', 'username');
    }

    if (!handle) {
      handle = this.getString(post, 'userName', 'screen_name', 'username', 'authorHandle');
    }

    return handle ? handle.replace(/^@+/, '').trim() : '';
  }

  private extractAuthorName(
    post: Record<string, unknown>,
    _provider: 'twitterapi_io' | 'apify',
  ): string {
    const authorObj = isRecord(post.author)
      ? post.author
      : isRecord(post.user)
        ? post.user
        : undefined;

    let name: string | undefined = undefined;

    if (authorObj) {
      name = this.getString(authorObj, 'name');
    }

    if (!name) {
      name = this.getString(post, 'authorName', 'name');
    }

    return name ? name.trim() : '';
  }

  private extractAuthorAvatar(
    post: Record<string, unknown>,
    _provider: 'twitterapi_io' | 'apify',
  ): string | undefined {
    const authorObj = isRecord(post.author)
      ? post.author
      : isRecord(post.user)
        ? post.user
        : undefined;

    if (authorObj) {
      const avatar = this.getString(
        authorObj,
        'profilePicture',
        'profile_image_url_https',
        'profile_image_url',
        'avatar',
      );
      if (avatar) return avatar;
    }

    return this.getString(
      post,
      'authorAvatarUrl',
      'profilePicture',
      'profile_image_url_https',
      'profile_image_url',
      'avatar',
    );
  }

  private extractMedia(post: Record<string, unknown>): ScrapedPostMedia[] {
    const result: ScrapedPostMedia[] = [];
    const seenUrls = new Set<string>();

    const addMedia = (media: ScrapedPostMedia) => {
      if (media.url && !seenUrls.has(media.url)) {
        seenUrls.add(media.url);
        result.push(media);
      }
    };

    const processItem = (item: unknown) => {
      if (typeof item === 'string' && item.trim().length > 0) {
        const trimmed = item.trim();
        const type: 'photo' | 'video' | 'animated_gif' = trimmed.includes('.mp4') ? 'video' : 'photo';
        addMedia({ type, url: trimmed });
        return;
      }

      if (!isRecord(item)) {
        return;
      }

      const rawType = this.getString(item, 'type')?.toLowerCase() ?? '';
      let type: 'photo' | 'video' | 'animated_gif' = 'photo';
      if (rawType === 'video') {
        type = 'video';
      } else if (rawType === 'animated_gif' || rawType === 'gif') {
        type = 'animated_gif';
      }

      let url = this.getString(item, 'media_url_https', 'media_url', 'url', 'mediaUrl');
      let previewUrl = this.getString(item, 'preview_image_url', 'previewUrl');

      if (type === 'video' || type === 'animated_gif') {
        const videoInfo = isRecord(item.video_info)
          ? item.video_info
          : isRecord(item.videoInfo)
            ? item.videoInfo
            : undefined;

        if (videoInfo && Array.isArray(videoInfo.variants)) {
          let bestBitrate = -1;
          let bestVideoUrl: string | undefined = undefined;

          for (const variant of videoInfo.variants) {
            if (isRecord(variant) && typeof variant.url === 'string') {
              const bitrate = typeof variant.bitrate === 'number' ? variant.bitrate : 0;
              if (bitrate > bestBitrate || bestVideoUrl === undefined) {
                bestBitrate = bitrate;
                bestVideoUrl = variant.url;
              }
            }
          }

          if (bestVideoUrl) {
            if (url && !previewUrl) {
              previewUrl = url;
            }
            url = bestVideoUrl;
          }
        }
      }

      if (url) {
        addMedia({
          type,
          url,
          ...(previewUrl ? { previewUrl } : {}),
        });
      }
    };

    const candidates: unknown[] = [];

    if (Array.isArray(post.media)) {
      candidates.push(...post.media);
    }

    const entities = isRecord(post.entities) ? post.entities : undefined;
    if (entities && Array.isArray(entities.media)) {
      candidates.push(...entities.media);
    }

    const extendedEntities = isRecord(post.extendedEntities)
      ? post.extendedEntities
      : isRecord(post.extended_entities)
        ? post.extended_entities
        : undefined;

    if (extendedEntities && Array.isArray(extendedEntities.media)) {
      candidates.push(...extendedEntities.media);
    }

    for (const cand of candidates) {
      processItem(cand);
    }

    if (Array.isArray(post.imageUrls)) {
      for (const img of post.imageUrls) {
        if (typeof img === 'string' && img.trim().length > 0) {
          addMedia({ type: 'photo', url: img.trim() });
        }
      }
    }

    if (Array.isArray(post.videoUrls)) {
      for (const vid of post.videoUrls) {
        if (typeof vid === 'string' && vid.trim().length > 0) {
          addMedia({ type: 'video', url: vid.trim() });
        }
      }
    }

    if (Array.isArray(post.mediaUrls)) {
      for (const m of post.mediaUrls) {
        if (typeof m === 'string' && m.trim().length > 0) {
          const trimmed = m.trim();
          const type: 'photo' | 'video' | 'animated_gif' = trimmed.includes('.mp4') ? 'video' : 'photo';
          addMedia({ type, url: trimmed });
        }
      }
    }

    return result;
  }

  private toIsoString(rawDate: unknown): string {
    if (typeof rawDate === 'string' && rawDate.trim().length > 0) {
      const parsed = Date.parse(rawDate);
      if (!isNaN(parsed)) {
        return new Date(parsed).toISOString();
      }
    } else if (typeof rawDate === 'number' && !isNaN(rawDate)) {
      const ms = rawDate < 10000000000 ? rawDate * 1000 : rawDate;
      const d = new Date(ms);
      if (!isNaN(d.getTime())) {
        return d.toISOString();
      }
    }
    return new Date().toISOString();
  }

  private getString(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
    for (const key of keys) {
      const val = obj[key];
      if (typeof val === 'string' && val.trim().length > 0) {
        return val.trim();
      }
      if (typeof val === 'number' && !isNaN(val)) {
        return String(val);
      }
    }
    return undefined;
  }

  private getNumber(obj: Record<string, unknown>, ...keys: string[]): number {
    for (const key of keys) {
      const val = obj[key];
      if (typeof val === 'number' && !isNaN(val)) {
        return Math.max(0, val);
      }
      if (typeof val === 'string') {
        const parsed = Number(val);
        if (!isNaN(parsed)) {
          return Math.max(0, parsed);
        }
      }
    }
    return 0;
  }

  private getBoolean(obj: Record<string, unknown>, ...keys: string[]): boolean {
    for (const key of keys) {
      const val = obj[key];
      if (typeof val === 'boolean') {
        return val;
      }
      if (typeof val === 'string') {
        if (val.toLowerCase() === 'true') return true;
        if (val.toLowerCase() === 'false') return false;
      }
    }
    return false;
  }
}
