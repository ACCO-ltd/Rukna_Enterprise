'use client';

import { useFinanceProject } from '../hooks';
import { CashflowView } from './cashflow-view';

/** The project's Cash flow tab — the forecast filtered to this project (the header row is cached). */
export function FinanceProjectCashflow({ projectId }: { projectId: string }) {
  const project = useFinanceProject(projectId);
  return <CashflowView projectId={projectId} projectCode={project.data?.item.code} />;
}
