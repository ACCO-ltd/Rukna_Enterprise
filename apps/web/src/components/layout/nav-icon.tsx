'use client';

import {
  BookOpen,
  Briefcase,
  Building2,
  Calendar,
  ChartColumn,
  CircleCheck,
  ClipboardList,
  CreditCard,
  FileText,
  FolderOpen,
  GitBranch,
  KeyRound,
  LayoutGrid,
  List,
  Package,
  Pencil,
  Receipt,
  Ruler,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Store,
  Tag,
  TrendingUp,
  Truck,
  UserCog,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

import type { NavIconKey } from './nav-groups';

/**
 * The one place a `NavIconKey` becomes a glyph.
 *
 * It used to live inside `global-sidebar.tsx`, which was fine while the sidebar was the only
 * surface that drew navigation. The Administration workspace draws the same destinations as a
 * tab bar, and a destination that carries one icon in the sidebar and a different one in its
 * tab bar is two destinations as far as the reader is concerned.
 */
const ICONS: Record<NavIconKey, LucideIcon> = {
  grid: LayoutGrid,
  building: Building2,
  folder: FolderOpen,
  receipt: Receipt,
  cog: Settings,
  pencil: Pencil,
  'chart-bar': ChartColumn,
  users: Users,
  clipboard: ClipboardList,
  'shopping-cart': ShoppingCart,
  truck: Truck,
  'trending-up': TrendingUp,
  shield: ShieldCheck,
  'git-branch': GitBranch,
  list: List,
  briefcase: Briefcase,
  'file-text': FileText,
  'book-open': BookOpen,
  'credit-card': CreditCard,
  wallet: Wallet,
  calendar: Calendar,
  storefront: Store,
  package: Package,
  ruler: Ruler,
  tag: Tag,
  'user-gear': UserCog,
  key: KeyRound,
  'check-circle': CircleCheck,
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
  return <ProfessionalIcon size={size} aria-hidden="true" className={className} />;
}
