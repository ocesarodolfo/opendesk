// Hook de boot do Next.js: re-estabelece as sessoes do WhatsApp que estaban
// ativas antes de um restart do processo (o socket vive na memoria do Node).
export async function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NEXT_PHASE !== "phase-production-build"
  ) {
    const { scheduleResume } = await import("@/lib/whatsapp/manager");
    scheduleResume();
  }
}
