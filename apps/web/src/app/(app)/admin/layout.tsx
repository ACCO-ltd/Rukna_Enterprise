import { AdminShell } from '@/features/admin/components/admin-shell';

/**
 * Wraps every `/admin/*` route in the Administration workspace: title and tab bar.
 *
 * The governance builder at `/admin/workflows/[policyId]` is inside this subtree but is not a
 * tab — `AdminShell` recognises deep routes and renders them bare.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
