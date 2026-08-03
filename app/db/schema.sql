-- ShopFlow schema at the Chapter 1 state: one database, no versioning, no outbox.
--
-- Note what is missing. There is no index that helps the legacy search route, because a
-- leading-wildcard LIKE cannot use one - see services/monolith/test/full-table-scan.spec.ts.
-- Adding an index here would be the reflex, and it would not move the number.

CREATE TABLE IF NOT EXISTS products (
  id            INT UNSIGNED  NOT NULL AUTO_INCREMENT PRIMARY KEY,
  title         VARCHAR(255)  NOT NULL,
  description   TEXT          NULL,
  price_cents   INT UNSIGNED  NOT NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS orders (
  id            INT UNSIGNED  NOT NULL AUTO_INCREMENT PRIMARY KEY,
  customer_id   INT UNSIGNED  NOT NULL,
  total_cents   INT UNSIGNED  NOT NULL,
  status        VARCHAR(32)   NOT NULL DEFAULT 'pending',
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_orders_customer (customer_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS inventory (
  product_id    INT UNSIGNED  NOT NULL PRIMARY KEY,
  on_hand       INT           NOT NULL DEFAULT 0,
  CONSTRAINT fk_inventory_product FOREIGN KEY (product_id) REFERENCES products (id)
) ENGINE=InnoDB;

INSERT INTO products (title, description, price_cents) VALUES
  ('Oak Side Table',      'Solid oak side table for the home, 45cm.',  18999),
  ('Linen Cushion Cover', 'Stonewashed linen cushion cover, 50x50cm.',  2499),
  ('Ceramic Table Lamp',  'Ceramic table lamp with a fabric shade.',    6499);
