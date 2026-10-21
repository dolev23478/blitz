import { Module } from '@nestjs/common';
import { RadioModule } from './radio.module.js';
import { TransformerModule } from '../transformer/transformer.module.js';
import { RadioTransformerHandoff } from './radio-transformer.service.js';
export { RadioTransformerHandoff } from './radio-transformer.service.js';

@Module({
  imports: [RadioModule, TransformerModule],
  providers: [RadioTransformerHandoff],
  exports: [RadioModule, RadioTransformerHandoff],
})
export class RadioTransformerModule {}
