import { Injectable } from '@nestjs/common';
import { buildDemoPost, type FilteredPost, type FilteredPostSseEvent } from '@blitz/shared';

@Injectable()
export class PostsService {
  private readonly posts: FilteredPost[] = [
    buildDemoPost({
      id: 'seed-1',
      channel: 'live-monitor',
      text: 'A group is preparing explosives and intends to attack before midnight.',
      createdAt: new Date(Date.now() - 60_000).toISOString(),
      severity: 'high',
      matches: [
        { term: 'explosives', normalized: 'explosives', start: 25, end: 35, category: 'weapon' },
        { term: 'attack', normalized: 'attack', start: 52, end: 58, category: 'violence' },
      ],
    }),
    buildDemoPost({
      id: 'seed-2',
      channel: 'watchlist',
      text: 'The drone team is moving near the checkpoint.',
      createdAt: new Date(Date.now() - 180_000).toISOString(),
      severity: 'medium',
      matches: [
        { term: 'drone', normalized: 'drone', start: 10, end: 15, category: 'weapon' },
        { term: 'checkpoint', normalized: 'checkpoint', start: 38, end: 48, category: 'threat' },
      ],
    }),
  ];

  private readonly listeners = new Set<(event: FilteredPostSseEvent) => void>();

  subscribe(listener: (event: FilteredPostSseEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getRecentPosts(): FilteredPost[] {
    return [...this.posts].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  }

  pushPost(post: FilteredPost): FilteredPost {
    this.posts.unshift(post);
    this.posts.splice(100);

    const event: FilteredPostSseEvent = {
      type: 'filtered-post',
      payload: post,
    };

    for (const listener of [...this.listeners]) {
      listener(event);
    }

    return post;
  }

  createDemoStreamPost(): FilteredPost {
    const now = new Date();
    const post = buildDemoPost({
      id: `live-${now.getTime()}`,
      channel: 'stream-demo',
      text: 'We need a weapon and a strong team before the convoy arrives at dawn.',
      createdAt: now.toISOString(),
      severity: 'high',
      matches: [
        { term: 'weapon', normalized: 'weapon', start: 12, end: 18, category: 'weapon' },
        { term: 'convoy', normalized: 'convoy', start: 50, end: 56, category: 'threat' },
      ],
    });

    return this.pushPost(post);
  }
}
