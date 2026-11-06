"use client";

import { useActionState } from "react";
import { signIn, type ActionState } from "../actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(signIn, { error: null });
  return (
    <form action={action} className="mt-6 space-y-4">
      <input type="hidden" name="next" value={next} />
      <div>
        <label htmlFor="password" className="block text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          className="mt-1.5 h-11 w-full rounded-lg border border-line px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
      </div>
      {state.error && (
        <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="h-11 w-full rounded-lg bg-brand text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
