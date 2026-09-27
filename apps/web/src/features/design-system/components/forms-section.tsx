'use client';

import { useState } from 'react';
import {
  Button,
  FormActionBar,
  FormField,
  FormGroup,
  Input,
  LifecycleStepper,
  LineItemsEditor,
  MoneyInput,
  QuantityInput,
  RadioGroup,
  RECORD_NAME_INPUT,
  RecordCreateHeader,
  Select,
  SwitchField,
} from '@erp/ui';
import { ArrowLeft, ClipboardCheck, Receipt, Signpost, Users } from 'lucide-react';

import { FormErrorSummary } from '@/components/form-error-summary';

import { Section, Specimen } from './gallery-chrome';

interface DemoLine {
  id: string;
  description: string;
  qty: string;
  price: string;
}

const STAGES = [
  { key: 'DRAFT', label: 'Draft' },
  { key: 'APPROVED', label: 'Approved' },
  { key: 'POSTED', label: 'Posted' },
];

export function FormsSection() {
  const [source, setSource] = useState<'ipc' | 'milestone' | 'charge'>('milestone');
  const [emailInvoices, setEmailInvoices] = useState(true);
  const [contract, setContract] = useState('48250.50');
  const [credit, setCredit] = useState('-1250.00');
  const [received, setReceived] = useState('180');
  const [lines, setLines] = useState<DemoLine[]>([
    { id: '1', description: 'Site mobilisation — Hodan', qty: '1', price: '9800.00' },
    { id: '2', description: '', qty: '1', price: '' },
  ]);

  const update = (index: number, patch: Partial<DemoLine>) =>
    setLines((all) => all.map((line, i) => (i === index ? { ...line, ...patch } : line)));

  return (
    <Section
      id="forms"
      title="Forms"
      intro="Create and edit pages (ADR-037): a sticky action bar with the save state, a record header for master data, grouped two-column fields, one line-items editor, and a counted error summary. Errors block saving; warnings don't."
    >
      <Specimen label="Field states" token="<FormField hint error warning>">
        <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
          <FormField htmlFor="fs-contact" label="Contact person" required hint="Shown on invoices and statements.">
            <Input id="fs-contact" defaultValue="Abdirahman Osman" />
          </FormField>
          <FormField htmlFor="fs-email" label="Email" error="Enter an email like name@example.so.">
            <Input id="fs-email" defaultValue="finance@mopw" />
          </FormField>
          <FormField
            htmlFor="fs-inv"
            label="Supplier invoice number"
            required
            warning="BCC/INV/5531 is already recorded on BILL-2026-0042. Check this isn't a duplicate."
          >
            <Input id="fs-inv" defaultValue="BCC/INV/5531" />
          </FormField>
          <FormField htmlFor="fs-terms" label="Payment terms" required>
            <Select id="fs-terms" value="30" onChange={() => {}}>
              <option value="0">Due on receipt</option>
              <option value="30">Net 30</option>
              <option value="60">Net 60</option>
            </Select>
          </FormField>
        </div>
      </Specimen>

      <Specimen label="Input types" token="<MoneyInput allowNegative> · <QuantityInput unit> · <SwitchField>">
        <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
          <FormField htmlFor="fs-value" label="Contract value" hint="USD.">
            <MoneyInput id="fs-value" value={contract} onValueChange={setContract} />
          </FormField>
          <FormField htmlFor="fs-credit" label="Credit adjustment" hint="Credits take a leading minus.">
            <MoneyInput id="fs-credit" value={credit} onValueChange={setCredit} allowNegative />
          </FormField>
          <FormField htmlFor="fs-qty" label="Received quantity">
            <QuantityInput id="fs-qty" value={received} onValueChange={setReceived} unit="bag" />
          </FormField>
          <div className="self-end">
            <SwitchField
              id="fs-switch"
              label="Email invoices to the contact"
              description="Approved invoices are sent as PDF."
              checked={emailInvoices}
              onCheckedChange={setEmailInvoices}
            />
          </div>
        </div>
      </Specimen>

      <Specimen label="Radio cards" token='<RadioGroup variant="card" required>'>
        <RadioGroup
          label="What are you invoicing?"
          required
          name="fs-source"
          variant="card"
          value={source}
          onChange={setSource}
          options={[
            { value: 'ipc', icon: <ClipboardCheck size={16} />, label: 'Interim payment certificate', description: 'Bill the amount the client certified on an IPC.' },
            { value: 'milestone', icon: <Signpost size={16} />, label: 'Billing milestone', description: "Bill a milestone from the project's billing schedule." },
            { value: 'charge', icon: <Receipt size={16} />, label: 'Separate charge', description: 'Mobilisation, a variation or another charge outside the schedule.' },
          ]}
        />
      </Specimen>

      <Specimen
        label="LineItemsEditor"
        token="<LineItemsEditor columns errors note>"
        note="One set of controls per line: a table row from md, a labelled card below. Narrow the window to see the card."
      >
        <LineItemsEditor<DemoLine>
          label="Invoice lines"
          rows={lines}
          rowKey={(line) => line.id}
          cardTitle={(line, i) => (line.description ? `Line ${i + 1} — ${line.description}` : `Line ${i + 1}`)}
          errors={(i) =>
            lines[i]!.description || i === 0
              ? undefined
              : { description: 'Enter a description.', price: lines[i]!.price ? undefined : 'Enter a price.' }
          }
          onAdd={() => setLines((all) => [...all, { id: String(Date.now()), description: '', qty: '1', price: '' }])}
          onRemove={(index) => setLines((all) => all.filter((_, i) => i !== index))}
          columns={[
            {
              key: 'description',
              header: 'Description',
              required: true,
              width: 'minmax(0,2fr)',
              controlId: (i) => `fs-line-${i}-desc`,
              cell: (line, i) => (
                <Input id={`fs-line-${i}-desc`} value={line.description} onChange={(e) => update(i, { description: e.target.value })} />
              ),
            },
            {
              key: 'qty',
              header: 'Qty',
              required: true,
              width: '7rem',
              align: 'end',
              controlId: (i) => `fs-line-${i}-qty`,
              cell: (line, i) => (
                <QuantityInput id={`fs-line-${i}-qty`} value={line.qty} onValueChange={(v) => update(i, { qty: v })} unit="ea" />
              ),
            },
            {
              key: 'price',
              header: 'Unit price',
              required: true,
              width: '9rem',
              align: 'end',
              controlId: (i) => `fs-line-${i}-price`,
              cell: (line, i) => (
                <MoneyInput id={`fs-line-${i}-price`} value={line.price} onValueChange={(v) => update(i, { price: v })} />
              ),
            },
          ]}
        />
      </Specimen>

      <Specimen label="Record create header + form groups" token="<RecordCreateHeader> · <FormGroup>">
        <div className="space-y-6">
          <RecordCreateHeader icon={<Users size={20} />}>
            <FormField htmlFor="fs-client" label="Client name" required hint="Clients are shared by every project, invoice and receipt.">
              <Input id="fs-client" className={RECORD_NAME_INPUT} placeholder="e.g. Ministry of Water Resources" />
            </FormField>
          </RecordCreateHeader>
          <FormGroup title="Contact" description="Who ACCO calls about documents and payments.">
            <FormField htmlFor="fs-person" label="Contact person" required>
              <Input id="fs-person" />
            </FormField>
            <FormField htmlFor="fs-phone" label="Phone" hint="Include the country code, e.g. +252 61 234 5678.">
              <Input id="fs-phone" />
            </FormField>
          </FormGroup>
        </div>
      </Specimen>

      <Specimen label="FormActionBar" token="<FormActionBar saveState lifecycle>">
        <div className="space-y-3">
          <FormActionBar
            className="static"
            back={<Button variant="ghost" className="gap-1.5 px-2"><ArrowLeft size={16} aria-hidden="true" />Clients</Button>}
            save={<Button>Save client</Button>}
            discard={<Button variant="ghost">Discard</Button>}
            saveState="new"
            saveStateLabels={{ new: 'Not saved yet', dirty: 'Unsaved changes', clean: 'All changes saved' }}
          />
          <FormActionBar
            className="static"
            back={<Button variant="ghost" className="gap-1.5 px-2"><ArrowLeft size={16} aria-hidden="true" />Client invoices</Button>}
            save={<Button>Save draft</Button>}
            discard={<Button variant="ghost">Discard</Button>}
            saveState="dirty"
            saveStateLabels={{ new: 'Not saved yet', dirty: 'Unsaved changes', clean: 'All changes saved' }}
            lifecycle={<LifecycleStepper steps={STAGES} current="DRAFT" />}
          />
        </div>
      </Specimen>

      <Specimen label="Error summary" token="<FormErrorSummary errors>">
        <FormErrorSummary
          errors={[
            { label: 'Client name', fieldId: 'fs-client', message: "Enter the client's name." },
            { label: 'Email', fieldId: 'fs-email', message: 'Enter an email like name@example.so.' },
          ]}
        />
      </Specimen>

    </Section>
  );
}
