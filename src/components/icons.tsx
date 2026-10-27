"use client";

// Icones inline (SVG, stroke) — nada de emojis na interface.
// Uso: <Icon.Nome className="h-4 w-4" /> ou componentes soltos abaixo.
import type { ReactNode, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Base({ children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      {children}
    </svg>
  );
}

export function IconBell(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </Base>
  );
}

export function IconBellOff(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M8.7 3A6 6 0 0 1 18 8c0 2.5.6 4.5 1.3 6" />
      <path d="M6.3 6.3C6.1 6.8 6 7.4 6 8c0 7-3 9-3 9h14" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      <path d="M2 2l20 20" />
    </Base>
  );
}

export function IconSun(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </Base>
  );
}

export function IconMoon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
    </Base>
  );
}

export function IconMonitor(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </Base>
  );
}

export function IconUser(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5" />
    </Base>
  );
}

export function IconUsers(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="9" cy="8" r="4" />
      <path d="M2 21c1.3-3.5 4-5 7-5s5.7 1.5 7 5" />
      <path d="M16 3.5a4 4 0 0 1 0 9M18.5 16c1.7.8 3 2.2 3.5 5" />
    </Base>
  );
}

export function IconPaperclip(props: IconProps) {
  return (
    <Base {...props}>
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 17.66 8.6l-8.58 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </Base>
  );
}

export function IconBolt(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" />
    </Base>
  );
}

export function IconPencil(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3Z" />
    </Base>
  );
}

export function IconTrash(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6" />
    </Base>
  );
}

export function IconFile(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z" />
      <path d="M14 2v6h6" />
    </Base>
  );
}

export function IconBan(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M5.6 5.6 18.4 18.4" />
    </Base>
  );
}

export function IconPlus(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 5v14M5 12h14" />
    </Base>
  );
}

export function IconX(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M18 6 6 18M6 6l12 12" />
    </Base>
  );
}

export function IconDownload(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
    </Base>
  );
}

export function IconCheckCircle(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.2 2.4 2.4 4.6-4.8" />
    </Base>
  );
}

export function IconWarnTriangle(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M10.3 3.6 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4M12 17h.01" />
    </Base>
  );
}

export function IconComment(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.5 8.5 0 1 1 16.1-3.8Z" />
    </Base>
  );
}

export function IconCheckboxOn(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="m8.5 12.2 2.4 2.4 4.6-4.8" />
    </Base>
  );
}

export function IconCheckboxOff(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="3" y="3" width="18" height="18" rx="3" />
    </Base>
  );
}

export function IconStar(props: IconProps) {
  return (
    <Base {...props}>
      <path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.9L12 17.8 5.8 21.1 7 14.2l-5-4.9 6.9-1L12 2Z" />
    </Base>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <Base {...props}>
      <path d="m5 13 4.5 4.5L19.5 7" />
    </Base>
  );
}

export function IconForward(props: IconProps) {
  return (
    <Base {...props}>
      <path d="m15 5 4 4-4 4" />
      <path d="M19 9H9a4 4 0 0 0-4 4v6" />
    </Base>
  );
}

export function IconClock(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Base>
  );
}

export function IconSmile(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 14c1 1.6 2.1 2.3 3.5 2.3s2.5-.7 3.5-2.3" />
      <path d="M9 9.5h.01M15 9.5h.01" strokeWidth="2.6" />
    </Base>
  );
}
