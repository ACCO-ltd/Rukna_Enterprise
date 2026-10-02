import { Controller, ForbiddenException, Get, HttpCode, Post, Query, Req, Res, UnauthorizedException } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { Public } from '../../../common/decorators/public.decorator.js';
import { WhatsAppWebhookService } from './whatsapp-webhook.service.js';

/**
 * ADR-042 — `https://api.rukna.site/api/v1/webhooks/whatsapp`, the Callback URL entered in the
 * Meta app's WhatsApp → Configuration. Public (Meta has no Rukna login); trust comes from the
 * verify token on the handshake and the app-secret signature on every notification.
 */
@ApiExcludeController()
@Public()
@Controller('webhooks/whatsapp')
export class WhatsAppWebhookController {
  constructor(private readonly webhook: WhatsAppWebhookService) {}

  /** Meta's verification handshake: answers with `hub.challenge` as plain text. */
  @Get()
  verify(
    @Query('hub.mode') mode: unknown,
    @Query('hub.verify_token') token: unknown,
    @Query('hub.challenge') challenge: unknown,
    @Res() res: Response,
  ): void {
    const answer = this.webhook.verifyHandshake(mode, token, challenge);
    if (answer === null) throw new ForbiddenException('Webhook verification failed');
    res.status(200).type('text/plain').send(answer);
  }

  /** Signed notifications (message status updates). Acknowledged fast with 200; Meta retries otherwise. */
  @Post()
  @HttpCode(200)
  receive(@Req() req: Request & { rawBody?: Buffer }): { received: true } {
    if (!this.webhook.isSignatureValid(req.rawBody, req.header('x-hub-signature-256'))) {
      throw new UnauthorizedException('Invalid webhook signature');
    }
    this.webhook.handleNotification(req.body);
    return { received: true };
  }
}
