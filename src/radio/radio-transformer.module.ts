import {
  Injectable,
  Inject,
  Module,
  type OnModuleInit,
  type OnModuleDestroy,
} from '@nestjs/common';
import { RadioModule } from './radio.module.js';
import { RadioService } from './radio.service.js';
import { TransformerModule } from '../transformer/transformer.module.js';
import { TransformerWorkflow } from '../transformer/transformer.workflow.js';

/** Used by the full application; isolated radio diagnostics import only RadioModule. */
@Injectable()
export class RadioTransformerHandoff implements OnModuleInit, OnModuleDestroy {
  private unsubscribe?: () => void;
  constructor(
    @Inject(RadioService) private readonly radio: RadioService,
    @Inject(TransformerWorkflow)
    private readonly transformer: TransformerWorkflow,
  ) {}

  onModuleInit(): void {
    this.unsubscribe = this.radio.watchTranscripts(async (clip) => {
      await this.transformer.run('RadioTranscript', clip, {
        inputId: clip.clipId,
        source: 'radio',
      });
    });
  }
  onModuleDestroy(): void {
    this.unsubscribe?.();
  }
}

@Module({
  imports: [RadioModule, TransformerModule],
  providers: [RadioTransformerHandoff],
})
export class RadioTransformerModule {}
