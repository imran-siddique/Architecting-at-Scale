-- ShopFlow schema.
--
-- The tree carries the union of what each chapter needs, so every chapter's code still runs
-- against one database. Where a column exists because of a specific chapter, it says so.
--
-- Note what is deliberately absent: there is no index that helps Chapter 1's legacy search
-- route, because a leading-wildcard LIKE cannot use one. Adding one would be the reflex and it
-- would not move the number - see services/monolith/test/full-table-scan.spec.ts.

CREATE TABLE IF NOT EXISTS products (
  id            VARCHAR(36)   NOT NULL PRIMARY KEY,
  title         VARCHAR(255)  NOT NULL,
  description   TEXT          NULL,
  price_cents   INT UNSIGNED  NOT NULL,
  -- Chapter 9: incremented by every write, read alongside the row, and shipped in the
  -- invalidation event. This is what lets a purge older than the cached entry be dropped
  -- instead of applied, which is mandatory once the broker is at-least-once (Chapter 8).
  version       BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS orders (
  id            VARCHAR(36)   NOT NULL PRIMARY KEY,
  customer_id   VARCHAR(36)   NOT NULL,
  total_cents   INT UNSIGNED  NOT NULL,
  status        VARCHAR(32)   NOT NULL DEFAULT 'pending',
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_orders_customer (customer_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS inventory (
  product_id    VARCHAR(36)   NOT NULL PRIMARY KEY,
  on_hand       INT           NOT NULL DEFAULT 0,
  version       BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_inventory_product FOREIGN KEY (product_id) REFERENCES products (id)
) ENGINE=InnoDB;

-- Chapter 8's transactional outbox. An invalidation event is written in the SAME transaction as
-- the row change, then relayed. This closes the "wrote the row, crashed before publishing" gap
-- that otherwise leaves a cache permanently stale.
CREATE TABLE IF NOT EXISTS outbox (
  event_id      VARCHAR(64)   NOT NULL PRIMARY KEY,
  keyspace_name VARCHAR(64)   NOT NULL,
  entity_id     VARCHAR(36)   NOT NULL,
  version       BIGINT UNSIGNED NOT NULL,
  emitted_at    BIGINT UNSIGNED NOT NULL,
  published_at  TIMESTAMP     NULL,
  INDEX idx_outbox_unpublished (published_at, emitted_at)
) ENGINE=InnoDB;

INSERT INTO products (id, title, description, price_cents) VALUES
  ('p-1001', 'Oak Side Table',      'Solid oak side table for the home, 45cm.',  18999),
  ('p-1002', 'Linen Cushion Cover', 'Stonewashed linen cushion cover, 50x50cm.',  2499),
  ('p-1003', 'Ceramic Table Lamp',  'Ceramic table lamp with a fabric shade.',    6499)
ON DUPLICATE KEY UPDATE title = VALUES(title);

INSERT INTO inventory (product_id, on_hand) VALUES
  ('p-1001', 12), ('p-1002', 240), ('p-1003', 31)
ON DUPLICATE KEY UPDATE on_hand = VALUES(on_hand);
