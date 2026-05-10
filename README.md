# Medstocksy Inventory Management System

This is a comprehensive inventory management application built with React, TypeScript, and Supabase.

## Features

- Product inventory management
- Sales tracking
- Customer information management
- Google Sign-In authentication
- Responsive design for all devices

## Recent Updates



### April 8, 2026
- **New Billing Cycle**: Introduced **Annual Billing** for the Professional Plan at ₹3,999/year, offering a **33% discount** compared to monthly billing.
- **Pricing Dashboard Upgrade**: Redesigned the Pricing page with a modern Monthly/Annual toggle. Updated the Professional Monthly plan to ₹399 (20% discount) with clear "crossed-out" original prices.
- **Dynamic Payment Logic**: Updated the Razorpay integration and Edge Functions to automatically process the correct amounts and subscription durations (30 vs 365 days) based on user selection.
- **Streamlined UI**: Optimized the plan cards to hide the trial/weekly plan during annual view, keeping the focus on long-term professional options.
- **Signup Compliance Update**: Added a mandatory "I agree with our Terms and Conditions" checkbox below Confirm Password on the registration form. Users cannot create an account until this checkbox is selected.
- **Terms Link Integration**: Connected the signup checkbox text to the Terms page at `/assets/terms.html` (served from `public/assets/terms.html`).
- **Auth UI Polish**: Refined checkbox behavior and alignment in the signup form for a compact control, visible tick state, and proper text alignment.

### April 7, 2026
- **Sales Date Persistence**: Fixed an issue where manual bill date edits were not being correctly saved to the database.
- **Enhanced Billing UI**: Redesigned the "Record Sale" interface with a modern, high-density, minimalist light-green theme. Optimized for 7-8 rows without scrolling to improve billing speed.
- **Improved Keyboard Workflow**: Refined tab navigation to intelligently move between HSN, Rate, and Discount fields within the sales table.
- **Database Stability**: Resolved critical schema errors including missing `bill_id` columns and incorrect property access for WhatsApp settings.

### April 5, 2026
- **CSV Import/Export**: Updated the sample CSV template to include `pcs_per_unit` and other recent schema changes, ensuring seamless bulk product uploads.

### April 2, 2026
- **Navigation Enhancements**: Added a dedicated "Supplier" section to the sidebar to improve the inventory management workflow.

### April 1, 2026
- **Smart CRM Integration**: Implemented a history-based prescription loader in the sales module. Products are now grouped by purchase frequency, allowing for rapid loading of repeat orders.
- **Prescription Logic Refinement**: Fixed the "months taken" tracking to accurately reflect medication cycles (starting from Month 1).
- **New Subscription Model**: Introduced a 7-day "Testing Plan" at Rs 50 to allow users to trial all premium features.

### March 28, 2026
- **Quality of Life**: Improved keyboard navigation in the full-page billing screen. Tab key now jumps correctly from "Quantity" to "Sub-Quantity" for faster billing.

### March 27, 2026
- **Sub-Quantity Support**: Added functionality to manage inventory by tablets/strips. Introduced `pcs_per_unit` (e.g., 10 tablets/strip) to accurately calculate fractional stock levels.
- **Database Schema**: Migrated database to support sub-quantities with automatic stock level adjustments.

### March 23, 2026
- **Billing UI Redesign**: Launched a professional, full-page inline billing interface (`/sales/new`). Includes features like customer auto-fill, global discounts, and streamlined product entry.

### March 11, 2026
- **Mobile Experience**: Optimized all dialogs (Add Product, Return, etc.) to show as full-screen sheets on mobile devices for better accessibility and professional look.

### March 10, 2026
- **Touch Optimization**: Fixed mobile zoom issues and polished UI elements across the application for high-density displays.
- **Authentication**: Resolved Google Auth redirect issues and improved error handling for OAuth flows on Vercel deployments.

## Deployment

This application is deployed on Vercel at app.medstocksy.in

## Technologies Used

- React with TypeScript
- Supabase for backend services
- Tailwind CSS for styling
- Vite for build tooling

## Project Documentation

For team members and developers, please refer to the following guides:

- [**Contributing Guide**](file:///e:/Pivot%20New%20Work/MEsyStock_by_Antigravity/CONTRIBUTING.md): How to set up and submit changes.
- [**Project Rules & Guidelines**](file:///e:/Pivot%20New%20Work/MEsyStock_by_Antigravity/PROJECT_RULES.md): Coding standards and UI/UX principles.
- [**Architecture Overview**](file:///e:/Pivot%20New%20Work/MEsyStock_by_Antigravity/ARCHITECTURE.md): High-level system structure.

