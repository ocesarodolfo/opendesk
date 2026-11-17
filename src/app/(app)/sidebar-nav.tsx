"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import InboxUnreadBadge from "@/components/inbox-unread-badge";

export type SidebarNavItem = {
  href: string;
  label: string;
};

export default function SidebarNav({ items }: { items: SidebarNavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="flex-1 space-y-1 px-3">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex items-center justify-between rounded-md px-3 py-2 text-sm transition-colors ${
              active
                ? "bg-sky-50 font-semibold text-sky-700"
                : "text-slate-700 hover:bg-slate-100 hover:text-slate-900"
            }`}
          >
            <span>{item.label}</span>
            {/* nao lidas: badge verde, como as bolhas do WhatsApp */}
            {item.href === "/inbox" ? <InboxUnreadBadge /> : null}
          </Link>
        );
      })}
    </nav>
  );
}

