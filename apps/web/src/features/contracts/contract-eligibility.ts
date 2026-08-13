import { ContractStatus } from '@erp/types';

import type { Contract } from './types';

/** An executed client contract can support project setup and payment applications. */
export function isOperationalClientContract(contract: Contract): boolean {
  return (
    contract.contractKind === 'CLIENT_CONTRACT' &&
    (contract.status === ContractStatus.ACTIVE ||
      contract.status === ContractStatus.FINAL_ACCOUNT_PENDING)
  );
}
