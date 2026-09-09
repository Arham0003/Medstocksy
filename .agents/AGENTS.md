# Medstocksy Agent Rules

## Stack
Vite, React, TypeScript, Tailwind, Shadcn, TanStack Query, Zod, Supabase.
Routing: React Router v6.

## Code
- TS: No `any`. Strict types.
- UI: Functional components. `src/components/ui/` for base.
- Structure: Route-level components in `src/pages/`. Reusable logic in `src/hooks/`.
- State: `useState` for UI. TanStack Query for DB. No `useEffect` data fetch.

## Database (Supabase)
- RLS always. No `service_role` frontend.
- Post-mutation: `queryClient.invalidateQueries()`.
- Feedback: `sonner` toasts.

## UI/UX
- High density. Keyboard first.
- Colors: Clean geometry. Deep green for primary actions, soft indigo/violet for subtle accents and active states.
- Virtualize large lists (`react-window`).

## Ponytail (Lazy)
- YAGNI. Reuse existing code. Native/stdlib first.
- No new dependencies if native works. 
- Fix root cause, not symptom. Short diff. One line if possible.
