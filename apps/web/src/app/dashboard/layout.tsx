import { AuthGate } from '@/features/auth/session/auth-gate';

/**
 * Minimal protected-route wrapper.
 * PR 2 replaces this with the full application shell (header, navigation), which keeps
 * AuthGate as its outermost element.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <AuthGate>{children}</AuthGate>;
}
