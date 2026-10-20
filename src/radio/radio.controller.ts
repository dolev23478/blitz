import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  StreamableFile,
} from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { RadioService } from './radio.service.js';

/** Uses the existing application API-key guard; no public annotation. */
@Controller('api/radio/clips')
export class RadioController {
  constructor(@Inject(RadioService) private readonly radio: RadioService) {}

  @Get()
  list() {
    return this.radio.listClips();
  }

  @Get(':id')
  async clip(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    try {
      return await this.radio.readClip(id);
    } catch {
      throw new NotFoundException('Radio clip not found.');
    }
  }

  @Get(':id/audio')
  async audio(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    const path = this.radio.audioPath(id);
    try {
      const file = await stat(path);
      if (!file.isFile()) throw new Error('Not an audio file.');
      return new StreamableFile(createReadStream(path), {
        type: 'audio/wav',
        length: file.size,
      });
    } catch {
      throw new NotFoundException('Radio audio not found.');
    }
  }
}
