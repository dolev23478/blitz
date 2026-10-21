import { Global, Module } from '@nestjs/common';
import { FilteredPostsService } from './filtered-posts.service.js';
import { MessageEventsService } from './message-events.service.js';

@Global()
@Module({
  providers: [MessageEventsService, FilteredPostsService],
  exports: [MessageEventsService, FilteredPostsService],
})
export class EventsModule {}
