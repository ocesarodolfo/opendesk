// ---------------------------------------------------------------------------
// Limpeza dos efeitos do bug "conversa consigo mesmo" (Baileys 6.7):
// 1) copias das mensagens que o atendente manda pelo celular chegam com
//    remoteJid = LID do contato e, sem o match por jid, criavam contato +
//    conversa DUPLICADOS para cada chat (o dup tem o pushName do atendente,
//    ex.: "Rodolfo Cesar" com tritazos de LID no telefone).
// 2) contatos self proprios: phone = digitos do próprio numero (PN ou LID,
//    lidos de sessions/<id>/creds.json).
// 3) artefatos com jid @lid e telefone = digitos do proprio LID sem NENHUMA
//    mensagem recebida (sao copias/identidades do próprio numero).
// 4) pushName poluido: copias fromMe trazem pushName = nome do atendente.
//
// O que cada fase faz:
// - fase 1: move as mensagens da conversa duplicada para a conversa aberta
//   do contato "real" (mesmo jid) e apaga o contato duplicado.
// - fase 2: apaga contatos com phone = digitos do próprio numero.
// - fase 3: apaga contatos @lid cujo telefone sao os proprios digitos do jid
//   e que so tem mensagens OUTGOING (nunca falou com a empresa).
// - fase 4: zera pushName igual ao nome do atendente em contatos reais.
//
// Imprime tudo antes de alterar. Rodar com o servidor aberto ou fechado.
// ---------------------------------------------------------------------------
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";

const prisma = new PrismaClient();

function digitsOnly(v) {
  return String(v ?? "").replace(/\D/g, "");
}

function normJid(jid) {
  if (!jid || !jid.includes("@")) return null;
  return `${jid.split("@")[0].split(":")[0]}@${jid.split("@")[1]}`;
}

async function findPersona() {
  const numbers = await prisma.whatsAppNumber.findMany();
  const personas = [];
  for (const n of numbers) {
    let name = null;
    const credsPath = path.resolve("sessions", n.id, "creds.json");
    if (fs.existsSync(credsPath)) {
      try {
        const me = JSON.parse(fs.readFileSync(credsPath, "utf8"))?.me ?? {};
        personas.push({
          numberId: n.id,
          name: me.name ?? null,
          selfDigits: [
            digitsOnly(n.jid?.split("@")[0] || ""),
            String(n.phone ?? ""),
            digitsOnly((me.jid || (me.id || "").endsWith("@s.whatsapp.net") ? me.jid || me.id : "").split("@")[0] || ""),
            digitsOnly(((me.lid || (me.id || "").endsWith("@lid") ? me.lid || me.id : "") || "").split("@")[0].split(":")[0]),
          ].filter(Boolean),
        });
        name = me.name ?? null;
      } catch {
        /* creds ilegivel: segue com o que ha no banco */
      }
    }
  }
  return personas;
}

try {
  // ---------------------------------------------------------------
  // FASE 1 - merge de contatos duplicados por jid
  // ---------------------------------------------------------------
  const withJid = await prisma.contact.findMany({
    where: { jid: { not: null }, isGroup: false },
    include: { conversations: { include: { messages: { select: { id: true, externalId: true, direction: true } } } } },
  });

  const groupsByJid = new Map();
  for (const c of withJid) {
    const key = normJid(c.jid);
    if (!key) continue;
    if (!groupsByJid.has(key)) groupsByJid.set(key, []);
    groupsByJid.get(key).push(c);
  }

  let mergedContacts = 0;
  let movedMessages = 0;
  let movedConvs = 0;

  for (const [key, twins] of groupsByJid) {
    if (twins.length < 2) continue;
    const jidDigits = digitsOnly(key.split("@")[0]);
    // "real" = o contato cujo telefone NAO sao os proprios digitos do LID
    const sorted = [...twins].sort(
      (a, b) => (a.phone === jidDigits ? 1 : 0) - (b.phone === jidDigits ? 1 : 0) || a.createdAt - b.createdAt
    );
    const keep = sorted[0];
    for (const dup of sorted.slice(1)) {
      for (const conv of dup.conversations) {
        // alvo: conversa aberta/pendente do contato real no MESMO numero
        const target =
          (await prisma.conversation.findFirst({
            where: {
              whatsappNumberId: conv.whatsappNumberId,
              contactId: keep.id,
              status: { in: ["PENDING", "OPEN"] },
            },
            orderBy: { lastMessageAt: "desc" },
          })) ??
          (await prisma.conversation.findFirst({
            where: { whatsappNumberId: conv.whatsappNumberId, contactId: keep.id },
            orderBy: { lastMessageAt: "desc" },
          }));

        if (target && target.id !== conv.id) {
          const dlg = await prisma.message.updateMany({
            where: { conversationId: conv.id },
            data: { conversationId: target.id },
          });
          movedMessages += dlg.count;
          await prisma.conversation.delete({ where: { id: conv.id } });
        } else {
          // contato real sem conversa: a conversa fica apontando pro real
          await prisma.conversation.update({ where: { id: conv.id }, data: { contactId: keep.id } });
        }
        movedConvs += 1;
      }
      console.log(
        `> merge por jid ${key}: contato dup "${dup.phone}" (${dup.name || dup.pushName || "-"}) -> "${keep.phone}" (${keep.name || keep.pushName || "-"})`
      );
      await prisma.contact.delete({ where: { id: dup.id } });
      mergedContacts += 1;
    }
  }
  console.log(`Fase 1 concluida: contatos mesclados=${mergedContacts}, conversas=${movedConvs}, mensagens movidas=${movedMessages}`);

  // ---------------------------------------------------------------
  // FASE 2 - contatos com phone = digitos do próprio numero
  // ---------------------------------------------------------------
  let removedSelf = 0;
  for (const p of await findPersona()) {
    for (const d of p.selfDigits) {
      const contacts = await prisma.contact.findMany({ where: { phone: d, isGroup: false } });
      for (const c of contacts) {
        console.log(`> contato self (phone=${c.phone}, jid=${c.jid ?? "-"}) removido (cascata: conversas + mensagens)`);
        await prisma.contact.delete({ where: { id: c.id } });
        removedSelf += 1;
      }
    }
  }
  console.log(`Fase 2 concluida: contatos self removidos=${removedSelf}`);

  // ---------------------------------------------------------------
  // FASE 3 - artefatos @lid com phone = digitos do proprio jid e
  //          nenhuma mensagem recebida (so copias outgoing)
  // ---------------------------------------------------------------
  let removedLidArtifacts = 0;
  const lidContacts = await prisma.contact.findMany({
    where: { isGroup: false, jid: { endsWith: "@lid" } },
    include: { conversations: { select: { id: true, messages: { select: { direction: true } } } } },
  });
  for (const c of lidContacts) {
    const jidDigits = digitsOnly(normJid(c.jid)?.split("@")[0] || "");
    const allOutgoing =
      c.conversations.length > 0 && c.conversations.every((v) => v.messages.length > 0 && v.messages.every((m) => m.direction === "OUTGOING"));
    if (jidDigits && c.phone === jidDigits && allOutgoing) {
      console.log(`> artefato LID removido: phone=${c.phone} push=${c.pushName ?? "-"} (${c.conversations.length} conversa(s), todas OUTGOING)`);
      await prisma.contact.delete({ where: { id: c.id } });
      removedLidArtifacts += 1;
    }
  }
  console.log(`Fase 3 concluida: artefatos LID removidos=${removedLidArtifacts}`);

  // ---------------------------------------------------------------
  // FASE 4 - pushName poluido (= nome do atendente) em contatos reais
  // ---------------------------------------------------------------
  const personas2 = await findPersona();
  const ownNames = new Set(personas2.map((p) => p.name).filter(Boolean));
  let cleared = 0;
  if (ownNames.size) {
    const polluted = await prisma.contact.findMany({
      where: { isGroup: false, pushName: { in: [...ownNames] } },
      select: { id: true, pushName: true, name: true },
    });
    for (const c of polluted) {
      console.log(`> pushName "${c.pushName}" zerado no contato ${c.id} (${c.name || "-"}): era poluição da copia fromMe`);
      await prisma.contact.update({ where: { id: c.id }, data: { pushName: null } });
      cleared += 1;
    }
  }
  console.log(`Fase 4 concluida: pushNames limpos=${cleared}`);

  console.log("\nLimpeza concluida.");
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
