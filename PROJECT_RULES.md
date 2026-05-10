# Project Rules & Guidelines - Medstocksy

This document defines the coding standards, UI/UX principles, and architectural constraints for **Medstocksy**. All developers must adhere to these rules to ensure consistency.

## 🛠️ Technology Stack
- **Frontend:** Vite + React + TypeScript
- **Styling:** Tailwind CSS + Vanilla CSS (where needed)
- **UI Components:** Shadcn UI (Radix UI)
- **Data Fetching:** TanStack Query (React Query)
- **Forms:** React Hook Form + Zod
- **Backend:** Supabase (PostgreSQL, Auth, Functions)
- **Icons:** Lucide React

## 📐 Coding Standards

### 1. Typescript
- **No `any`:** Avoid Using `any` at all costs. Define proper interfaces and types.
- **Strict Typing:** All function parameters and return types must be explicitly typed.
- **Schema Validation:** Use Zod for any data coming from external sources or user inputs.

### 2. Components
- **Functional Components:** Use functional components with `const` and arrow functions.
- **Prop Typing:** Use `interface` for props.
- **Component Localization:** Smaller, reusable components should reside in `src/components/ui/` (base components) or `src/components/` (feature components).

### 3. State Management
- **Local State:** Use `useState` or `useReducer` for simple UI states.
- **Server State:** Use `useQuery` and `useMutation` from TanStack Query for all database interactions. **Do not use `useEffect` for data fetching.**
- **Global State:** If needed, use context providers or a lightweight store (like Zustand) sparingly.

### 4. Database Interactions (Supabase)
- **RLS (Row Level Security):** Never bypass RLS. Queries should always be scoped to the authenticated user.
- **Service Role:** Only use the `service_role` key in background scripts or edge functions, never in the frontend.
- **Mutations:** Always provide feedback (toasts) for success or failure using `sonner`.

## 🎨 UI/UX Principles (High Density)
Medstocksy is a productivity tool for pharmacists.
- **High Density:** Maximize screen space. Avoid large margins/paddings that force excessive scrolling.
- **Keyboard First:** All billing and search inputs must be reachable and operable via keyboard (tabs and shortcuts).
- **Fast Feedback:** Use `sonner` for non-intrusive notifications.
- **Color Palette:** Stick to the established "Light Green" theme for a professional pharmaceutical look.

## 📁 File Naming Conventions
- **Components:** PascalCase (e.g., `RecordSale.tsx`)
- **Hooks:** camelCase with `use` prefix (e.g., `useProductSearch.ts`)
- **Utilities:** camelCase (e.g., `formatCurrency.ts`)
- **Constants:** UPPER_SNAKE_CASE (e.g., `MAX_RETRY_COUNT`)

## 🚀 Performance
- **Virtualization:** For large lists (like products or old sales), use `react-window` or `react-virtualized`.
- **Memoization:** Use `useMemo` and `useCallback` for expensive calculations or to prevent unnecessary re-renders of large tables.

---
*Failure to comply with these rules during code review will lead to automatic rejection of pull requests.*
