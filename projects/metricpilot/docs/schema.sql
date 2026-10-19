-- MetricPilot v2 normalized order table, for documentation/reference.
-- The HTTP service stores datasets as local JSON. analytics.py creates an
-- in-memory SQLite table from the confirmed dataset for each constrained query.
-- *_cents are legacy field names: values are actual currency minor units.
-- currency_scale = 1 for JPY, 100 for CNY/USD/EUR/GBP.
--
-- Dataset metadata (JSON, outside the SQL table):
-- id, name, row_count, date_start, date_end, channels,
-- currency, currency_scale, amount_unit, mapping, source_hash,
-- capabilities {refunds, refund_dates, channel, status},
-- decisions {date_format, duplicate_policy, missing_refund, missing_channel,
--            invalid_rows, assume_no_refunds, excluded_rows, duplicate_rows,
--            parsing, notices}.
--
-- Import enforces unique IDs, strict day-only dates, nonnegative amounts,
-- refund <= gross, required positive-refund dates when mapped, one currency,
-- and safe integer bounds on both individual amounts and totals.
-- Missing refund mapping => refund_cents IS NULL unless no-refunds confirmed.

CREATE TABLE orders (
  order_id TEXT,
  order_date TEXT,
  gross_cents INTEGER,
  refund_cents INTEGER,
  refund_date TEXT,
  channel TEXT,
  status TEXT,
  source_row INTEGER
);

-- source_row is the starting physical line of the original CSV record.
-- Query parameters: explicit inclusive [start,end], dimension summary/channel,
-- optional exact channel, confirmed refund basis, cancellation rule/values.
-- User values are always bound parameters; query identifiers use fixed enums.
-- No API accepts arbitrary SQL.
