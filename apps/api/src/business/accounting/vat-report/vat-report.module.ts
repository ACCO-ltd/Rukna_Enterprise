import { Module } from '@nestjs/common';

import { VatReportController } from './presentation/vat-report.controller.js';
import { VatReportService } from './application/vat-report.service.js';
import { VatReportRepository } from './infrastructure/vat-report.repository.js';

// Step 6 — the VAT report. TenancyModule is @Global.
@Module({
  controllers: [VatReportController],
  providers: [VatReportService, VatReportRepository],
  // The close checklist shows the month's VAT.
  exports: [VatReportService],
})
export class VatReportModule {}
