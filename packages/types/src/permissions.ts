export const PERMISSIONS = {
  usersView: 'view:user',
  usersManage: 'manage:user',
  rolesView: 'view:role',
  rolesManage: 'manage:role',
  governanceImpactView: 'view:governance-impact',
  permissionsView: 'view:permission',
  organizationsView: 'view:organization',
  workflowsView: 'view:workflow',
  workflowsManage: 'manage:workflow',
  workflowsPublish: 'publish:workflow',
  auditLogsView: 'view:audit-log',

  clientsView: 'view:client',
  clientsCreate: 'create:client',
  clientsManage: 'manage:client',

  projectsView: 'view:project',
  projectsCreate: 'create:project',
  projectsManage: 'manage:project',
  districtsManage: 'manage:district',
  projectsApprove: 'approve:project',
  projectMembersManage: 'manage:project-member',

  boqView: 'view:boq',
  boqManage: 'manage:boq',
  boqBaseline: 'baseline:boq',

  contractsView: 'view:contract',
  contractsCreate: 'create:contract',
  contractsManage: 'manage:contract',
  contractsApprove: 'approve:contract',

  ipaView: 'view:ipa',
  ipaCreate: 'create:ipa',
  ipaManage: 'manage:ipa',
  ipaApprove: 'approve:ipa',

  ipcView: 'view:ipc',
  ipcIssue: 'issue:ipc',
  ipcSupersede: 'supersede:ipc',

  receiptsView: 'view:receipt',
  receiptsCreate: 'create:receipt',
  receiptsAllocate: 'allocate:receipt',

  accountingView: 'view:accounting',
  financialPositionView: 'view:financial-position',
  accountingManage: 'manage:accounting',
  journalsManage: 'manage:journal',
  receivablesManage: 'manage:receivable',
  payablesManage: 'manage:payable',
  periodsManage: 'manage:period',
  fiscalYearsManage: 'manage:fiscal-year',

  procurementView: 'view:procurement',
  procurementConfigManage: 'manage:procurement-config',
  materialRequestsCreate: 'create:material-request',
  materialRequestsSubmit: 'submit:material-request',
  materialRequestsApprove: 'approve:material-request',
  purchaseOrdersCreate: 'create:purchase-order',
  purchaseOrdersApprove: 'approve:purchase-order',
  goodsReceiptsCreate: 'create:goods-receipt',
  goodsReceiptsPost: 'post:goods-receipt',
  goodsReceiptExceptionsApprove: 'approve:goods-receipt-exception',
  matchingExceptionsApprove: 'approve:matching-exception',
  commitmentsView: 'view:commitment-ledger',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export interface PermissionDefinition {
  key: PermissionKey;
  action: string;
  resource: string;
  description: string;
  /** Business-facing administration grouping; never inferred by the browser. */
  domain: string;
  /** Access-review signal, not an authorization decision. */
  riskClass: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

const DOMAIN_BY_RESOURCE: Record<string, string> = {
  user: 'People', role: 'Access governance', permission: 'Access governance',
  'governance-impact': 'Access governance',
  organization: 'Organization', workflow: 'Approval policies', 'audit-log': 'Audit',
  client: 'Commercial', project: 'Projects', district: 'Organization', 'project-member': 'Projects',
  boq: 'Projects', contract: 'Commercial', ipa: 'Commercial', ipc: 'Commercial', receipt: 'Commercial',
  accounting: 'Accounting', 'financial-position': 'Accounting', journal: 'Accounting',
  receivable: 'Accounting', payable: 'Accounting', period: 'Accounting', 'fiscal-year': 'Accounting',
  procurement: 'Procurement', 'procurement-config': 'Procurement', 'material-request': 'Procurement',
  'purchase-order': 'Procurement', 'goods-receipt': 'Procurement',
  'goods-receipt-exception': 'Procurement', 'matching-exception': 'Procurement',
  'commitment-ledger': 'Procurement',
};

function riskFor(action: string): PermissionDefinition['riskClass'] {
  if (['approve', 'issue', 'post', 'baseline', 'supersede'].includes(action)) return 'CRITICAL';
  if (['manage', 'allocate', 'submit'].includes(action)) return 'HIGH';
  if (['create'].includes(action)) return 'MEDIUM';
  return 'LOW';
}

const DESCRIPTIONS: Record<PermissionKey, string> = {
  [PERMISSIONS.usersView]: 'View users in the active organization',
  [PERMISSIONS.usersManage]: 'Create and manage users in the active organization',
  [PERMISSIONS.rolesView]: 'View roles in the active organization',
  [PERMISSIONS.rolesManage]: 'Create roles and assign permissions',
  [PERMISSIONS.governanceImpactView]:
    'Read role and policy impact previews, including affected-member counts and SoD findings',
  [PERMISSIONS.permissionsView]: 'View the permission catalogue',
  [PERMISSIONS.organizationsView]: 'View the active organization',
  [PERMISSIONS.workflowsView]: 'View workflow definitions and approval state',
  [PERMISSIONS.workflowsManage]: 'Configure workflows and act on approvals',
  [PERMISSIONS.workflowsPublish]: 'Publish, activate, and retire approval policies',
  [PERMISSIONS.auditLogsView]: 'View the organization audit log',
  [PERMISSIONS.clientsView]: 'View clients',
  [PERMISSIONS.clientsCreate]: 'Create clients',
  [PERMISSIONS.clientsManage]: 'Update clients and contacts',
  [PERMISSIONS.projectsView]: 'View projects',
  [PERMISSIONS.projectsCreate]: 'Create projects',
  [PERMISSIONS.projectsManage]: 'Update projects and run operational lifecycle commands',
  [PERMISSIONS.districtsManage]: 'Manage the district registry (project code segments)',
  [PERMISSIONS.projectsApprove]: 'Approve projects and controlled lifecycle transitions',
  [PERMISSIONS.projectMembersManage]: 'Manage project membership and project roles',
  [PERMISSIONS.boqView]: 'View bills of quantities',
  [PERMISSIONS.boqManage]: 'Create and edit BOQ drafts',
  [PERMISSIONS.boqBaseline]: 'Baseline BOQ versions',
  [PERMISSIONS.contractsView]: 'View contracts',
  [PERMISSIONS.contractsCreate]: 'Create contracts',
  [PERMISSIONS.contractsManage]: 'Update contract terms and operational state',
  [PERMISSIONS.contractsApprove]: 'Approve and execute contracts',
  [PERMISSIONS.ipaView]: 'View interim payment applications',
  [PERMISSIONS.ipaCreate]: 'Create interim payment applications',
  [PERMISSIONS.ipaManage]: 'Edit and submit interim payment applications',
  [PERMISSIONS.ipaApprove]: 'Approve interim payment applications for submission',
  [PERMISSIONS.ipcView]: 'View interim payment certificates',
  [PERMISSIONS.ipcIssue]: 'Issue interim payment certificates',
  [PERMISSIONS.ipcSupersede]: 'Supersede effective interim payment certificates',
  [PERMISSIONS.receiptsView]: 'View client receipts',
  [PERMISSIONS.receiptsCreate]: 'Create client receipts',
  [PERMISSIONS.receiptsAllocate]: 'Allocate client receipts to certificates',
  [PERMISSIONS.accountingView]: 'View accounting reports and records',
  [PERMISSIONS.financialPositionView]: 'View organization and project financial position',
  [PERMISSIONS.accountingManage]: 'Manage accounting configuration and operational records',
  [PERMISSIONS.journalsManage]: 'Create, approve, post and reverse journals',
  [PERMISSIONS.receivablesManage]: 'Manage accounts receivable',
  [PERMISSIONS.payablesManage]: 'Manage accounts payable',
  [PERMISSIONS.periodsManage]: 'Lock, close and reopen fiscal periods',
  [PERMISSIONS.fiscalYearsManage]: 'Manage fiscal years and year-end close',
  [PERMISSIONS.procurementView]: 'View procurement records',
  [PERMISSIONS.procurementConfigManage]: 'Manage procurement master data and policies',
  [PERMISSIONS.materialRequestsCreate]: 'Create material requests',
  [PERMISSIONS.materialRequestsSubmit]: 'Submit material requests',
  [PERMISSIONS.materialRequestsApprove]: 'Approve material requests',
  [PERMISSIONS.purchaseOrdersCreate]: 'Create and revise purchase orders',
  [PERMISSIONS.purchaseOrdersApprove]: 'Approve purchase orders and create commitments',
  [PERMISSIONS.goodsReceiptsCreate]: 'Create goods receipts',
  [PERMISSIONS.goodsReceiptsPost]: 'Post goods receipts and create accruals',
  [PERMISSIONS.goodsReceiptExceptionsApprove]: 'Approve goods receipt exceptions',
  [PERMISSIONS.matchingExceptionsApprove]: 'Approve supplier bill matching exceptions',
  [PERMISSIONS.commitmentsView]: 'View the commitment ledger',
};

export const PERMISSION_DEFINITIONS: readonly PermissionDefinition[] = Object.values(
  PERMISSIONS,
).map((key) => {
  const separator = key.indexOf(':');
  return {
    key,
    action: key.slice(0, separator),
    resource: key.slice(separator + 1),
    description: DESCRIPTIONS[key],
    domain: DOMAIN_BY_RESOURCE[key.slice(separator + 1)] ?? 'Platform',
    riskClass: riskFor(key.slice(0, separator)),
  };
});
