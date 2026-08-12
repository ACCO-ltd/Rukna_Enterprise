-- Unique partial index: at most one current/effective CLIENT_CONTRACT per project.
-- "Effective" = not yet CLOSED, CANCELLED, or TERMINATED.
-- This is the DB-level backstop for the application-layer invariant in ContractService.
CREATE UNIQUE INDEX contracts_one_effective_client_contract
  ON contracts(project_id)
  WHERE contract_kind = 'CLIENT_CONTRACT'
    AND status NOT IN ('CLOSED', 'CANCELLED', 'TERMINATED');
