import { Controller, Get, Sse } from '@nestjs/common';
import { Observable, interval, map } from 'rxjs';
import type { FilteredPost, FilteredPostSseEvent } from '@blitz/shared';
import { PostsService } from './posts.service';

@Controller('posts')
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  @Get()
  list(): FilteredPost[] {
    return this.postsService.getRecentPosts();
  }

  @Sse('stream')
  stream(): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      const unsubscribe = this.postsService.subscribe((event: FilteredPostSseEvent) => {
        subscriber.next({
          data: JSON.stringify(event),
        } as MessageEvent);
      });

      const immediate = this.postsService.getRecentPosts();
      if (immediate.length) {
        subscriber.next({
          data: JSON.stringify({
            type: 'filtered-post',
            payload: immediate[0],
          }),
        } as MessageEvent);
      }

      const timer = interval(5000).subscribe(() => {
        const post = this.postsService.createDemoStreamPost();
        subscriber.next({
          data: JSON.stringify({
            type: 'filtered-post',
            payload: post,
          }),
        } as MessageEvent);
      });

      return () => {
        unsubscribe();
        timer.unsubscribe();
      };
    });
  }
}
