'use client';

import { useState } from 'react';
import {
  ActivityTimeline,
  Button,
  ChoiceCards,
  FormDialog,
  FormDialogBody,
  FormDialogClose,
  FormDialogFooter,
  FormDialogSection,
  FormField,
  Input,
  MoneyInput,
  QuantityInput,
  Textarea,
  type FormDialogSize,
} from '@erp/ui';

import { Specimen } from './gallery-chrome';

type Pricing = 'UNIT_RATE' | 'LUMP_SUM';

const INITIAL = {
  description: 'Reinforced concrete to columns, grade C30',
  quantity: '48',
  rate: '185.00',
  pricing: 'UNIT_RATE' as Pricing,
  reference: '',
};

/**
 * The ADR-039 record dialog, live: pinned header and footer, a scrolling body, the discard
 * question on a dirty dismissal, and the busy guard while "saving". Gallery only — the BOQ item
 * dialog it stands in for is built in PR 2 of the migration.
 */
export function RecordDialogSpecimen() {
  const [open, setOpen] = useState(false);
  const [size, setSize] = useState<FormDialogSize>('lg');
  const [values, setValues] = useState(INITIAL);
  const [saving, setSaving] = useState(false);

  const dirty = (Object.keys(INITIAL) as (keyof typeof INITIAL)[]).some((key) => values[key] !== INITIAL[key]);

  const openAt = (next: FormDialogSize) => {
    setSize(next);
    setValues(INITIAL);
    setOpen(true);
  };

  const save = () => {
    setSaving(true);
    window.setTimeout(() => {
      setSaving(false);
      setOpen(false);
    }, 900);
  };

  return (
    <>
      <Specimen
        label="Record dialog"
        token="<FormDialog size dirty busy> · <FormDialogSection> · <ChoiceCards>"
        note="ADR-039: md 1–6 fields · lg a record form · xl a record with a short list · 2xl comparisons. Full screen on phones. Edit a field, then press Esc to see the discard question."
      >
        <div className="flex flex-wrap gap-3">
          {(['md', 'lg', 'xl', '2xl'] as const).map((tier) => (
            <Button key={tier} variant="outline" onClick={() => openAt(tier)}>
              Open {tier}
            </Button>
          ))}
        </div>
      </Specimen>

      <Specimen label="Activity timeline — compact" token="<ActivityTimeline compact viewAll>">
        <div className="max-w-sm">
          <ActivityTimeline
            compact
            label="Project activity"
            viewAll={{ onClick: () => {} }}
            entries={[
              {
                id: '3',
                actor: 'Abdi Yusuf',
                action: 'executed contract',
                target: 'ACC-HDN-26-0005-C1',
                href: '#top',
                at: 'Today, 09:12',
              },
              { id: '2', actor: 'Hodan Abdi', action: 'recorded progress on', target: 'Item 2.1', at: 'Yesterday, 16:40' },
              { id: '1', actor: 'Faarax Nuur', action: 'created the project', at: '14 Sep 2026' },
            ]}
          />
        </div>
      </Specimen>

      <FormDialog
        open={open}
        onOpenChange={setOpen}
        size={size}
        title="Item 2.1"
        subtitle="Measurement and pricing"
        dirty={dirty}
        busy={saving}
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <FormDialogBody>
          <FormDialogSection title="Description">
            <FormField htmlFor="rd-description" label="Work item" required>
              <Textarea
                id="rd-description"
                rows={2}
                value={values.description}
                onChange={(event) => setValues((v) => ({ ...v, description: event.target.value }))}
              />
            </FormField>
          </FormDialogSection>
          <FormDialogSection title="Pricing" description="How this line is valued in the bill.">
            <ChoiceCards
              label="Pricing method"
              value={values.pricing}
              onChange={(pricing) => setValues((v) => ({ ...v, pricing }))}
              options={[
                { value: 'UNIT_RATE', label: 'Unit rate', hint: 'Quantity × rate' },
                { value: 'LUMP_SUM', label: 'Lump sum', hint: 'One fixed amount' },
              ]}
            />
            <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
              {values.pricing === 'UNIT_RATE' ? (
                <FormField htmlFor="rd-qty" label="Quantity" required>
                  <QuantityInput
                    id="rd-qty"
                    unit="m³"
                    value={values.quantity}
                    onValueChange={(quantity) => setValues((v) => ({ ...v, quantity }))}
                  />
                </FormField>
              ) : null}
              <FormField htmlFor="rd-rate" label={values.pricing === 'UNIT_RATE' ? 'Rate' : 'Amount'} required>
                <MoneyInput
                  id="rd-rate"
                  value={values.rate}
                  onValueChange={(rate) => setValues((v) => ({ ...v, rate }))}
                />
              </FormField>
            </div>
          </FormDialogSection>
          <FormDialogSection title="Reference">
            <FormField htmlFor="rd-ref" label="Drawing reference" hint="Optional.">
              <Input
                id="rd-ref"
                placeholder="S-201 rev C"
                value={values.reference}
                onChange={(event) => setValues((v) => ({ ...v, reference: event.target.value }))}
              />
            </FormField>
          </FormDialogSection>
        </FormDialogBody>
        <FormDialogFooter>
          <FormDialogClose asChild>
            <Button type="button" variant="outline" disabled={saving}>
              Cancel
            </Button>
          </FormDialogClose>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save item'}
          </Button>
        </FormDialogFooter>
      </FormDialog>
    </>
  );
}
