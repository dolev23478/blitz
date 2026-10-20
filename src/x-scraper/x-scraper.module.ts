import { Module } from '@nestjs/common';
import { XScraperService } from './x-scraper.service.js';
import { TwitterApiIoProvider } from './providers/twitterapi-io.provider.js';
import { ApifyXProvider } from './providers/apify-x.provider.js';
import { ManagedApiNormalizer } from './parsers/managed-api.normalizer.js';
import { JsonExporter } from './exporters/json.exporter.js';
import { HtmlExporter } from './exporters/html.exporter.js';

@Module({
  providers: [
    XScraperService,
    TwitterApiIoProvider,
    ApifyXProvider,
    ManagedApiNormalizer,
    JsonExporter,
    HtmlExporter,
  ],
  exports: [XScraperService],
})
export class XScraperModule {}

export default XScraperModule;
