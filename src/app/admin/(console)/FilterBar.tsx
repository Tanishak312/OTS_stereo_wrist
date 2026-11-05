"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { DOMAINS } from "@/lib/catalog";
import { STATUS_FILTERS } from "./filters";

const selectCls =
  "h-10 rounded-lg border border-line bg-white px-3 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20";

export function FilterBar() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(params.get("q") ?? "");

  function update(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    startTransition(() => router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false }));
  }

  // Debounced search; filters live in the URL so views can be shared and survive refresh.
  useEffect(() => {
    if (q === (params.get("q") ?? "")) return;
    const t = setTimeout(() => update("q", q.trim()), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className="flex flex-wrap items-center gap-3" aria-busy={pending}>
      <div className="relative min-w-60 flex-1 sm:max-w-80">
        <svg className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-subtle" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
          <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <label htmlFor="q" className="sr-only">
          Search requests
        </label>
        <input
          id="q"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search token, name, email, company"
          className="h-10 w-full rounded-lg border border-line bg-white pr-3 pl-9 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
      </div>
      <label className="sr-only" htmlFor="kind">
        Type
      </label>
      <select id="kind" className={selectCls} value={params.get("kind") ?? ""} onChange={(e) => update("kind", e.target.value)}>
        <option value="">All types</option>
        <option value="dataset">Dataset</option>
        <option value="sample">Sample</option>
      </select>
      <label className="sr-only" htmlFor="env">
        Environment
      </label>
      <select id="env" className={`${selectCls} max-w-56`} value={params.get("env") ?? ""} onChange={(e) => update("env", e.target.value)}>
        <option value="">All environments</option>
        {DOMAINS.map((d) => (
          <option key={d.slug} value={d.slug}>
            {d.name}
          </option>
        ))}
      </select>
      <label className="sr-only" htmlFor="status">
        Status
      </label>
      <select id="status" className={selectCls} value={params.get("status") ?? ""} onChange={(e) => update("status", e.target.value)}>
        <option value="">All statuses</option>
        {STATUS_FILTERS.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
      {pending && <span className="text-xs text-muted">Updating…</span>}
    </div>
  );
}
