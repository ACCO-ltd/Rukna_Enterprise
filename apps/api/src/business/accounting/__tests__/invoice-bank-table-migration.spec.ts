/**
 * Migration 20261008120000_invoice_bank_table carries existing invoice settings over: the linked
 * accounting bank account becomes the first "Bank Account Details" row and the linked user's name
 * becomes the signatory name (the title is kept). Run against a throwaway schema holding the
 * pre-migration shape, inside a transaction that is rolled back — nothing reaches the real tables.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const MIGRATION = join(
  __dirname,
  '../../../../prisma/migrations/20261008120000_invoice_bank_table/migration.sql',
);

/** The migration's statements (comments dropped), to run one by one in the scratch schema. */
function statements(): string[] {
  return readFileSync(MIGRATION, 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

class Rollback extends Error {}

afterAll(async () => {
  await prisma.$disconnect();
});

describe('migration 20261008120000_invoice_bank_table — data carry-over', () => {
  it('turns the linked bank account and signatory user into typed values, then drops the links', async () => {
    let result: unknown[] = [];
    let columns: string[] = [];
    await prisma
      .$transaction(async (tx) => {
        await tx.$executeRawUnsafe('CREATE SCHEMA invoice_bank_table_mig');
        await tx.$executeRawUnsafe('SET LOCAL search_path TO invoice_bank_table_mig');
        await tx.$executeRawUnsafe(
          'CREATE TABLE bank_accounts (id TEXT PRIMARY KEY, bank_name TEXT NOT NULL, account_number VARCHAR(50) NOT NULL)',
        );
        await tx.$executeRawUnsafe(
          'CREATE TABLE users (id TEXT PRIMARY KEY, first_name TEXT NOT NULL, last_name TEXT NOT NULL)',
        );
        // The 20261007120000 shape.
        await tx.$executeRawUnsafe(`CREATE TABLE invoice_document_policy (
          organization_id TEXT PRIMARY KEY, bank_account_id TEXT, notes TEXT, signatory_user_id TEXT,
          signatory_title VARCHAR(120), updated_by TEXT NOT NULL, updated_at TIMESTAMP(3) NOT NULL)`);
        await tx.$executeRawUnsafe(
          `INSERT INTO bank_accounts VALUES ('b1', 'Premier Bank', '0102 0033 4410')`,
        );
        await tx.$executeRawUnsafe(`INSERT INTO users VALUES ('u1', 'Ahmed', 'Ali')`);
        await tx.$executeRawUnsafe(`INSERT INTO invoice_document_policy VALUES
          ('org-linked', 'b1', 'Note', 'u1', 'Finance Manager', 'x', now()),
          ('org-empty', NULL, NULL, NULL, NULL, 'x', now()),
          ('org-gone', 'missing', NULL, 'missing', 'CFO', 'x', now())`);

        for (const sql of statements()) await tx.$executeRawUnsafe(sql);

        result = await tx.$queryRawUnsafe(
          `SELECT organization_id, payment_accounts, notes, signatory_name, signatory_title
           FROM invoice_document_policy ORDER BY organization_id`,
        );
        columns = (
          (await tx.$queryRawUnsafe(
            `SELECT column_name FROM information_schema.columns
             WHERE table_schema = 'invoice_bank_table_mig' AND table_name = 'invoice_document_policy'`,
          )) as Array<{ column_name: string }>
        ).map((c) => c.column_name);
        throw new Rollback();
      })
      .catch((err) => {
        if (!(err instanceof Rollback)) throw err;
      });

    expect(result).toEqual([
      { organization_id: 'org-empty', payment_accounts: [], notes: null, signatory_name: null, signatory_title: null },
      { organization_id: 'org-gone', payment_accounts: [], notes: null, signatory_name: null, signatory_title: 'CFO' },
      {
        organization_id: 'org-linked',
        payment_accounts: [{ bankName: 'Premier Bank', accountNumber: '0102 0033 4410' }],
        notes: 'Note',
        signatory_name: 'Ahmed Ali',
        signatory_title: 'Finance Manager',
      },
    ]);
    expect(columns).not.toContain('bank_account_id');
    expect(columns).not.toContain('signatory_user_id');
    expect(columns).toEqual(expect.arrayContaining(['payment_accounts', 'signatory_name']));
  });
});
