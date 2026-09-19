import { PoForm } from '../po-form';

export function PurchaseCreateShell({ projectId }: { projectId: string }) {
  return (
    <div className="w-full max-w-5xl">
      <PoForm redirectBase={`/projects/${projectId}/procurement/purchases`} />
    </div>
  );
}
