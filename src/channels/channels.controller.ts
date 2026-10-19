import {
  Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ZodPipe } from '../common/zod.pipe.js';
import {
  addChannelSchema, backfillSchema, setActiveSchema,
  type AddChannelDto, type BackfillDto, type SetActiveDto,
} from './channels.dto.js';
import { ChannelsService, type ChannelView } from './channels.service.js';

@Controller('api/channels')
export class ChannelsController {
  constructor(@Inject(ChannelsService) private readonly channels: ChannelsService) {}

  @Get()
  list(): Promise<ChannelView[]> {
    return this.channels.list();
  }

  @Post()
  async add(
    @Body(new ZodPipe(addChannelSchema, 'Invalid channel username or link')) body: AddChannelDto,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<ChannelView> {
    const channel = await this.channels.add(body.username);
    res.status(201).header('location', `/api/channels/${channel.id}`);
    return channel;
  }

  @Get(':ref')
  get(@Param('ref') ref: string): Promise<ChannelView> {
    return this.channels.get(ref);
  }

  @Patch(':ref')
  setActive(
    @Param('ref') ref: string,
    @Body(new ZodPipe(setActiveSchema, 'Body must be { "active": boolean }')) body: SetActiveDto,
  ): Promise<ChannelView> {
    return this.channels.setActive(ref, body.active);
  }

  @Delete(':ref')
  @HttpCode(204)
  remove(@Param('ref') ref: string): Promise<void> {
    return this.channels.remove(ref);
  }

  @Post(':ref/backfill')
  @HttpCode(202)
  async backfill(
    @Param('ref') ref: string,
    @Body(new ZodPipe(backfillSchema.default({}), 'Body must be { "days"?: number }')) body: BackfillDto,
  ): Promise<{ started: true }> {
    await this.channels.backfill(ref, body.days);
    return { started: true };
  }
}
