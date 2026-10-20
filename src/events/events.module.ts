import { Global, Module } from '@nestjs/common';
import { MessageEventsService } from './message-events.service.js';

@Global()
@Module({ providers: [MessageEventsService], exports: [MessageEventsService] })
export class EventsModule {}
