import mysql from 'mysql2/promise';

/**
 * The single MySQL pool the whole monolith shares.
 *
 * `connectionLimit` is the number from Chapter 1's telemetry snapshot, and it is the ceiling
 * the chapter is really about: every route in this process competes for these 500 connections,
 * so one slow query anywhere starves everything. There is no bulkhead, no per-route budget,
 * and no circuit breaker, those arrive in Chapter 7.
 */
export const POOL_SIZE = 500;

export const pool = mysql.createPool({
  host: process.env.MYSQL_HOST ?? '127.0.0.1',
  user: process.env.MYSQL_USER ?? 'root',
  password: process.env.MYSQL_PASSWORD ?? 'shopflow',
  database: process.env.MYSQL_DATABASE ?? 'shopflow',
  waitForConnections: true,
  connectionLimit: POOL_SIZE,
  // Unbounded. A request that cannot get a connection waits forever rather than failing fast,
  // which is how a slow query becomes a total outage instead of a partial one.
  queueLimit: 0,
});

export const db = {
  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    const [rows] = await pool.query(sql, params);
    return rows as T[];
  },
};
