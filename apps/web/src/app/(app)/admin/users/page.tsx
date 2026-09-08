import { UsersList } from '@/features/users/components/users-list';

/**
 * The workspace shell supplies the `h1` and the tab bar; the list supplies its
 * own panel heading and its "Add user" action. Nothing is left for the page to say.
 */
export default function UsersPage() {
  return <UsersList />;
}
