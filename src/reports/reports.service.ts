import { Inject, Injectable } from '@nestjs/common';
import { MessagesService } from '../messages/messages.service.js';
import type { MessageQueryDto } from '../messages/messages.dto.js';
import { toRawReport, type RawReport } from './raw-report.mapper.js';

export interface ReportPage {
  items: RawReport[];
  /** Messages skipped because they violate the contract (no content); these belong in reports.dlq. */
  rejected: { reportUrl: string; reason: string }[];
  nextCursor: string | null;
  lastId: number | null;
  hasMore: boolean;
}

@Injectable()
export class ReportsService {
  constructor(@Inject(MessagesService) private readonly messages: MessagesService) {}

  async list(query: MessageQueryDto): Promise<ReportPage> {
    const page = await this.messages.list(query);
    const items: RawReport[] = [];
    const rejected: ReportPage['rejected'] = [];
    for (const m of page.items) {
      const r = toRawReport(m);
      if (r.ok) items.push(r.report);
      else rejected.push({ reportUrl: r.reportUrl, reason: r.reason });
    }
    return { items, rejected, nextCursor: page.nextCursor, lastId: page.lastId, hasMore: page.hasMore };
  }
}
