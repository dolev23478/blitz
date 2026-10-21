import { Module } from '@nestjs/common';
import { AnalyticsModule } from './analytics/analytics.module.js';
import { PostsModule } from './posts/posts.module.js';

@Module({
  imports: [PostsModule, AnalyticsModule],
})
export class AppModule {}
