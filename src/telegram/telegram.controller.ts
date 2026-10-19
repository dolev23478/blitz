import { Controller, Get, Inject } from '@nestjs/common';
import { TelegramService, type TelegramStatus } from './telegram.service.js';

@Controller('api/telegram')
export class TelegramController {
  constructor(@Inject(TelegramService) private readonly telegram: TelegramService) {}

  /** Read-only status of the Telegram account connection (login is headless via TG_SESSION_STRING). */
  @Get()
  status(): TelegramStatus {
    return this.telegram.status();
  }
}
