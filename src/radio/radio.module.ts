import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/index.js';
import { LocalRadioWorker } from './local-radio.worker.js';
import { RadioService } from './radio.service.js';

/** Local collection only. No Transformer, Kafka, Redis or event-bus dependencies. */
@Module({
  imports: [AppConfigModule],
  providers: [LocalRadioWorker, RadioService],
  exports: [RadioService],
})
export class RadioModule {}
