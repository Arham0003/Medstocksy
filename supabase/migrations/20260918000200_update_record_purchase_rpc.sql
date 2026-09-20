-- Migration: update_record_purchase_rpc
--
-- Recreates record_purchase() from 20260723000000 with `wholesale_price`
-- threaded through in three places: the purchase_items insert, the products
-- update, and the products insert. No other logic changes - all stock and
-- free_qty arithmetic is byte-for-byte the original.
--
-- The UPDATE uses COALESCE so a later purchase that leaves W.Price blank does
-- NOT wipe the price already set on the product - matching how `category` and
-- `manufacturer` are treated in the same statement.

CREATE OR REPLACE FUNCTION record_purchase(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id uuid;
  v_supplier_id uuid;
  v_purchase_header_id uuid;
  item jsonb;
BEGIN
  -- Extract basic info
  v_account_id := (payload->>'account_id')::uuid;
  v_supplier_id := (payload->>'supplier_id')::uuid;

  -- Insert purchase header
  INSERT INTO purchase_headers (
    account_id,
    supplier_id,
    supplier_name,
    invoice_number,
    invoice_date,
    due_date
  ) VALUES (
    v_account_id,
    v_supplier_id,
    payload->>'supplier_name',
    payload->>'invoice_number',
    (payload->>'invoice_date')::date,
    (payload->>'due_date')::date
  ) RETURNING id INTO v_purchase_header_id;

  -- Loop through items
  FOR item IN SELECT * FROM jsonb_array_elements(payload->'items')
  LOOP
    -- Insert purchase item
    INSERT INTO purchase_items (
      purchase_header_id,
      name,
      hsn,
      batch,
      expiry,
      qty,
      pcs_per_unit,
      free_qty,
      mrp,
      purchase_rate,
      discount_pct,
      gst_pct,
      wholesale_price
    ) VALUES (
      v_purchase_header_id,
      item->>'name',
      item->>'hsn_code',
      item->>'batch_number',
      (item->>'expiry_date')::date,
      (item->>'qty')::numeric,
      (item->>'pcs_per_unit')::integer,
      (item->>'freeQty')::numeric,
      (item->>'mrpNum')::numeric,
      (item->>'rateNum')::numeric,
      (item->>'discPct')::numeric,
      (item->>'gstRate')::numeric,
      (item->>'wholesale_price')::numeric
    );

    -- Upsert product stock (match on name and batch)
    UPDATE products
    SET
      quantity = quantity + (item->>'qty')::numeric + (item->>'freeQty')::numeric,
      purchase_price = (item->>'purchase_price')::numeric,
      selling_price = (item->>'mrpNum')::numeric,
      gst = (item->>'gstRate')::numeric,
      supplier = payload->>'supplier_name',
      supplier_id = v_supplier_id,
      category = COALESCE(item->>'category', category),
      manufacturer = COALESCE(item->>'manufacturer', manufacturer),
      low_stock_threshold = (item->>'lowStockNum')::integer,
      pcs_per_unit = COALESCE((item->>'pcs_per_unit')::integer, pcs_per_unit),
      -- Blank W.Price on a later invoice must not clear the price already set.
      wholesale_price = COALESCE((item->>'wholesale_price')::numeric, wholesale_price)
    WHERE account_id = v_account_id
      AND name = item->>'name'
      AND COALESCE(batch_number, '') = COALESCE(item->>'batch_number', '');

    IF NOT FOUND THEN
      -- Insert product stock
      INSERT INTO products (
        account_id,
        name,
        hsn_code,
        batch_number,
        expiry_date,
        quantity,
        pcs_per_unit,
        purchase_price,
        selling_price,
        gst,
        supplier,
        supplier_id,
        category,
        manufacturer,
        low_stock_threshold,
        wholesale_price
      ) VALUES (
        v_account_id,
        item->>'name',
        item->>'hsn_code',
        item->>'batch_number',
        (item->>'expiry_date')::date,
        (item->>'qty')::numeric + (item->>'freeQty')::numeric,
        (item->>'pcs_per_unit')::integer,
        (item->>'purchase_price')::numeric,
        (item->>'mrpNum')::numeric,
        (item->>'gstRate')::numeric,
        payload->>'supplier_name',
        v_supplier_id,
        item->>'category',
        item->>'manufacturer',
        (item->>'lowStockNum')::integer,
        (item->>'wholesale_price')::numeric
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'purchase_header_id', v_purchase_header_id);
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Failed to record purchase: %', SQLERRM;
END;
$$;
