import { Logo } from "@/components/Logo";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in · OTS admin" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface px-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-white p-8">
        <Logo />
        <h1 className="mt-6 text-xl font-semibold">Sign in to OTS admin</h1>
        <p className="mt-1 text-sm text-muted">Review dataset and sample requests from the booth.</p>
        <LoginForm next={next ?? "/admin"} />
      </div>
    </div>
  );
}
