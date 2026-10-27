"use client";

// ---------------------------------------------------------------------------
// Sons de notificação de nova mensagem (sintetizados, sem arquivos externos) +
// preferencias persistidas no localStorage. Compartilhado entre o inbox
// (toca) e o menu do perfil (configura) via evento custom no window.
// ---------------------------------------------------------------------------

export const SOUND_EVENT = "atende_sound_change";

export type SoundName = "classico" | "ping" | "campainha" | "pop";

export const SOUND_OPTIONS: { value: SoundName; label: string }[] = [
  { value: "classico", label: "Clássico" },
  { value: "ping", label: "Ping" },
  { value: "campainha", label: "Campainha" },
  { value: "pop", label: "Pop" },
];

export function getMute(): boolean {
  try {
    return localStorage.getItem("atende_mute") === "1";
  } catch {
    return false;
  }
}

export function getSound(): SoundName {
  try {
    const v = localStorage.getItem("atende_sound");
    return (SOUND_OPTIONS.find((o) => o.value === v)?.value ?? "classico") as SoundName;
  } catch {
    return "classico";
  }
}

export function setMute(value: boolean): void {
  try {
    localStorage.setItem("atende_mute", value ? "1" : "0");
  } catch {
    /* armazenamento indisponivel */
  }
  window.dispatchEvent(new CustomEvent(SOUND_EVENT));
}

export function setSound(name: SoundName): void {
  try {
    localStorage.setItem("atende_sound", name);
  } catch {
    /* armazenamento indisponivel */
  }
  window.dispatchEvent(new CustomEvent(SOUND_EVENT));
  playSound(name); // pre-listen ao trocar
}

export function playSound(name: string): void {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    void ctx.resume();
    const t0 = ctx.currentTime;
    const beep = (
      freq: number,
      at: number,
      dur: number,
      type: OscillatorType = "sine",
      vol = 0.06
    ) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(vol, t0 + at);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0 + at);
      osc.stop(t0 + at + dur);
    };
    switch (name) {
      case "ping":
        beep(880, 0, 0.12);
        beep(1320, 0.12, 0.16);
        break;
      case "campainha":
        beep(784, 0, 0.5, "triangle", 0.05);
        beep(1046, 0.02, 0.5, "triangle", 0.035);
        break;
      case "pop":
        beep(300, 0, 0.07, "square", 0.045);
        beep(240, 0.1, 0.07, "square", 0.045);
        break;
      default: // classico
        beep(880, 0, 0.35);
    }
    setTimeout(() => void ctx.close(), 900);
  } catch {
    /* ambiente sem suporte a audio */
  }
}
