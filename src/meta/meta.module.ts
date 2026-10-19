import { Module } from '@nestjs/common';
import { StorageModule } from '../database/storage.module.js';
import { MetaController } from './meta.controller.js';
import { MetaService } from './meta.service.js';

@Module({ imports: [StorageModule], controllers: [MetaController], providers: [MetaService] })
export class MetaModule {}
