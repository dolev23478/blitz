import { Module } from '@nestjs/common';
import { AnalyticsModule } from './analytics/analytics.module';
import { PostsModule } from './posts/posts.module';

@Module({
  imports: [PostsModule, AnalyticsModule],
})
export class AppModule {}
