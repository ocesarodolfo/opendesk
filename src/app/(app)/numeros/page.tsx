import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import NumbersClient from "./numbers-client";

export const dynamic = "force-dynamic";

export default async function NumbersPage() {
  const session = await requireSession();
  const [numbers, sectors] = await Promise.all([
    prisma.whatsAppNumber.findMany({
      orderBy: { createdAt: "asc" },
      include: { sector: true },
    }),
    prisma.sector.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);

  const numbersDto = numbers.map((n) => ({
    id: n.id,
    label: n.label,
    phone: n.phone,
    status: n.status,
    lastError: n.lastError,
    sectorId: n.sectorId,
    sectorName: n.sector?.name ?? null,
    prefixAgent: n.prefixAgent,
  }));

  const sectorsDto = sectors.map((s) => ({ id: s.id, name: s.name }));

  return (
    <div>
      <h1 className="text-2xl font-semibold">Números WhatsApp</h1>
      <p className="mt-1 text-sm text-slate-500">
        Cadastre os números da empresa, vincule-os a um setor e conecte-os via QR Code.
      </p>
      <div className="mt-6">
        <NumbersClient initialNumbers={numbersDto} sectors={sectorsDto} isAdmin={session.role === "ADMIN"} />
      </div>
    </div>
  );
}
