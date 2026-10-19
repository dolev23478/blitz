import { Controller, Get, Inject } from '@nestjs/common';
import { Public } from '../common/api-key.guard.js';
import { MetaService } from './meta.service.js';

@Controller('api')
export class MetaController {
  constructor(@Inject(MetaService) private readonly meta: MetaService) {}

  @Public()
  @Get('health')
  health() {
    return this.meta.health();
  }

  @Get('stats')
  stats() {
    return this.meta.stats();
  }
}
