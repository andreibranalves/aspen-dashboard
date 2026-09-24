-- migration-risk: additive
ALTER TABLE sales_orders
  ADD COLUMN production_stage varchar(32) NOT NULL DEFAULT 'aguardando entrada',
  ADD COLUMN stage_changed_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN production_days integer NOT NULL DEFAULT 20,
  ADD COLUMN due_date_override date,
  ADD COLUMN art_approved_date date,
  ADD COLUMN entry_received_date date,
  ADD COLUMN entry_received_amount numeric(20,2),
  ADD COLUMN balance_received_date date,
  ADD COLUMN ready_at timestamptz,
  ADD COLUMN delivered_at timestamptz,
  ADD COLUMN undo_token uuid,
  ADD COLUMN undo_until timestamptz,
  ADD COLUMN undo_snapshot jsonb;

UPDATE sales_orders
SET production_stage = 'entregue',
    delivered_at = updated_at,
    stage_changed_at = updated_at
WHERE status = 'Completed';

UPDATE sales_orders SET delivery_date = NULL WHERE status <> 'Completed';

ALTER TABLE sales_orders
  ADD CONSTRAINT sales_orders_production_stage_check
    CHECK (production_stage IN ('aguardando entrada', 'aguardando arte', 'em produção', 'pronto', 'entregue')),
  ADD CONSTRAINT sales_orders_production_days_check CHECK (production_days BETWEEN 1 AND 365),
  ADD CONSTRAINT sales_orders_entry_amount_check
    CHECK (entry_received_amount IS NULL OR entry_received_amount BETWEEN 0 AND grand_total);

CREATE TABLE sales_order_notes (
  id uuid PRIMARY KEY,
  sales_order_id uuid NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  kind varchar(16) NOT NULL CHECK (kind IN ('note', 'stage')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sales_order_notes_order_created_idx ON sales_order_notes(sales_order_id, created_at);
