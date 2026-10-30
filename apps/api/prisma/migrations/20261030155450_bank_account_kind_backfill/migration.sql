-- PM-3: accounts set up from the Banking presets keep their placeholder numbers (CASH-BOX, EVC-FLOAT);
-- type them as a cash box and a mobile-money wallet. Every other account stays a bank account and
-- can be changed under Banking → Bank accounts.
UPDATE "bank_accounts" SET "kind" = 'CASH' WHERE "account_number" = 'CASH-BOX';
UPDATE "bank_accounts" SET "kind" = 'MOBILE_WALLET' WHERE "account_number" = 'EVC-FLOAT';
