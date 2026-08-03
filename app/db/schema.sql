-- ShopFlow schema at the Chapter 9 state.
--
-- `version` on every cacheable row is what makes Chapter 9's invalidation safe: an event
-- carries the version the write produced, and a purge older than the cached entry is dropped
-- rather than applied. Without it, out-of-order delivery on an at-least-once broker evicts
-- newer values.

CREATE TABLE IF NOT EXISTS products (
  id            VARCHAR(36)   NOT NULL PRIMARY KEY,
  title         VARCHAR(255)  NOT NULL,
  description   TEXT          NULL,
  price_cents   INT UNSIGNED  NOT NULL,
  -- Incremented by every write. Read alongside the row and shipped in the event.
  version       BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS inventory (
  product_id    VARCHAR(36)   NOT NULL PRIMARY KEY,
  on_hand       INT           NOT NULL DEFAULT 0,
  version       BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_inventory_product FOREIGN KEY (product_id) REFERENCES products (id)
) ENGINE=InnoDB;

-- The transactional outbox from Chapter 8. An invalidation event is written in the SAME
-- transaction as the row change, then relayed. This is what stops the "wrote the row, crashed
-- before publishing" gap that makes a cache permanently stale.
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
  ('p-1001', 'Oak Side Table',        'Solid oak, 45cm.',            18999),
  ('p-1002', 'Linen Cushion Cover',   'Stonewashed linen, 50x50cm.',  2499),
  ('p-1003', 'Ceramic Table Lamp',    'Matte glaze, fabric shade.',   6499)
ON DUPLICATE KEY UPDATE title = VALUES(title);

INSERT INTO inventory (product_id, on_hand) VALUES
  ('p-1001', 12), ('p-1002', 240), ('p-1003', 31)
ON DUPLICATE KEY UPDATE on_hand = VALUES(on_hand);
