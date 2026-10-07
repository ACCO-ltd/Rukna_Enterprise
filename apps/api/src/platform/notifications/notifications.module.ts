import { Module } from '@nestjs/common';

import { NotificationsController } from './presentation/notifications.controller.js';
import { NotificationsService } from './application/notifications.service.js';
import { NotificationGeneratorService } from './application/notification-generator.service.js';
import { NotificationRecipientService } from './application/notification-recipient.service.js';
import { StagePaymentSource } from './application/notification-sources/stage-payment.source.js';
import { ClientInvoiceOverdueSource } from './application/notification-sources/client-invoice-overdue.source.js';
import { NotificationPrismaRepository } from './infrastructure/notification-prisma.repository.js';
import { NotificationWriter } from './application/notification-writer.service.js';

/**
 * ADR-031 — in-app notification center. Read/mark endpoints (authenticated, self-scoped) plus the
 * daily generator (ships dark behind NOTIFICATIONS_GENERATION_ENABLED). `ScheduleModule.forRoot()` is
 * registered once in AppModule so the @Cron in the generator is discovered.
 */
@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationGeneratorService,
    NotificationRecipientService,
    StagePaymentSource,
    ClientInvoiceOverdueSource,
    NotificationWriter,
    { provide: 'INotificationRepository', useClass: NotificationPrismaRepository },
  ],
  // NotificationWriter (ADR-044 §10): event-driven rows written in the caller's transaction.
  exports: [NotificationsService, NotificationGeneratorService, NotificationWriter],
})
export class NotificationsModule {}
