// Takes a consistent hot-backup snapshot of the live SQLite database using better-sqlite3's
// native .backup() API (safe to run while the app is up and serving requests), then prunes
// old backups beyond RETAIN_DAYS. Intended to run daily via cron on the production server.
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.GATA_DB_PATH || path.join(__dirname, '..', 'db', 'gata.db');
const BACKUP_DIR = process.env.GATA_BACKUP_DIR || path.join(__dirname, '..', 'db', 'backups');
const RETAIN_DAYS = parseInt(process.env.GATA_BACKUP_RETAIN_DAYS, 10) || 14;

fs.mkdirSync(BACKUP_DIR, { recursive: true });

const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
const destPath = path.join(BACKUP_DIR, `gata-${stamp}.db`);

const db = new Database(DB_PATH, { readonly: true });
db.backup(destPath)
  .then(() => {
    db.close();
    console.log(`Backup written: ${destPath}`);

    const cutoff = Date.now() - RETAIN_DAYS * 24 * 60 * 60 * 1000;
    for (const file of fs.readdirSync(BACKUP_DIR)) {
      if (!file.startsWith('gata-') || !file.endsWith('.db')) continue;
      const filePath = path.join(BACKUP_DIR, file);
      if (fs.statSync(filePath).mtimeMs < cutoff) {
        fs.unlinkSync(filePath);
        console.log(`Pruned old backup: ${file}`);
      }
    }
  })
  .catch((err) => {
    db.close();
    console.error('Backup failed:', err);
    process.exit(1);
  });
