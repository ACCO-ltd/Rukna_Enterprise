import { redirect } from 'next/navigation';

/**
 * The root path has no content of its own. Middleware has already sent unauthenticated
 * visitors to /login, so anyone reaching here belongs in the application.
 */
export default function HomePage() {
  redirect('/dashboard');
}
