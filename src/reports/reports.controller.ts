import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ZodPipe } from '../common/zod.pipe.js';
import { messageQuerySchema, type MessageQueryDto } from '../messages/messages.dto.js';
import { ReportsService, type ReportPage } from './reports.service.js';

/** Collected messages in the RAW_REPORT contract shape. Same filters/paging as /api/messages. */
@Controller('api/reports')
export class ReportsController {
  constructor(@Inject(ReportsService) private readonly reports: ReportsService) {}

  @Get()
  list(@Query(new ZodPipe(messageQuerySchema)) query: MessageQueryDto): Promise<ReportPage> {
    return this.reports.list(query);
  }
}
