-- Reference schema matching app.seed_database(). All source rows are synthetic.
CREATE TABLE products (
  product_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  unit_price_cents INTEGER NOT NULL
);
CREATE TABLE orders (
  order_id TEXT PRIMARY KEY,
  order_date TEXT NOT NULL,
  product_id TEXT NOT NULL REFERENCES products,
  channel TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  unit_price_cents INTEGER NOT NULL,
  refund_cents INTEGER NOT NULL CHECK(refund_cents >= 0)
);
CREATE INDEX orders_date ON orders(order_date);
