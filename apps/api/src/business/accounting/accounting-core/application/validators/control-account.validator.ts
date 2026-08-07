import { BadRequestException } from '@nestjs/common';
import type { PostingLineCommand } from '../ports/accounting-posting.port.js';
import type { TxClient } from '../ports/accounting-posting.port.js';

export class ControlAccountValidator {
  static async validate(
    tx: TxClient,
    lines: PostingLineCommand[],
    postingOrigin: string,
  ): Promise<void> {
    if (postingOrigin === 'MANUAL') {
      for (const line of lines) {
        const version = await tx.accountVersion.findFirst({
          where: { accountId: line.accountId },
          orderBy: { effectiveFrom: 'desc' },
          select: { isControlAccount: true, controlPostingPolicy: true, name: true },
        });

        if (!version) continue;

        if (version.isControlAccount && version.controlPostingPolicy === 'SYSTEM_ONLY') {
          throw new BadRequestException(
            `Account "${version.name}" is a system-only control account and cannot receive manual postings`,
          );
        }
      }
    }
  }
}
