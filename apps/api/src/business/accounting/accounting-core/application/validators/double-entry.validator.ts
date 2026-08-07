import { BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import type { PostingLineCommand } from '../ports/accounting-posting.port.js';

export class DoubleEntryValidator {
  static validate(lines: PostingLineCommand[]): void {
    if (lines.length < 2) {
      throw new BadRequestException('A journal entry requires at least 2 lines');
    }

    let totalDebit = new Decimal(0);
    let totalCredit = new Decimal(0);

    for (const line of lines) {
      const debit = line.debitAmount ?? new Decimal(0);
      const credit = line.creditAmount ?? new Decimal(0);

      if (debit.lte(0) && credit.lte(0)) {
        throw new BadRequestException(
          `Journal line for account ${line.accountId} has no debit or credit amount`,
        );
      }
      if (debit.gt(0) && credit.gt(0)) {
        throw new BadRequestException(
          `Journal line for account ${line.accountId} cannot have both a debit and a credit amount`,
        );
      }

      totalDebit = totalDebit.plus(debit);
      totalCredit = totalCredit.plus(credit);
    }

    if (!totalDebit.eq(totalCredit)) {
      throw new BadRequestException(
        `Journal is out of balance: debits ${totalDebit.toFixed(2)} ≠ credits ${totalCredit.toFixed(2)}`,
      );
    }
  }
}
