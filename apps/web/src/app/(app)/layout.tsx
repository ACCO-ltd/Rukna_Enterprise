import { AppShell } from '@/components/layout/app-shell';
import { AuthGate } from '@/features/auth/session/auth-gate';

/**
 * Layout for every authenticated route.
 *
 * The `(app)` route group applies this shell without appearing in the URL, so
 * `/dashboard` and `/projects` stay at the top level while sharing one chrome.
 *
 * AuthGate stays outermost: nothing inside renders until the session is established, so
 * no feature component ever has to defend against a missing token.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate>
      <AppShell>{children}</AppShell>
    </AuthGate>
  );
}
