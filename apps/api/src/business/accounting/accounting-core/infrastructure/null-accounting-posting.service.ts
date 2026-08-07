import { Injectable } from '@nestjs/common';
import type {
  IAccountingPostingPort,
  PostingCommand,
  PostingResult,
  TxClient,
} from '../application/ports/accounting-posting.port.js';

/**
 * Phase 1 placeholder. Replaced by AccountingPostingService in Phase 2.
 * Throws on any call so accidental wiring is caught immediately at runtime.
 */
@Injectable()
export class NullAccountingPostingService implements IAccountingPostingPort {
  async post(_command: PostingCommand, _tx: TxClient): Promise<PostingResult> {
    throw new Error(
      'AccountingPostingPort not implemented — posting engine is built in Phase 2',
    );
  }
}
