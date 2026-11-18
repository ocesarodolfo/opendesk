# AGENTS.md — Diretrizes de UI, Componentização e Temas

Este arquivo define as regras obrigatórias para qualquer agente ou pessoa que crie ou altere telas e componentes neste projeto (**Central de Atendimento — Ozonteck + WhatsApp**).

---

## 1. Componentização Obrigatória

- **Sempre crie e reutilize componentes** em vez de duplicar marcação ou lógica de interface entre páginas.
  - Componentes globais ficam em `src/components/` (ex.: `modal.tsx`, `toast.tsx`, `icons.tsx`, `push-toggle.tsx`).
  - Componentes específicos de uma rota ficam em `src/app/(app)/<rota>/components/` (ex.: `MessageBubble.tsx`).
- **Nunca use diálogos nativos do browser** (`alert`, `confirm`, `prompt`) para ações importantes: utilize `<Modal>` (`src/components/modal.tsx`) e `showToast` (`src/components/toast.tsx`).
- **Ícones**: utilize `src/components/icons.tsx` (SVG inline com `stroke="currentColor"`), evitando emojis na interface administrativa.
- **Padrão de página interna** dentro de `AppShell` (`src/app/(app)/layout.tsx`):
  ```tsx
  <div>
    <h1 className="text-2xl font-semibold">Título</h1>
    <p className="mt-1 text-sm text-slate-500">Descrição curta da tela.</p>
    <div className="mt-6 space-y-6">{/* conteúdo */}</div>
  </div>
  ```
- **Responsividade**:
  - Toda tabela deve estar dentro de um container com `overflow-x-auto`.
  - Grids de filtros e KPIs devem usar breakpoints (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-...`).

---

## 2. Paleta Oficial (Ozonteck + WhatsApp)

A identidade visual combina a sobriedade tecnológica/institucional da **Ozonteck** (azul + superfícies limpas) com a familiaridade do **WhatsApp** (verde nas mensagens enviadas e tons neutros escuros no dark mode):

| Papel | Tema Claro | Tema Escuro (`html.dark`) |
|---|---|---|
| **Primária / Marca (Ozonteck)** | `bg-sky-600` (`#0284c7`) / hover `sky-700` (`#0369a1`) | `bg-sky-600` / texto `text-sky-600` (`#53bdeb`) / `text-sky-700` (`#7dd3fc`) |
| **Chat / WhatsApp (Envio & Sucesso)** | Bolha `#d9fdd3` (borda `#9fe6c8`), ação `emerald-600` | Bolha `#005c4b` (borda `#0b8a6d`), destaque `#00a884` |
| **Fundo geral (Canvas)** | `bg-slate-100` (`#f1f5f9`) | `#0b141a` |
| **Superfície / Cards / Modais** | `bg-white` (`#ffffff`) | `#111b21` |
| **Superfície elevada / Headers** | `bg-slate-50` (`#f8fafc`) | `#1a242c` |
| **Bolha recebida / Tabs** | `bg-white` / `bg-slate-200` | `#202c33` |
| **Bordas neutras** | `border-slate-200` / `slate-300` | `#2a3942` / `#374854` |

---

## 3. Regras de Tema Claro/Escuro e Contraste (WCAG AA)

O tema escuro é aplicado via classe `html.dark` em `src/app/globals.css`, sobrescrevendo classes utilitárias neutras e semânticas.

1. **Verifique sempre os dois temas (claro e escuro)** antes de finalizar qualquer componente.
2. **Contraste mínimo obrigatório (WCAG AA)**:
   - **4.5:1** para texto normal (`text-xs`, `text-sm`, `text-base`).
   - **3:1** para texto grande, títulos e ícones funcionais.
3. **Use as classes neutras padrão** (`bg-white`, `bg-slate-50`, `bg-slate-100`, `text-slate-900`..`text-slate-500`, `border-slate-100/200/300`) — elas já possuem mapeamento automático em `src/app/globals.css`.
4. **Atenção especial a `text-slate-400` no tema claro**: sobre fundo branco, `text-slate-400` tem contraste baixo; use `text-slate-500` para textos legíveis (subtítulos, rótulos, estados vazios) e reserve `slate-400` apenas para detalhes decorativos.
5. **Classes que NÃO herdam automaticamente no `html.dark`**:
   - Modificadores com opacidade (ex.: `bg-white/85`, `bg-slate-50/60`), variantes de estado (`disabled:bg-...`, `hover:bg-...`) e novas cores semânticas (`bg-*-50`, `bg-*-100`, `text-*-700`).
   - Sempre que usar uma classe dessas fora das já mapeadas, **adicione o override correspondente em `src/app/globals.css`** dentro de `html.dark`.
6. **Campos de formulário (`input`, `textarea`, `select`)**: já têm estilo base para `html.dark` e `:disabled` em `globals.css`; evite forçar cores fixas inline ou classes que quebrem essa herança.
