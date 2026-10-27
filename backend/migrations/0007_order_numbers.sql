-- 0007: friendly order numbers for customer queries ("AMP-1003" instead of
-- the ord_ ID). The ord_ ID stays the primary key and keeps working
-- everywhere internal — this column is display-only.
-- New orders get MAX(order_number)+1 from code (index.ts), starting at
-- 1001 so the number does not advertise how few orders exist yet.
-- Existing orders are backfilled in placed order, oldest first.
ALTER TABLE orders ADD COLUMN order_number INTEGER;
WITH numbered AS (
  SELECT id, 1000 + ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS n
  FROM orders WHERE order_number IS NULL
)
UPDATE orders SET order_number = (SELECT n FROM numbered WHERE numbered.id = orders.id)
WHERE order_number IS NULL;
