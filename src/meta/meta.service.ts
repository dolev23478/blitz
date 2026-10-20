import { Injectable } from '@nestjs/common';

@Injectable()
export class MetaService {
  health(): { status: 'ok'; uptimeSeconds: number } {
    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()) };
  }
}
