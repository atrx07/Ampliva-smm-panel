import { newId } from './auth';

export async function getBalance(db: D1Database, userId: string): Promise<number> {
  const row = await db
    .prepare('SELECT COALESCE(SUM(amount), 0) AS balance FROM wallet_transactions WHERE user_id = ?')
    .bind(userId)
    .first<{ balance: number }>();
  return Math.round(Number(row?.balance ?? 0) * 100) / 100;
}

/**
 * Appends one ledger entry and returns the new balance.
 * Ledger is append-only; balance_after is stored for audit/debugging.
 */
export async function appendLedger(
  db: D1Database,
  entry: {
    userId: string;
    type: 'topup' | 'order_debit' | 'refund' | 'admin_adjust';
    amount: number;
    refType?: string;
    refId?: string;
    note?: string;
  },
): Promise<number> {
  const current = await getBalance(db, entry.userId);
  const balanceAfter = Math.round((current + entry.amount) * 100) / 100;
  await db
    .prepare(
      `INSERT INTO wallet_transactions (id, user_id, type, amount, balance_after, ref_type, ref_id, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      newId('txn'),
      entry.userId,
      entry.type,
      Math.round(entry.amount * 100) / 100,
      balanceAfter,
      entry.refType ?? null,
      entry.refId ?? null,
      entry.note ?? null,
      new Date().toISOString(),
    )
    .run();
  return balanceAfter;
}
