# Medstocksy Architecture Overview

This document provides a high-level overview of the internal structure and architecture of the **Medstocksy** project.

## 📁 Source Code Structure

-   `src/`: Main source code directory.
    -   `assets/`: Images, logos, and global CSS/themes.
    -   `components/`: React components.
        -   `ui/`: Reusable, atomic UI components (Shadcn/Radix).
        -   `features/`: Components specific to a feature (Billing, Inventory, CRM).
    -   `hooks/`: Custom React hooks for business logic.
    -   `lib/`: Library configurations (supabaseClient.ts, utils.ts).
    -   `pages/`: Application views/pages (routed via `react-router`).
    -   `types/`: Centralized TypeScript interfaces and types.
    -   `utils/`: Helper functions, validators, and formatters.
-   `supabase/`: Database configuration.
    -   `functions/`: Supabase Edge Functions (Deno).
    -   `migrations/`: SQL migration files for versioned database schema changes.

## 🏗️ Core Application Flow

### 1. Unified Billing Interface (`RecordSale.tsx`)
This is the "heart" of the application. It uses a high-density table for product entry, a master search bar for rapid item addition, and integrated CRM to pull patient history.

### 2. Data Synchronization (TanStack Query)
-   All data interactions (fetching, updating, and deleting) are handled by TanStack Query.
-   **Mutation Side Effects**: Ensure `queryClient.invalidateQueries()` is called after every DB mutation to keep the UI in sync.

### 3. CRM Integration
The CRM module (`CustomerRelation.tsx`) is designed to track patient history and suggest medication based on their previous purchase frequency.

### 4. Inventory Management (`Products.tsx`)
The inventory module handles stock levels and automatic alerts when stock falls below the threshold. It supports CSV imports for bulk updates.

## ☁️ Backend Architecture (Supabase)

-   **Database**: PostgreSQL with Row Level Security (RLS) enabled on all tables.
-   **Authentication**: Managed by Supabase Auth (Email/OTP).
-   **Storage**: Used for prescription uploads or product imagery (if enabled).
-   **Edge Functions**: Used for processing orders (like Razorpay integration) or sending WhatsApp/SMS notifications.

## 🌐 Deployment & CI/CD
-   **Hosting**: Vercel (Frontend) & Supabase (Backend/Database).
-   **Staging**: A separate Supabase project should be used for testing major migrations before applying them to production.

---
*For specific code-level details, refer to the documentation within each file or the README.md.*
