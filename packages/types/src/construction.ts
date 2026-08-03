import type {
  ContractStatus,
  BillingModel,
  AdvanceType,
  GuaranteeStatus,
  IpaStatus,
  IpcStatus,
  ClientStatus,
} from './enums.js';

// ─── Client ───────────────────────────────────────────────────────────────────

export interface ClientContactResponse {
  id: string;
  name: string;
  title?: string;
  email?: string;
  phone?: string;
  isPrimary: boolean;
}

export interface ClientResponse {
  id: string;
  organizationId: string;
  legalName: string;
  tradingName?: string;
  taxNumber?: string;
  status: ClientStatus;
  contacts: ClientContactResponse[];
  createdAt: string;
  updatedAt: string;
}

// ─── Contract sub-entities ────────────────────────────────────────────────────

export interface ContractRetentionTermsResponse {
  id: string;
  contractId: string;
  retentionRate: string;
  releaseOnPracticalCompletion: string;
  releaseOnDefectsExpiry: string;
  defectLiabilityPeriodDays: number;
}

export interface ContractAdvanceTermResponse {
  id: string;
  contractId: string;
  advanceType: AdvanceType;
  amount: string;
  currency: string;
  recoveryRate: string;
  notes?: string;
}

export interface ContractGuaranteeResponse {
  id: string;
  contractId: string;
  guaranteeType: string;
  issuer: string;
  amount: string;
  currency: string;
  issueDate: string;
  expiryDate: string;
  status: GuaranteeStatus;
  notes?: string;
}

export interface ContractMilestoneResponse {
  id: string;
  contractId: string;
  description: string;
  dueDate?: string;
  completedAt?: string;
  completedBy?: string;
}

export interface ContractResponse {
  id: string;
  organizationId: string;
  projectId: string;
  clientId: string;
  boqVersionId: string;
  contractNumber: string;
  contractValue: string;
  currency: string;
  billingModel: BillingModel;
  status: ContractStatus;
  startDate?: string;
  expectedEndDate?: string;
  // Frozen at execute() — null until then
  clientNameSnapshot?: string;
  clientTaxSnapshot?: string;
  cancelledAt?: string;
  cancelledBy?: string;
  cancellationReason?: string;
  terminatedAt?: string;
  terminatedBy?: string;
  terminationReason?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  retentionTerms?: ContractRetentionTermsResponse;
  advanceTerms: ContractAdvanceTermResponse[];
  guarantees: ContractGuaranteeResponse[];
  milestones: ContractMilestoneResponse[];
}

// ─── IPA ──────────────────────────────────────────────────────────────────────

export interface IpaItemResponse {
  id: string;
  applicationId: string;
  boqNodeId: string;
  measurementMethodSnapshot: string;
  unitRateSnapshot: string;
  currencySnapshot: string;
  cumulativeClaimed: string;
  previousEffectiveCertified: string;
  periodQuantity: string;
  periodAmount: string;
  createdAt: string;
}

export interface IpaDeductionResponse {
  id: string;
  applicationId: string;
  deductionType: string;
  sourceTermId?: string;
  rate?: string;
  basis: string;
  amount: string;
  createdAt: string;
}

export interface IpaResponse {
  id: string;
  organizationId: string;
  contractId: string;
  status: IpaStatus;
  applicationNumber?: number;
  applicationRef?: string;
  periodFrom?: string;
  periodTo?: string;
  exchangeRateCurrency?: string;
  exchangeRateBase?: string;
  exchangeRateValue?: string;
  exchangeRateDate?: string;
  submittedAt?: string;
  submittedBy?: string;
  notes?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  items: IpaItemResponse[];
  deductions: IpaDeductionResponse[];
  // Server-computed — always present on GET /ipa/:id
  totalPeriodAmount: string;
  totalDeductions: string;
  netPayable: string;
}

// ─── IPC ──────────────────────────────────────────────────────────────────────

export interface IpcItemResponse {
  id: string;
  certificateId: string;
  applicationItemId: string;
  certifiedQuantity: string;
  certifiedAmount: string;
  varianceQuantity: string;
  varianceReason?: string;
}

export interface IpcDeductionResponse {
  id: string;
  certificateId: string;
  deductionType: string;
  sourceTermId?: string;
  rate?: string;
  basis: string;
  amount: string;
}

export interface IpcResponse {
  id: string;
  organizationId: string;
  applicationId: string;
  certificateNumber: number;
  certificateRef?: string;
  status: IpcStatus;
  isEffective: boolean;
  effectiveAt?: string;
  certifiedTotal: string;
  currency: string;
  exchangeRateCurrency?: string;
  exchangeRateBase?: string;
  exchangeRateValue?: string;
  exchangeRateDate?: string;
  issuedAt?: string;
  issuedBy?: string;
  supersededAt?: string;
  supersededById?: string;
  supersessionReason?: string;
  notes?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  items: IpcItemResponse[];
  deductions: IpcDeductionResponse[];
  // Server-computed — always present on GET /ipc/:id
  totalCertifiedAmount: string;
  totalDeductions: string;
  netCertified: string;
}

// ─── Payment Status (derived — no status field stored on IPC) ─────────────────

export type IpcPaymentStatus = 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';

export interface IpcPaymentStatusResponse {
  certificateId: string;
  certifiedTotal: string;
  totalAllocated: string;
  outstanding: string;
  paymentStatus: IpcPaymentStatus;
}

// ─── Finance ──────────────────────────────────────────────────────────────────

export interface ReceiptAllocationResponse {
  id: string;
  receiptId: string;
  certificateId: string;
  allocatedAmount: string;
  notes?: string;
  createdAt: string;
}

export interface PaymentReceiptResponse {
  id: string;
  organizationId: string;
  clientId: string;
  receiptNumber: string;
  receivedDate: string;
  amount: string;
  currency: string;
  exchangeRateCurrency?: string;
  exchangeRateBase?: string;
  exchangeRateValue?: string;
  exchangeRateDate?: string;
  paymentMethod?: string;
  referenceNumber?: string;
  notes?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  allocations: ReceiptAllocationResponse[];
}
