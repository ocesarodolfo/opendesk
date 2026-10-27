"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export type NumberItem = {
  id: string;
  label: string;
  phone: string | null;
  status: string;
  lastError: string | null;
  sectorId: string | null;
  sectorName: string | null;
  prefixAgent?: boolean;
};

type SectorOption = { id: string; name: string };

const BADGE: Record<string, string> = {
  CONNECTED: "bg-emerald-100 text-emerald-700",
  CONNECTING: "bg-amber-100 text-amber-700",
  DISCONNECTED: "bg-slate-100 text-slate-600",
};

const LABEL: Record<string, string> = {
  CONNECTED: "Conectado",
  CONNECTING: "Conectando...",
  DISCONNECTED: "Desconectado",
};

export default function NumbersClient({
  initialNumbers,
  sectors,
  isAdmin,
}: {
  initialNumbers: NumberItem[];
  sectors: SectorOption[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [numbers, setNumbers] = useState(initialNumbers);
  const [label, setLabel] = useState("");
  const [sectorId, setSectorId] = useState("");
  const [connecting, setConnecting] = useState<NumberItem | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Atualiza badges de status em tempo proximo (conexao cai/reconecta)
  useEffect(() => {
    const timer = setInterval(async () => {
      const res = await fetch("/api/numbers");
      if (res.ok) setNumbers(await res.json());
    }, 8000);
    return () => clearInterval(timer);
  }, []);

  // Enquanto o modal de conexao estiver aberto, acompanha o QR
  useEffect(() => {
    if (!connecting) {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    pollRef.current = setInterval(async () => {
      const res = await fetch(`/api/numbers/${connecting.id}/status`);
      if (!res.ok) return;
      const data = (await res.json()) as { status: string; qrUrl: string | null };
      if (data.status === "CONNECTED") {
        stopPolling();
        setConnecting(null);
        router.refresh();
      } else if (data.qrUrl) {
        setQrUrl(data.qrUrl);
      }
    }, 2000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [connecting, router]);

  function stopPolling() {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  }

  async function createNumber(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/numbers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label, sectorId: sectorId || null }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Nao foi possivel cadastrar o numero.");
      return;
    }
    setLabel("");
    setSectorId("");
    setNumbers(await (await fetch("/api/numbers")).json());
  }

  async function openConnection(item: NumberItem) {
    setError(null);
    setQrUrl(null);
    setConnecting(item);
    await fetch(`/api/numbers/${item.id}/connect`, { method: "POST" });
  }

  async function disconnect(item: NumberItem) {
    if (!confirm(`Desconectar "${item.label}"? Sera necessario escanear um novo QR.`)) return;
    await fetch(`/api/numbers/${item.id}/connect`, { method: "DELETE" });
    setNumbers(await (await fetch("/api/numbers")).json());
  }

  async function remove(item: NumberItem) {
    if (!confirm(`Remover "${item.label}" permanentemente?`)) return;
    await fetch(`/api/numbers/${item.id}`, { method: "DELETE" });
    setNumbers(await (await fetch("/api/numbers")).json());
  }

  // alterna o prefixo "[Nome do atendente]" nas mensagens enviadas por esse numero
  async function togglePrefix(item: NumberItem) {
    const next = { prefixAgent: !item.prefixAgent };
    const res = await fetch(`/api/numbers/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Nao foi possivel alterar o numero.");
      return;
    }
    setNumbers((prev) => prev.map((n) => (n.id === item.id ? { ...n, prefixAgent: next.prefixAgent } : n)));
  }

  return (
    <div className="mt-6">
      {isAdmin && (
        <form onSubmit={createNumber} className="mb-6 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex-1 min-w-[220px]">
            <label className="block text-xs font-medium text-slate-600">Nome/apelido do número</label>
            <input
              required
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Suporte — (11) 99999-0000"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none"
            />
          </div>
          <div className="min-w-[180px]">
            <label className="block text-xs font-medium text-slate-600">Setor responsável</label>
            <select
              value={sectorId}
              onChange={(e) => setSectorId(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none"
            >
              <option value="">— sem setor —</option>
              {sectors.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="rounded-md bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700"
          >
            Cadastrar
          </button>
        </form>
      )}
      {error && <p className="mb-4 rounded bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2">Número</th>
              <th className="px-4 py-2">Telefone</th>
              <th className="px-4 py-2">Setor</th>
              <th className="px-4 py-2">Identificar atendente</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {numbers.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                  Nenhum número cadastrado ainda.
                </td>
              </tr>
            )}
            {numbers.map((item) => (
              <tr key={item.id}>
                <td className="px-4 py-3 font-medium">{item.label}</td>
                <td className="px-4 py-3 text-slate-600">{item.phone ?? "—"}</td>
                <td className="px-4 py-3 text-slate-600">{item.sectorName ?? "—"}</td>
                <td className="px-4 py-3">
                  {isAdmin ? (
                    <label className="flex items-center gap-1.5" title="Prefixa as mensagens do painel com o nome do atendente">
                      <input
                        type="checkbox"
                        checked={item.prefixAgent ?? false}
                        onChange={() => void togglePrefix(item)}
                        className="h-4 w-4"
                      />
                      <span className="text-xs text-slate-600">Identificar</span>
                    </label>
                  ) : (
                    <span className="text-xs text-slate-400">{item.prefixAgent ? "Sim" : "—"}</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BADGE[item.status] ?? ""}`}>
                    {LABEL[item.status] ?? item.status}
                  </span>
                  {item.lastError && (
                    <span className="ml-2 text-xs text-rose-600">{item.lastError}</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    {item.status !== "CONNECTED" ? (
                      <button
                        onClick={() => void openConnection(item)}
                        className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                      >
                        {item.status === "CONNECTING" ? "Ver QR" : "Conectar"}
                      </button>
                    ) : (
                      <button
                        onClick={() => void disconnect(item)}
                        className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                      >
                        Desconectar
                      </button>
                    )}
                    {isAdmin && (
                      <button
                        onClick={() => void remove(item)}
                        className="rounded-md border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50"
                      >
                        Remover
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal de pareamento via QR */}
      {connecting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-6 text-center">
            <h2 className="text-lg font-semibold">Conectar {connecting.label}</h2>
            <p className="mt-1 text-sm text-slate-500">
              Abra o WhatsApp no celular, toque em <b>Dispositivos conectados</b> →{" "}
              <b>Conectar dispositivo</b> e aponte para o QR.
            </p>
            <div className="mx-auto mt-4 flex h-64 w-64 items-center justify-center rounded-md border border-slate-200 bg-white">
              {qrUrl ? (
                <img src={qrUrl} alt="QR Code de pareamento" className="h-60 w-60" />
              ) : (
                <p className="animate-pulse text-sm text-slate-400">Gerando QR Code...</p>
              )}
            </div>
            <button
              onClick={() => {
                stopPolling();
                setConnecting(null);
              }}
              className="mt-4 w-full rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
            >
              Fechar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
