# Indian Pharmaceutical Wholesale Requirements & Medstocksy Analysis

**Document Status:** Complete Specification & Audit  
**Target Domain:** Indian B2B Pharmaceutical Distribution, C&F, Stockist & Wholesale Chemistry  
**Benchmark Standards:** Drugs & Cosmetics Act 1940, CGST Rules 2017, Marg ERP 9+, Busy Pharma, RetailGraph  

---

## 1. Executive Summary

This specification documents the statutory regulations, commercial trading mechanisms, and operational workflows governing pharmaceutical wholesale distribution in India. It audits Medstocksy's existing wholesale sale (`RecordSale.tsx`) and purchase entry (`MultiProductForm.tsx`) flows, identifies functional and compliance gaps, and provides an implementation roadmap to bring Medstocksy to an enterprise industry-standard level.

---

## 2. Indian Statutory & Legal Requirements

### 2.1 Drugs & Cosmetics Act, 1940 & Rules 1945

#### Wholesale Drug Licenses
* **Form 20B:** License to sell, stock, or exhibit/offer for sale or distribute by wholesale drugs other than those specified in Schedule C and C(1).
* **Form 21B:** Wholesale license for biological and special products specified in Schedule C and Schedule C(1) (e.g., vaccines, sera, antibiotics, vitamins).
* **Form 20G:** Wholesale license for Schedule X substances (psychotropic/narcotic drugs).

#### Mandatory Rule 65 Restrictions
1. **Sales Restricted to Authorized License Holders:**
   * Wholesale licensees may **only** sell to:
     * Retailers holding valid retail drug licenses (Forms 20 / 21).
     * Other wholesalers holding Form 20B / 21B.
     * Registered Medical Practitioners (RMPs) for clinic dispensary use.
     * Government/private hospitals, dispensaries, medical/research institutions.
   * **Legal Invoicing Mandate:** The seller **must** record and print the **Buyer's Drug License Number(s)** and **Expiry Date of License** on every wholesale tax invoice. Sale to an expired license holder constitutes a non-bailable offense under Section 18/27.
2. **Purchase Legality:**
   * Wholesalers may only purchase drugs from licensed manufacturers or registered C&F/distributors.
   * Supplier’s Drug License numbers must be recorded during inward purchase/GRN entry.

#### Controlled Drug Registers
* **Schedule H1 Register (Rule 65(4)(4A)):**
  * Applies to 46 designated drugs (3rd/4th gen cephalosporins, carbapenems, fluoroquinolones, alprazolam, tramadol, zolpidem, etc.).
  * Requires dedicated register tracking:
    * Date of supply
    * Name and address of the licensee/purchaser
    * Name of the drug
    * Batch number
    * Quantity supplied
    * Name of the manufacturer
  * Records must be preserved for at least **3 years** and open for inspection by state Drug Inspectors.
* **Schedule X Record Keeping:**
  * Strict separate accounting; duplicate copy of every invoice retained for **2 years**.
  * Monthly/quarterly reconciliation of stock vs sales.

#### Statutory Invoice Declarations
* **Section 19 Warranty:** Every wholesale drug invoice must print the statutory warranty:
  > *"We hereby certify that the drugs specified in this invoice do not contravene the provisions of Section 18 of the Drugs & Cosmetics Act, 1940 and rules made thereunder."*
* **Storage Warnings:** Cold chain items (2°C–8°C) and temperature-sensitive goods must state required storage conditions on invoice headers and item lines.

### 2.2 FSSAI Regulations
* Wholesalers distributing nutraceuticals, health supplements, infant food, protein powders, and dietary items must possess an active 14-digit FSSAI Wholesale License.
* Seller and Buyer FSSAI numbers must be displayed on invoices containing food category products.

### 2.3 Goods and Services Tax (GST) Compliance

#### Tax Invoice (Rule 46 of CGST Rules)
* **Buyer Details:** Trade Name, Billing Address, Shipping Address, State Code, GSTIN (mandatory for B2B input tax credit pass-through).
* **Consecutive Serial Numbering:** Unique alphanumeric sequence per financial year (max 16 characters).
* **Place of Supply (POS):** 2-digit state code determining tax split:
  * **Intra-state:** CGST + SGST (e.g., Seller 27-Maharashtra to Buyer 27-Maharashtra).
  * **Inter-state:** IGST (e.g., Seller 27-Maharashtra to Buyer 24-Gujarat).
* **HSN Code Standards:**
  * Minimum 4 digits for turnover up to ₹5 Crore.
  * 6 digits for turnover exceeding ₹5 Crore (standard pharma HSNs: `3004` medicaments, `3002` vaccines/sera, `3006` surgicals).
* **Tax Details:** Separate columns for Taxable Value, CGST Rate & Amount, SGST Rate & Amount, IGST Rate & Amount, Total Tax.

#### E-Way Bill (EWB)
* Compulsory when consignment value exceeds ₹50,000 (inter-state) or state-specific threshold (e.g., ₹1,00,000 in Maharashtra).
* Requires: Transporter Name, Transporter ID (GSTIN), Vehicle Number, LR/GR Number, Delivery Distance.

#### E-Invoicing (IRN & Signed QR Code)
* Mandatory for businesses with aggregate turnover exceeding ₹5 Crore.
* Generation of 64-character Invoice Reference Number (IRN) and digitally signed QR code via GST IRP prior to goods dispatch.

#### TCS / TDS on Commercial Transactions
* **Section 206C(1H) TCS:** 0.1% collection on receipt of sale consideration exceeding ₹50 Lakhs from a single buyer in a financial year (if seller turnover > ₹10 Crore).
* **Section 194Q TDS:** 0.1% deduction by buyer on purchases exceeding ₹50 Lakhs.

---

## 3. Commercial & Trade Mechanics (Industry Benchmarks)

Pharma distribution software (Marg ERP 9+, Busy, RetailGraph, SWIL) relies on standardized commercial trade logic:

```
┌─────────────────────────────────────────────────────────────┐
│                 Pharma Pricing Hierarchy                    │
├─────────────────────────────────────────────────────────────┤
│  MRP (Maximum Retail Price - printed on pack)              │
│   ▲                                                         │
│   │ Retailer Margin (16% for DPCO NLEM / 20% decontrolled) │
│  PTR (Price to Retailer - Wholesaler Selling Price)        │
│   ▲                                                         │
│   │ Wholesaler Margin (8% - 10%)                            │
│  PTS (Price to Stockist - Manufacturer Purchase Rate)      │
└─────────────────────────────────────────────────────────────┘
```

### 3.1 Dual-Level Discounts
1. **Trade Discount (TD %):** Item-level promotional discount subtracted from PTR before calculating GST.
2. **Cash Discount (CD %):** Financial discount given on net taxable value (or bill total) if payment is remitted immediately or within a strict credit window (e.g., 2% CD if settled within 7 days).

### 3.2 Volume Schemes & Free Goods
* **Standard Quantity Schemes:** Deals such as `10 + 1`, `100 + 10`, `20 + 2`.
* **Half Scheme / Pro-rata:** If a retailer purchases below the scheme threshold (e.g., buys 5 instead of 10), software converts the free unit into an equivalent cash discount percentage.
* **GST Handling on Free Goods:** Stock quantity decrements by `qty + freeQty`, but taxable value is charged only on `qty * rate` (composite discount method recognized under GST circulars).

### 3.3 Credit Terms & Party Ledgers
* 90%+ of pharma B2B transactions run on credit cycles (typically 15, 21, 30, or 45 days).
* **Credit Limit:** Maximum allowed financial exposure per retailer (warning or hard-stop on billing if exceeded).
* **Credit Days & Grace Period:** Bill due date auto-calculated from invoice date + credit days.
* **Invoice Summary Footer:**
  ```
  Current Bill Amount:   ₹ 12,450.00
  Previous Outstanding:  ₹ 34,200.00
  -----------------------------------
  Total Balance Due:     ₹ 46,650.00
  ```

### 3.4 Packaging Units (UOM Hierarchy)
* Master Carton / Shipper -> Box / Outer -> Strip / Bottle / Vial -> Piece.
* Wholesalers transact in Box and Strip quantities; loose units are rarely sold at wholesale.

### 3.5 Return & Expiry Workflows
* **Salable Returns:** Undamaged goods returned within credit period; generates GST Credit Note.
* **Breakage & Expiry Returns:** Goods expired on shelf or damaged in transit. Handled via special Expiry Credit Notes, routed back to company C&F for credit settlement.

---

## 4. Current Medstocksy Architecture Audit

### 4.1 Wholesale Sale Entry (`RecordSale.tsx` & `SalesBilling.tsx`)
* **Implemented Strengths:**
  * Multi-tab parallel customer billing sessions with localStorage persistence.
  * Dedicated `mode="wholesale"` gate with database RLS policy (`block_wholesale_for_non_subscribers`).
  * Dedicated `wholesale_price` rate selection (falls back to `selling_price` if null).
  * Manual `freeQty` column deducting stock atomically with paid units.
  * Buyer GSTIN input field (`wholesaleGstin`) stored in `sales.wholesale_customer_gstin`.
  * Multi-format invoice printing dialog (A4 Tax Invoice vs 3-inch Thermal).
* **Identified Gaps:**
  1. **No Buyer Drug License Capture:** Missing buyer DL number and DL expiry fields. Violates Rule 65 for wholesale invoices.
  2. **No B2B Customer Master:** Retailers must be typed manually each time. Does not persist Buyer DL, GSTIN, credit limits, or payment terms.
  3. **No Automatic State-Code Matching:** `isInterstate` is a manual checkbox. Should auto-determine CGST/SGST vs IGST from buyer GSTIN prefix.
  4. **No Bill-Level Cash Discount (CD %):** Only supports global percentage discount, lacks dual TD/CD structure.
  5. **No Credit Ledger on Invoice:** Does not display previous balance or total outstanding on print.
  6. **Missing Statutory Certification:** A4 tax invoice print lacks Section 18/19 Drugs Act warranty and buyer DL print lines.

### 4.2 Wholesale Purchase Entry (`MultiProductForm.tsx` & `Suppliers.tsx`)
* **Implemented Strengths:**
  * Fast spreadsheet-style multi-row entry with keyboard navigation.
  * Captures HSN, Batch Number, Expiry Date (MM/YY), Qty, Free Qty, Low Stock alert.
  * Captures MRP, Wholesale Price (PTR), Purchase Rate (PTS), Disc %, GST %.
  * Calculates effective purchase rate taking free goods and discount into account.
  * Atomic RPC backend `record_purchase()` updating stock, prices, and header/item logs.
* **Identified Gaps:**
  1. **Supplier Drug License Missing:** `suppliers` table does not track supplier DL numbers.
  2. **Short-Expiry Inward Guard Missing:** Does not alert if inward medicine expiry is under 6 or 12 months.
  3. **No Bill Sundries / Additional Charges:** Missing freight, handling, TCS (0.1%), and round-off adjustments on the header to match supplier invoice totals.
  4. **No DPCO Margin Indicator:** Does not flag if retailer margin falls below statutory 16% on controlled formulations.

---

## 5. Medstocksy vs Industry Benchmark Comparison

| Functional Area | Medstocksy (Current) | Industry Benchmark (Marg / Busy) | Status / Action Needed |
| :--- | :--- | :--- | :--- |
| **Wholesale Mode Gate** | Full RLS + Plan Check | User permission flag | Complete |
| **Buyer DL Recording** | Missing | Mandatory Form 20B/21B + Expiry date | **Critical Compliance Fix** |
| **Buyer Master (CRM)** | Ad-hoc text name/phone | Registered Retailer Master (DL, GSTIN, Terms) | **High Priority** |
| **State / POS Detection** | Manual toggle | Auto from GSTIN (first 2 digits) | **Quick Win** |
| **Buyer DL on Print** | Missing (Only prints Seller DL) | Prominently printed below Buyer info | **Critical Compliance Fix** |
| **Statutory Warranty** | Missing | Printed Section 18/19 certification text | **Critical Compliance Fix** |
| **Discounts** | Single line discount | Trade Discount (Item) + Cash Discount (Bill) | **Medium Priority** |
| **Scheme Engine** | Manual free qty entry | Auto-calculation (`10+1`, `100+10`, half-deal) | **Medium Priority** |
| **Credit Ledger on Bill**| None | Previous Balance + Current Bill = Total Due | **High Priority** |
| **Schedule H1 Register**| None | Auto-populated H1 sale register report | **Medium Priority** |
| **Purchase Supplier DL** | Missing | Mandatory Supplier DL & GSTIN | **High Priority** |
| **Inward Expiry Guard** | None | Reject / warn if expiry < 6 or 12 months | **Quick Win** |
| **Purchase Sundries** | Net item sum only | Freight, TCS, Other charges, Round-off | **Medium Priority** |

---

## 6. Implementation Roadmap

### Phase 1: Statutory Compliance & Legal Fixes (Immediate)
1. **Schema Migration:**
   * Add `wholesale_customer_dl` and `wholesale_customer_dl_expiry` to `sales`.
   * Add `drug_license` and `gstin` to `customers` and `suppliers`.
2. **Sale Entry Form (`RecordSale.tsx`):**
   * Add Buyer DL input field beside Buyer GSTIN in wholesale mode.
   * Auto-derive `isInterstate` by comparing `wholesaleGstin.slice(0, 2)` against seller `state_code`.
3. **Invoice Print (`PrintBill.tsx`):**
   * Display `Buyer DL: {billData.wholesale_customer_dl}` under Buyer GSTIN.
   * Add statutory Drugs & Cosmetics Act Section 19 warranty declaration in footer.
   * Add FSSAI number display if enabled.

### Phase 2: B2B Customer Master & Credit Tracking
1. **Wholesale Retailer Picker:**
   * Provide auto-complete dropdown in wholesale billing to select from saved B2B customers.
   * Selecting a retailer automatically populates: Trade Name, GSTIN, DL No, Address, Phone, Credit Days.
2. **Credit Balance Integration:**
   * Fetch customer outstanding balance; compute `Total Outstanding = Previous Balance + Net Invoice Amount`.
   * Print balance summary on A4 wholesale invoices.

### Phase 3: Commercial Wholesale Enhancements
1. **Cash Discount (CD %) Calculation:**
   * Add optional CD % input applied on taxable value before GST (or after tax as cash rebate).
2. **Schedule H1 Audit Register:**
   * Add `is_schedule_h1` flag to `products`.
   * Create automated Schedule H1 register report in `WholesaleReports.tsx`.

### Phase 4: Purchase Entry (GRN) Upgrades
1. **Short Expiry Alert in `MultiProductForm.tsx`:**
   * Highlight expiry input in amber if shelf life < 6 months, red if expired.
2. **Bill Sundries on Inward Invoice:**
   * Add fields for Freight/Charges and Round-off in `MultiProductForm.tsx` to match supplier invoice gross.

---

## 7. SQL Database Schema Additions

To support these capabilities, execute the following additive migration:

```sql
BEGIN;

-- 1. Add Wholesale Drug License fields to sales
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS wholesale_customer_dl TEXT,
  ADD COLUMN IF NOT EXISTS wholesale_customer_dl_expiry DATE;

COMMENT ON COLUMN public.sales.wholesale_customer_dl IS
  'Drug License number (Form 20/21 or 20B/21B) of the purchasing chemist/entity. Mandatory under Rule 65.';

-- 2. Add Drug License and B2B fields to customer master
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS drug_license TEXT,
  ADD COLUMN IF NOT EXISTS drug_license_expiry DATE,
  ADD COLUMN IF NOT EXISTS gstin TEXT,
  ADD COLUMN IF NOT EXISTS credit_days INTEGER DEFAULT 21,
  ADD COLUMN IF NOT EXISTS credit_limit NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS customer_type TEXT DEFAULT 'retail';

-- 3. Add Drug License and FSSAI to suppliers
ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS drug_license TEXT,
  ADD COLUMN IF NOT EXISTS fssai_number TEXT;

-- 4. Add Schedule H1 and Cold Chain flags to products
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS schedule_type TEXT DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS storage_condition TEXT DEFAULT 'ambient';

COMMIT;
```
