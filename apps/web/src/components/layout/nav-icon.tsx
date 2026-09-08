'use client';

import {
  BookOpenIcon,
  BriefcaseIcon,
  BuildingsIcon,
  CalendarBlankIcon,
  ChartBarIcon,
  ClipboardTextIcon,
  CreditCardIcon,
  FileTextIcon,
  FolderOpenIcon,
  GearIcon,
  GitBranchIcon,
  KeyIcon,
  ListBulletsIcon,
  PackageIcon,
  PencilSimpleIcon,
  ReceiptIcon,
  RulerIcon,
  ShieldCheckIcon,
  ShoppingCartIcon,
  SquaresFourIcon,
  StorefrontIcon,
  TagIcon,
  TrendUpIcon,
  TruckIcon,
  UserGearIcon,
  UsersThreeIcon,
  WalletIcon,
  type Icon,
} from '@phosphor-icons/react';

import type { NavIconKey } from './nav-groups';

/**
 * The one place a `NavIconKey` becomes a glyph.
 *
 * It used to live inside `global-sidebar.tsx`, which was fine while the sidebar was the only
 * surface that drew navigation. The Administration workspace draws the same destinations as a
 * tab bar, and a destination that carries one icon in the sidebar and a different one in its
 * tab bar is two destinations as far as the reader is concerned.
 */
const ICONS: Record<NavIconKey, Icon> = {
  grid: SquaresFourIcon,
  building: BuildingsIcon,
  folder: FolderOpenIcon,
  receipt: ReceiptIcon,
  cog: GearIcon,
  pencil: PencilSimpleIcon,
  'chart-bar': ChartBarIcon,
  users: UsersThreeIcon,
  clipboard: ClipboardTextIcon,
  'shopping-cart': ShoppingCartIcon,
  truck: TruckIcon,
  'trending-up': TrendUpIcon,
  shield: ShieldCheckIcon,
  'git-branch': GitBranchIcon,
  list: ListBulletsIcon,
  briefcase: BriefcaseIcon,
  'file-text': FileTextIcon,
  'book-open': BookOpenIcon,
  'credit-card': CreditCardIcon,
  wallet: WalletIcon,
  calendar: CalendarBlankIcon,
  storefront: StorefrontIcon,
  package: PackageIcon,
  ruler: RulerIcon,
  tag: TagIcon,
  'user-gear': UserGearIcon,
  key: KeyIcon,
};

export function NavIcon({
  iconKey,
  className,
  size = 17,
}: {
  iconKey: NavIconKey;
  className?: string;
  size?: number;
}) {
  const ProfessionalIcon = ICONS[iconKey];
  return <ProfessionalIcon size={size} weight="regular" aria-hidden="true" className={className} />;
}
