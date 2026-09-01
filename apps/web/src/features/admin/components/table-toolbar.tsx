'use client';

import { useId, type ReactNode } from 'react';
import { Input, Select } from '@erp/ui';

/**
 * The Administration list toolbar: a search box that grows, and one or more compact filter
 * selects beside it. Stacks on 375px (search full-width, filters wrap below) via flex-wrap.
 * Client-side only — it drives an in-memory filter over the already-fetched list, matching
 * the current fetch-everything read model (design §10 open-question 4).
 */
export function TableToolbar({
  searchId,
  searchValue,
  onSearchChange,
  searchPlaceholder,
  searchLabel,
  children,
}: {
  searchId: string;
  searchValue: string;
  onSearchChange: (next: string) => void;
  searchPlaceholder: string;
  /** Visually-hidden label for the search box. */
  searchLabel: string;
  /** Filter controls (e.g. a status <FilterSelect>), rendered to the right of search. */
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-52 flex-1">
        <label htmlFor={searchId} className="sr-only">
          {searchLabel}
        </label>
        <Input
          id={searchId}
          type="search"
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={searchPlaceholder}
          autoComplete="off"
        />
      </div>
      {children}
    </div>
  );
}

/** A labelled filter select. The label sits above as an 11px uppercase micro-label. */
export function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: { value: string; label: string }[];
}) {
  const id = useId();
  return (
    <div className="w-full sm:w-40">
      <label
        htmlFor={id}
        className="mb-1.5 block text-micro font-semibold uppercase text-muted-foreground"
      >
        {label}
      </label>
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </div>
  );
}
