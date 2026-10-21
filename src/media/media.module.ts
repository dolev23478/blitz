import { Global, Module } from '@nestjs/common';
import { AppConfigModule } from '../config/index.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { createMediaStore, MEDIA_STORE } from './media-store.js';
import { MediaStorageService } from './media-storage.service.js';

@Global()
@Module({
  imports: [AppConfigModule],
  providers: [
    { provide: MEDIA_STORE, inject: [APP_CONFIG], useFactory: (config: AppConfig) => createMediaStore(config) },
    MediaStorageService,
  ],
  exports: [MediaStorageService],
})
export class MediaModule {}
