import Link from "next/link";
import { Logo } from "@/components/Logo";
import { currentAdminEmail, todayIST } from "@/lib/admin-data";
import { signOut } from "../actions";
import { NavLink } from "./NavLink";

export const dynamic = "force-dynamic";

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const email = await currentAdminEmail();
  return (
    <div className="min-h-dvh bg-white">
      <header className="sticky top-0 z-20 border-b border-line bg-white">
        <div className="mx-auto flex h-16 max-w-[1280px] items-center justify-between px-4 sm:px-6">
          <Link href="/admin" aria-label="OTS admin home">
            <Logo />
          </Link>
          <div className="flex items-center gap-4 text-sm">
            <span className="hidden text-muted sm:inline">{todayIST()} · IST</span>
            {email && <span className="hidden max-w-48 truncate text-ink md:inline">{email}</span>}
            <form action={signOut}>
              <button type="submit" className="h-9 rounded-lg border border-line px-3 text-sm font-medium hover:bg-surface">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <div className="mx-auto flex max-w-[1280px] flex-col sm:flex-row">
        <nav aria-label="Admin" className="flex gap-1 border-b border-line px-4 py-2 sm:w-52 sm:shrink-0 sm:flex-col sm:border-r sm:border-b-0 sm:px-3 sm:py-6">
          <NavLink href="/admin" icon="list">
            Requests
          </NavLink>
          <NavLink href="/admin/catalog" icon="box">
            Catalog
          </NavLink>
        </nav>
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-8">{children}</main>
      </div>
    </div>
  );
}
