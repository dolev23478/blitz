import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service.js';
import { AppConfigModule } from '../config/index.js';

@Global()
@Module({
  imports: [AppConfigModule],
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
