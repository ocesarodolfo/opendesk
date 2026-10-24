import { requireSession } from "@/lib/auth";
import InboxClient from "./inbox-client";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  await requireSession();
  return <InboxClient />;
}
