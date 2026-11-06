"use client";

import { useRef, useState, type Ref } from "react";
import { DATASET } from "@/lib/catalog";
import { validateContact, type Contact, type RequestKind, type Selection } from "@/lib/selection";
import { delay } from "@/lib/motion";
import { SelectionPanel } from "./SelectionPanel";
import { Eyebrow, StepLayout, Title } from "./ui";

type Field = { key: keyof Contact; label: string; type: string; autoComplete: string; inputMode?: "email" | "tel" | "text"; required?: boolean };

const FIELDS: Field[] = [
  { key: "fullName", label: "Full name", type: "text", autoComplete: "name", required: true },
  { key: "email", label: "Email", type: "email", autoComplete: "email", inputMode: "email", required: true },
  { key: "company", label: "Company", type: "text", autoComplete: "organization", required: true },
  { key: "phone", label: "Phone", type: "tel", autoComplete: "tel", inputMode: "tel" },
];

export const CONTACT_FORM_ID = "contact-form";

export function submitLabel(kind: RequestKind) {
  return kind === "dataset" ? "Submit request" : `Request my ${DATASET.sampleHours} h sample`;
}

export function ContactStep({
  kind,
  sel,
  contact,
  onChange,
  onSubmit,
  submitError,
  pending,
}: {
  kind: RequestKind;
  sel: Selection;
  contact: Contact;
  onChange: (c: Contact) => void;
  onSubmit: () => void;
  submitError: string | null;
  pending: boolean;
}) {
  const [touched, setTouched] = useState<Partial<Record<keyof Contact, boolean>>>({});
  const refs = useRef<Partial<Record<keyof Contact, HTMLInputElement | null>>>({});
  const errors = validateContact(contact);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const firstBad = FIELDS.find((f) => errors[f.key])?.key;
    if (firstBad) {
      setTouched(Object.fromEntries(FIELDS.map((f) => [f.key, true])));
      refs.current[firstBad]?.focus();
      return;
    }
    onSubmit();
  }

  return (
    <StepLayout
      left={
        <>
          <Eyebrow
            mobile={kind === "dataset" ? "Step 05 — One last step" : "Step 05 — Free sample"}
            desktop={kind === "dataset" ? "Step 05 — One last step" : "Step 05 — Free sample"}
          />
          <Title>{kind === "dataset" ? "Where should we send it?" : "Where should we send your sample?"}</Title>
          <SelectionPanel sel={sel} step={5} sample={kind === "sample"} />
        </>
      }
      right={
        <form
          id={CONTACT_FORM_ID}
          onSubmit={handleSubmit}
          noValidate
          style={delay(80)}
          className="animate-fade-up space-y-[18px] lg:space-y-3.5 lg:rounded-[24px] lg:border-2 lg:border-[#ececec] lg:px-8 lg:pt-6 lg:pb-6"
        >
          {FIELDS.map((f) => (
            <TextField
              key={f.key}
              id={`field-${f.key}`}
              label={f.label}
              required={f.required}
              error={touched[f.key] ? errors[f.key] : undefined}
              inputRef={(el) => {
                refs.current[f.key] = el;
              }}
              type={f.type}
              inputMode={f.inputMode}
              autoComplete={f.autoComplete}
              value={contact[f.key]}
              onChange={(v) => onChange({ ...contact, [f.key]: v })}
              onBlur={() => setTouched((t) => ({ ...t, [f.key]: true }))}
            />
          ))}

          <p className="text-[14px] text-muted">By sending, you agree to our Privacy Policy &amp; Terms.</p>
          {submitError && (
            <p role="alert" className="rounded-xl bg-danger-50 px-4 py-3 text-sm text-danger lg:text-[15px]">
              {submitError}
            </p>
          )}
          {/* Back and submit live in the bottom bar, in the same place as on every other step. */}
        </form>
      }
    />
  );
}

function TextField({
  id,
  label,
  required,
  error,
  inputRef,
  type,
  inputMode,
  autoComplete,
  placeholder,
  className = "",
  value,
  onChange,
  onBlur,
}: {
  id: string;
  label: string;
  required?: boolean;
  error?: string;
  inputRef: Ref<HTMLInputElement>;
  type: string;
  inputMode?: "email" | "tel" | "text";
  autoComplete: string;
  placeholder?: string;
  className?: string;
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-[12px] font-medium text-ink lg:text-[16px]">
        {label}
        {required ? <span className="text-ink"> *</span> : <span className="font-normal"> (optional)</span>}
      </label>
      <input
        id={id}
        ref={inputRef}
        type={type}
        inputMode={inputMode}
        autoComplete={autoComplete}
        placeholder={placeholder}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        // Focus is a single 1.5px border turning blue; no ring or outline stacked on top.
        className={`mt-2 h-[55px] w-full rounded-xl border-[1.5px] bg-surface px-[17px] text-[16px] text-ink outline-none transition-[border-color,background-color] duration-150 placeholder:text-subtle focus:bg-white focus-visible:outline-none
          lg:mt-1.5 lg:h-12 lg:rounded-[14px] lg:px-5 lg:text-[17px] ${error ? "border-danger" : "border-[#e5e7eb] focus:border-brand"}`}
      />
      {error && (
        <p id={`${id}-error`} className="mt-1.5 text-sm text-danger lg:text-[14px]">
          {error}
        </p>
      )}
    </div>
  );
}
