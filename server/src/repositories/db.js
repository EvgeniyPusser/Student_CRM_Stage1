import mysql from 'mysql2/promise';
import {readFileSync} from 'node:fs';

const ssl = process.env.DB_TLS === 'true' ? {
  rejectUnauthorized: true,
  verifyIdentity: true,
  ca: process.env.DB_TLS_CA_FILE ? readFileSync(process.env.DB_TLS_CA_FILE) : undefined,
} : undefined;

export const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'crm',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'student_crm',
  connectionLimit: 10,
  maxIdle: 2,
  idleTimeout: 15000,
  timezone: 'Z',
  dateStrings: true,
  multipleStatements: false,
  charset: 'utf8mb4',
  ssl,
});

export const connectionLost = error => ['PROTOCOL_CONNECTION_LOST', 'ECONNRESET', 'EPIPE'].includes(error.code);

export async function rows(db, sql, params = []) {
  try {
    const [result] = await db.execute(sql, params);
    return result;
  } catch (error) {
    if (db !== pool || !connectionLost(error) || !/^SELECT\s/i.test(sql)) throw error;
    const [result] = await db.execute(sql, params);
    return result;
  }
}

export async function transaction(work) {
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const result = await work(db);
    await db.commit();
    return result;
  } catch (error) {
    try {
      await db.rollback();
    } catch {
      db.destroy();
    }
    throw error;
  } finally {
    db.release();
  }
}
