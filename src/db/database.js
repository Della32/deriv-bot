/**
 * Database — SQLite pra persistir operações, stats, progressão
 */

const Database = require('better-sqlite3');
const path = require('path');

class DB {
  constructor(dbPath) {
    this.dbPath = dbPath || path.join(__dirname, '../../data/bot.db');
    this.db = null;
  }

  init() {
    // Garante que diretório existe
    const dir = path.dirname(this.dbPath);
    const fs = require('fs');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');

    // Cria tabelas
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS operations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        asset TEXT NOT NULL,
        direction TEXT NOT NULL,
        contract_id TEXT,
        entry_price REAL,
        exit_price REAL,
        bet_amount REAL NOT NULL,
        payout_pct REAL,
        profit REAL,
        result TEXT, -- 'WIN', 'LOSS', 'PENDING'
        level INTEGER NOT NULL,
        rsi_value REAL,
        bb_position TEXT,
        ema_cross TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        closed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS daily_stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL UNIQUE,
        total_operations INTEGER DEFAULT 0,
        wins INTEGER DEFAULT 0,
        losses INTEGER DEFAULT 0,
        profit REAL DEFAULT 0,
        max_level_reached INTEGER DEFAULT 1,
        max_win_streak INTEGER DEFAULT 0,
        stopped_reason TEXT
      );

      CREATE TABLE IF NOT EXISTS bot_state (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);

    console.log('[DB] Banco de dados inicializado');
  }

  // === OPERAÇÕES ===

  insertOperation(op) {
    const stmt = this.db.prepare(`
      INSERT INTO operations (asset, direction, contract_id, entry_price, bet_amount, payout_pct, result, level, rsi_value, bb_position, ema_cross)
      VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?)
    `);

    const result = stmt.run(
      op.asset, op.direction, op.contractId, op.entryPrice,
      op.betAmount, op.payoutPct, op.level,
      op.rsiValue, op.bbPosition, op.emaCross
    );

    return result.lastInsertRowid;
  }

  updateOperationResult(id, result, exitPrice, profit) {
    const stmt = this.db.prepare(`
      UPDATE operations SET result = ?, exit_price = ?, profit = ?, closed_at = datetime('now')
      WHERE id = ?
    `);
    stmt.run(result, exitPrice, profit, id);
  }

  getTodayOperations() {
    const stmt = this.db.prepare(`
      SELECT * FROM operations WHERE date(created_at) = date('now') ORDER BY created_at DESC
    `);
    return stmt.all();
  }

  getHourlyOperations(hoursAgo = 1) {
    const stmt = this.db.prepare(`
      SELECT * FROM operations 
      WHERE created_at >= datetime('now', ?) AND result != 'PENDING'
      ORDER BY created_at DESC
    `);
    return stmt.all(`-${hoursAgo} hours`);
  }

  // === DAILY STATS ===

  updateDailyStats(date, stats) {
    const stmt = this.db.prepare(`
      INSERT INTO daily_stats (date, total_operations, wins, losses, profit, max_level_reached, max_win_streak, stopped_reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(date) DO UPDATE SET
        total_operations = ?,
        wins = ?,
        losses = ?,
        profit = ?,
        max_level_reached = MAX(max_level_reached, ?),
        max_win_streak = MAX(max_win_streak, ?),
        stopped_reason = COALESCE(?, stopped_reason)
    `);

    stmt.run(
      date, stats.total, stats.wins, stats.losses, stats.profit, stats.maxLevel, stats.maxStreak, stats.stoppedReason,
      stats.total, stats.wins, stats.losses, stats.profit, stats.maxLevel, stats.maxStreak, stats.stoppedReason
    );
  }

  // === BOT STATE (persistir progressão entre restarts) ===

  saveState(key, value) {
    const stmt = this.db.prepare(`
      INSERT INTO bot_state (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = ?
    `);
    stmt.run(key, JSON.stringify(value), JSON.stringify(value));
  }

  getState(key) {
    const stmt = this.db.prepare('SELECT value FROM bot_state WHERE key = ?');
    const row = stmt.get(key);
    return row ? JSON.parse(row.value) : null;
  }

  // === STATS QUERIES ===

  getOverallStats() {
    const stmt = this.db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN result = 'WIN' THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN result = 'LOSS' THEN 1 ELSE 0 END) as losses,
        SUM(profit) as totalProfit
      FROM operations WHERE result != 'PENDING'
    `);
    return stmt.get();
  }

  close() {
    if (this.db) this.db.close();
  }
}

module.exports = DB;
