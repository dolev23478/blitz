import { Module } from '@nestjs/common';
import { MessagesModule } from '../messages/messages.module.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

@Module({ imports: [MessagesModule], controllers: [ReportsController], providers: [ReportsService] })
export class ReportsModule {}
