import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { TransformerModule } from './modules/transformer/transformer.module.js';

@Module({
  imports: [TransformerModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
