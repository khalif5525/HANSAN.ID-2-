"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { DevRole } from "@/types/roles";
import { DEV_ACCOUNTS } from "@/types/roles";
import { clearDevSession } from "@/lib/dev-session";
import { Avatar } from "@/components/ui/avatar";
import { IconButton } from "@/components/ui/icon-button";

export interface HeaderProps {
  role: DevRole;
  /** Workspace title shown next to the logo. */
  contextLabel?: string;
  /** Mobile menu toggle (wired by workspace shell). */
  onToggleMenu?: () => void;
  /** Sidebar collapse toggle (desktop). */
  onToggleSidebar?: () => void;
  notifications?: number;
}

/**
 * App header — brand, workspace context, session identity.
 * Sign-out clears the localStorage mirror AND the signed server cookie
 * (Phase 3), then returns to /login.
 */
export function Header({ role, contextLabel, onToggleMenu, onToggleSidebar, notifications = 0 }: HeaderProps) {
  const router = useRouter();
  const account = DEV_ACCOUNTS[role];

  async function signOut(e: React.MouseEvent) {
    e.preventDefault();
    try {
      await fetch("/api/auth/signout", { method: "POST", keepalive: true });
    } catch {
      /* cookie may already be absent — local clear still runs */
    }
    clearDevSession();
    router.replace("/login");
  }
  return (
    <header className="flex h-[var(--shell-header-h)] shrink-0 items-center gap-3 border-b-2 border-hansan-ink bg-hansan-surface-soft px-4">
      {onToggleMenu && (
        <IconButton label="Open navigation" size="sm" onClick={onToggleMenu} className="lg:hidden">
          <span aria-hidden>☰</span>
        </IconButton>
      )}
      {onToggleSidebar && (
        <IconButton label="Toggle sidebar" size="sm" onClick={onToggleSidebar} className="hidden lg:inline-flex">
          <span aria-hidden>≡</span>
        </IconButton>
      )}

      <Link href="/" className="flex items-center gap-2">
        <span aria-hidden className="flex h-8 w-8 items-center justify-center rounded-lg bg-hansan-orange text-sm font-black text-white shadow-neu-raised-sm">
          H
        </span>
        <span className="text-lg font-black tracking-tight text-hansan-ink">HANSAN</span>
      </Link>

      {contextLabel && (
        <>
          <span aria-hidden className="text-hansan-ink-muted">/</span>
          <span className="text-sm font-semibold text-hansan-ink-muted">{contextLabel}</span>
        </>
      )}

      <div className="ml-auto flex items-center gap-2">
        <IconButton label={notifications > 0 ? `${notifications} notifications` : "Notifications"} size="sm">
          <span aria-hidden>◔</span>
        </IconButton>
        <Link
          href="/login"
          onClick={signOut}
          className="flex items-center gap-2 rounded-xl px-2 py-1.5 transition hover:bg-hansan-surface"
        >
          <Avatar initials={account.label} size="sm" />
          <span className="hidden text-sm font-semibold text-hansan-ink sm:block">{account.label}</span>
        </Link>
      </div>
    </header>
  );
}
