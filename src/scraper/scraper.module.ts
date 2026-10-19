import { Module } from '@nestjs/common';
import { HttpClientService } from './http-client.service.js';
import { ScraperService } from './scraper.service.js';

@Module({ providers: [HttpClientService, ScraperService], exports: [ScraperService] })
export class ScraperModule {}
