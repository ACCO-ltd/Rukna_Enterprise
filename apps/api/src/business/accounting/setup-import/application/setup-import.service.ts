import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Decimal } from '@prisma/client/runtime/library';
import {
  PERMISSIONS,
  type RequestIdentity,
  type SetupImportCheck,
  type SetupImportKind,
  type SetupImportProblem,
  type SetupImportRequest,
  type SetupImportResult,
  type SetupImportRowResult,
} from '@erp/types';

import { ClientService } from '../../../../platform/clients/application/client.service.js';
import { TransactionalAuditOutboxService } from '../../../../platform/audit-logs/application/transactional-audit-outbox.service.js';
import { SupplierService } from '../../accounts-payable/application/supplier.service.js';
import {
  findLikelyDuplicate,
  MAX_IMPORT_ROWS,
  nameKey,
  readRow,
  taxKey,
  type ExistingParty,
  type ReadRow,
} from '../domain/import-rules.js';
import { SetupImportRepository } from '../infrastructure/setup-import.repository.js';

interface Evaluated {
  result: SetupImportRowResult;
  read: ReadRow;
}

/** Problems a merged row can still have: it only carries a balance to an existing record. */
const MERGE_FIELDS = new Set(['openingBalance', null]);

/**
 * Step 5 (ADR-047) — suppliers or clients from a spreadsheet, with what each owes or is owed on
 * the opening date.
 *
 * `check` reads every row by the rules in `import-rules.ts` and says, before anything is saved,
 * what the import would do. `import` runs the same check again and, in one transaction, creates
 * the records through their owning services (so each is audited like one added by hand) and
 * records each balance as an open item in OPENING_BALANCE status — the same shape the opening
 * balance wizard uses. The GL side is the trial balance: the opening AR and AP control balances it
 * posts tie out against these items. That is why balances close once the opening journal is
 * posted — an open item added after it would sit in the subledger with nothing in the ledger.
 */
@Injectable()
export class SetupImportService {
  constructor(
    private readonly repo: SetupImportRepository,
    private readonly suppliers: SupplierService,
    private readonly clients: ClientService,
    private readonly auditOutbox: TransactionalAuditOutboxService,
  ) {}

  async check(identity: RequestIdentity, kind: SetupImportKind, request: SetupImportRequest): Promise<SetupImportCheck> {
    this.assertMayImport(identity, kind);
    this.assertRequest(request);
    const { evaluated, openingBalancesOpen } = await this.evaluate(identity, kind, request);
    return { kind, rows: evaluated.map((e) => e.result), summary: summarise(evaluated), openingBalancesOpen };
  }

  async import(identity: RequestIdentity, kind: SetupImportKind, request: SetupImportRequest): Promise<SetupImportResult> {
    this.assertMayImport(identity, kind);
    this.assertRequest(request);
    const { evaluated } = await this.evaluate(identity, kind, request);

    const withErrors = evaluated.filter((e) => e.result.status === 'ERROR').length;
    if (withErrors > 0 && !request.skipRowsWithErrors) {
      throw new BadRequestException({
        errorCode: 'IMPORT_HAS_ERRORS',
        message: `${withErrors} row(s) still have errors. Fix them, or choose to skip them.`,
        details: { withErrors },
      });
    }
    const importable = evaluated.filter((e) => e.result.status === 'READY' || e.result.status === 'WARNING');
    if (importable.length === 0) {
      throw new BadRequestException({ errorCode: 'NOTHING_TO_IMPORT', message: 'There are no rows to import.' });
    }

    const orgId = identity.activeOrganizationId;
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const batch = `${stamp}-${randomBytes(3).toString('hex').toUpperCase()}`;
    const batchReference = `IMPORT-${kind === 'suppliers' ? 'SUP' : 'CLI'}-${batch}`;
    const openingDate = request.openingDate ? new Date(`${request.openingDate}T00:00:00.000Z`) : null;

    return this.repo.db().$transaction(
      async (tx) => {
        let nextNumber = kind === 'suppliers' ? await this.repo.highestSupplierNumber(tx, orgId) : 0;
        let created = 0;
        let merged = 0;
        let openingItems = 0;
        let openingTotal = new Decimal(0);

        for (const { result, read } of importable) {
          let party: { id: string; code: string; termsDays: number };
          if (result.action === 'MERGE') {
            party = { id: result.duplicateOf!.id, code: result.duplicateOf!.code, termsDays: read.paymentTermsDays ?? 0 };
            merged++;
          } else if (kind === 'suppliers') {
            const code = read.code ?? `SUP-${String(++nextNumber).padStart(6, '0')}`;
            const supplier = await this.suppliers.createInTransaction(
              tx,
              identity,
              {
                code,
                name: read.name!,
                ...(read.taxNumber ? { taxNumber: read.taxNumber } : {}),
                ...(read.currency ? { defaultCurrency: read.currency } : {}),
                ...(read.paymentTermsDays !== null ? { paymentTermsDays: read.paymentTermsDays } : {}),
                ...(read.address ? { address: read.address } : {}),
              },
              read.contactName || read.phone || read.email
                ? { name: read.contactName ?? read.name!, phone: read.phone, email: read.email }
                : null,
            );
            party = { ...supplier, termsDays: read.paymentTermsDays ?? 0 };
            created++;
          } else {
            const client = await this.clients.createInTransaction(
              tx,
              identity,
              {
                name: read.name!,
                type: read.clientType ?? 'COMPANY',
                taxNumber: read.taxNumber,
                paymentTermsDays: read.paymentTermsDays,
                countryCode: read.countryCode ?? request.defaultCountry.toUpperCase(),
                city: read.city,
                address: read.address,
                invoiceEmail: read.email,
                defaultCurrency: read.currency ?? 'USD',
              },
              { name: read.contactName!, role: null, phone: read.phone!, whatsappPhone: null, email: read.email },
            );
            party = { ...client, termsDays: read.paymentTermsDays ?? 0 };
            created++;
          }

          if (read.openingBalance && openingDate) {
            const item = {
              organizationId: orgId,
              partyId: party.id,
              openingDate,
              termsDays: party.termsDays,
              amount: read.openingBalance,
              batchReference,
              createdBy: identity.userId,
            };
            const reference = `OPENING-${batch}-${party.code}`;
            if (kind === 'suppliers') await this.repo.createOpeningBill(tx, item, reference);
            else await this.repo.createOpeningInvoice(tx, item, reference);
            openingItems++;
            openingTotal = openingTotal.plus(read.openingBalance);
          }
        }

        const skipped = evaluated.length - importable.length;
        await this.auditOutbox.record(tx, {
          organizationId: orgId,
          actorUserId: identity.userId,
          action: 'CREATE',
          resourceType: 'SetupImport',
          resourceId: batchReference,
          sourceCommand: `setup-import.${kind}`,
          eventType: 'SETUP_IMPORT_COMPLETED',
          idempotencyKey: `setup-import-${batchReference}`,
          after: { kind, created, merged, skipped, openingItems, openingBalanceTotal: openingTotal.toFixed(2) },
        });

        return { kind, created, merged, skipped, openingItems, openingBalanceTotal: openingTotal.toFixed(2), batchReference };
      },
      { timeout: 120_000 },
    );
  }

  // ── The check ────────────────────────────────────────────────────────────────

  private async evaluate(identity: RequestIdentity, kind: SetupImportKind, request: SetupImportRequest) {
    const orgId = identity.activeOrganizationId;
    const [existing, journalPosted] = await Promise.all([
      kind === 'suppliers' ? this.suppliers.listForImport(identity) : this.clients.listForImport(identity),
      this.repo.openingJournalPosted(this.repo.db(), orgId),
    ]);
    const openingBalancesOpen = !journalPosted;
    const mayPostBalances = can(identity, PERMISSIONS.accountingManage);
    const byId = new Map<string, ExistingParty>(existing.map((e) => [e.id, e]));
    const existingCodes = new Set(existing.map((e) => e.code.toUpperCase()));
    const defaultCountry = request.defaultCountry.toUpperCase();

    // Earlier rows of the file, so a repeat is named by the row it repeats.
    const seenName = new Map<string, number>();
    const seenTax = new Map<string, number>();
    const seenCode = new Map<string, number>();

    const evaluated: Evaluated[] = request.rows.map((row, index) => {
      const action = row.action ?? 'CREATE';
      const read = readRow(kind, row, defaultCountry);
      if (action === 'SKIP') {
        return { read, result: { index, status: 'SKIPPED', action, problems: [], duplicateOf: null, openingBalance: read.openingBalance?.toFixed(2) ?? null } };
      }

      let problems: SetupImportProblem[] = [...read.problems];
      let duplicateOf = findLikelyDuplicate(read, existing);

      if (action === 'MERGE') {
        const target = row.mergeIntoId ? byId.get(row.mergeIntoId) : undefined;
        problems = problems.filter((p) => MERGE_FIELDS.has(p.field));
        if (!target) {
          problems.push({ field: null, code: 'MERGE_TARGET_INVALID', severity: 'ERROR', message: 'Choose the existing record to merge this row into' });
        } else {
          duplicateOf = target;
        }
      } else {
        if (duplicateOf) {
          problems.push({
            field: null,
            code: 'LIKELY_DUPLICATE',
            severity: 'WARNING',
            message: `Looks like ${duplicateOf.name} (${duplicateOf.code}), already here — merge into it, or import it as a new record`,
          });
        }
        const taxRepeat = read.taxNumber ? seenTax.get(taxKey(read.taxNumber)) : undefined;
        const repeat = taxRepeat ?? (read.name ? seenName.get(nameKey(read.name)) : undefined);
        if (repeat !== undefined) {
          problems.push({ field: null, code: 'DUPLICATE_IN_FILE', severity: 'WARNING', message: `The same as row ${repeat + 1} of this file`, relatedIndex: repeat });
        }
        if (read.code) {
          const codeKey = read.code.toUpperCase();
          const usedBy = seenCode.get(codeKey);
          if (existingCodes.has(codeKey)) {
            problems.push({ field: 'code', code: 'CODE_TAKEN', severity: 'ERROR', message: `Code ${read.code} is already used by another supplier` });
          } else if (usedBy !== undefined) {
            problems.push({ field: 'code', code: 'CODE_TAKEN', severity: 'ERROR', message: `Code ${read.code} is also used by row ${usedBy + 1}`, relatedIndex: usedBy });
          } else {
            seenCode.set(codeKey, index);
          }
        }
        if (read.name && !seenName.has(nameKey(read.name))) seenName.set(nameKey(read.name), index);
        if (read.taxNumber && !seenTax.has(taxKey(read.taxNumber))) seenTax.set(taxKey(read.taxNumber), index);
      }

      if (read.openingBalance) {
        if (!openingBalancesOpen) {
          problems.push({
            field: 'openingBalance',
            code: 'OPENING_BALANCES_CLOSED',
            severity: 'ERROR',
            message: 'The opening balance journal is already posted — record this balance with a journal instead',
          });
        } else if (!mayPostBalances) {
          problems.push({
            field: 'openingBalance',
            code: 'OPENING_BALANCES_FORBIDDEN',
            severity: 'ERROR',
            message: 'Opening balances are recorded by someone who can manage accounting',
          });
        }
      }

      const status = problems.some((p) => p.severity === 'ERROR') ? 'ERROR' : problems.length > 0 ? 'WARNING' : 'READY';
      return {
        read,
        result: {
          index,
          status,
          action,
          problems,
          duplicateOf: duplicateOf ? { id: duplicateOf.id, code: duplicateOf.code, name: duplicateOf.name } : null,
          openingBalance: read.openingBalance?.toFixed(2) ?? null,
        },
      };
    });

    const needsDate = evaluated.some((e) => e.result.status !== 'SKIPPED' && e.read.openingBalance);
    if (needsDate && !request.openingDate) {
      throw new BadRequestException({
        errorCode: 'OPENING_DATE_REQUIRED',
        message: 'Choose the date the opening balances are owed as of.',
        details: { field: 'openingDate' },
      });
    }
    return { evaluated, openingBalancesOpen };
  }

  private assertMayImport(identity: RequestIdentity, kind: SetupImportKind): void {
    const allowed = kind === 'suppliers'
      ? can(identity, PERMISSIONS.payablesManage)
      : can(identity, PERMISSIONS.clientsCreate) || can(identity, PERMISSIONS.receivablesManage);
    if (!allowed) {
      throw new ForbiddenException({
        errorCode: 'FORBIDDEN',
        message: kind === 'suppliers' ? 'Importing suppliers needs Manage payables.' : 'Importing clients needs Create clients or Manage receivables.',
      });
    }
  }

  private assertRequest(request: SetupImportRequest): void {
    if (request.rows.length === 0) {
      throw new BadRequestException({ errorCode: 'NOTHING_TO_IMPORT', message: 'The file has no rows.' });
    }
    if (request.rows.length > MAX_IMPORT_ROWS) {
      throw new BadRequestException({ errorCode: 'TOO_MANY_ROWS', message: `Import at most ${MAX_IMPORT_ROWS} rows at a time.` });
    }
  }
}

function can(identity: RequestIdentity, permission: string): boolean {
  return identity.permissions.includes('*') || identity.permissions.includes(permission);
}

function summarise(evaluated: Evaluated[]): SetupImportCheck['summary'] {
  let openingTotal = new Decimal(0);
  let openingItems = 0;
  const count = (test: (e: Evaluated) => boolean) => evaluated.filter(test).length;
  const importable = (e: Evaluated) => e.result.status === 'READY' || e.result.status === 'WARNING';
  for (const e of evaluated) {
    if (importable(e) && e.read.openingBalance) {
      openingTotal = openingTotal.plus(e.read.openingBalance);
      openingItems++;
    }
  }
  return {
    total: evaluated.length,
    toCreate: count((e) => importable(e) && e.result.action === 'CREATE'),
    toMerge: count((e) => importable(e) && e.result.action === 'MERGE'),
    skipped: count((e) => e.result.status === 'SKIPPED'),
    withErrors: count((e) => e.result.status === 'ERROR'),
    withWarnings: count((e) => e.result.status === 'WARNING'),
    openingBalanceTotal: openingTotal.toFixed(2),
    openingItems,
  };
}
