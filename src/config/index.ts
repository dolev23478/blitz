import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_CONFIG, CONFIG_KEYS, loadConfig, type AppConfig } from './app-config.js';

export { APP_CONFIG, loadConfig, type AppConfig } from './app-config.js';

/** Loads `.env`, validates it with zod (fails fast on bad values) and exposes the typed result as `APP_CONFIG`. */
@Global()
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, validate: (env) => loadConfig(env) })],
  providers: [
    {
      provide: APP_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Record<string, unknown>>): AppConfig =>
        Object.fromEntries(CONFIG_KEYS.map((key) => [key, config.get(key)])) as AppConfig,
    },
  ],
  exports: [APP_CONFIG],
})
export class AppConfigModule {}
