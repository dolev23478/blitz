import { Injectable } from '@nestjs/common';
import type { FilteredPost, FilteredPostEvent } from '../types.js';

@Injectable()
export class FilteredPostsService {
  private readonly posts: FilteredPost[] = [];
  private readonly listeners = new Set<(event: FilteredPostEvent) => void>();

  subscribe(listener: (event: FilteredPostEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  push(post: FilteredPost): FilteredPost {
    this.posts.unshift(post);
    this.posts.splice(200);

    const event: FilteredPostEvent = {
      type: 'filtered-post',
      payload: post,
    };

    for (const listener of [...this.listeners]) {
      listener(event);
    }

    return post;
  }

  getRecent(limit = 100): FilteredPost[] {
    return [...this.posts].slice(0, limit);
  }
}
