// Run with: node tools/fix-embeddings.js
const fs = require('fs');
const path = require('path');
const os = require('os');
const BetterSqlite3 = require('better-sqlite3');

// Find the database path
const userDataPath = path.join(os.homedir(), 'Library', 'Application Support', 'opal');
const dbPath = path.join(userDataPath, 'opal.db');

console.log(`Looking for database at: ${dbPath}`);

if (!fs.existsSync(dbPath)) {
  console.error('Database file not found!');
  process.exit(1);
}

// Create a backup
const backupPath = `${dbPath}.backup-${Date.now()}`;
fs.copyFileSync(dbPath, backupPath);
console.log(`Created backup at: ${backupPath}`);

// Connect to the database
const db = new BetterSqlite3(dbPath);
console.log('Connected to database');

// Create the backup table
db.exec(`
  CREATE TABLE IF NOT EXISTS embeddings_backup (
    item_id TEXT PRIMARY KEY,
    embedding_data TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);
console.log('Created backup table');

// Get all embeddings from the main table
const embeddings = db.prepare(`
  SELECT i.id, a.embedding 
  FROM items i
  JOIN ai_metadata a ON i.id = a.item_id
  WHERE i.type = 'note' AND a.embedding IS NOT NULL
`).all();

console.log(`Found ${embeddings.length} embeddings in main table`);

// Migrate embeddings to the backup table
let migrated = 0;
for (const row of embeddings) {
  try {
    // Check if it's already base64
    let base64Data;
    try {
      // Try to parse as JSON first
      JSON.parse(row.embedding);
      // If it parses, it's not base64 yet, so encode it
      base64Data = Buffer.from(row.embedding).toString('base64');
    } catch (e) {
      // If parsing fails, it might already be base64
      base64Data = row.embedding;
    }
    
    db.prepare(`
      INSERT OR REPLACE INTO embeddings_backup (item_id, embedding_data)
      VALUES (?, ?)
    `).run(row.id, base64Data);
    
    migrated++;
  } catch (error) {
    console.error(`Error migrating embedding for ${row.id}:`, error.message);
  }
}

console.log(`Migrated ${migrated} embeddings to backup table`);

// Fix the ai_metadata table
try {
  // Remove all embeddings from main table first
  db.exec(`UPDATE ai_metadata SET embedding = NULL`);
  console.log('Cleared embeddings from main table');
  
  // Re-add them from the backup table
  const backupRows = db.prepare(`SELECT item_id, embedding_data FROM embeddings_backup`).all();
  console.log(`Found ${backupRows.length} embeddings in backup table to restore`);
  
  let restored = 0;
  for (const row of backupRows) {
    try {
      db.prepare(`
        UPDATE ai_metadata 
        SET embedding = ? 
        WHERE item_id = ?
      `).run(row.embedding_data, row.item_id);
      restored++;
    } catch (error) {
      console.error(`Error restoring embedding for ${row.item_id}:`, error.message);
    }
  }
  
  console.log(`Restored ${restored} embeddings to main table`);
} catch (error) {
  console.error('Error fixing ai_metadata table:', error.message);
}

// Clean up the vector index if it exists
try {
  const hasVectorIndex = db.prepare(`
    SELECT name FROM sqlite_master 
    WHERE type='table' AND name='vector_index'
  `).get();
  
  if (hasVectorIndex) {
    console.log('Found vector_index table, clearing it');
    db.exec(`DELETE FROM vector_index`);
    console.log('Cleared vector_index table');
  }
} catch (error) {
  console.error('Error cleaning vector index:', error.message);
}

console.log('Done!');
db.close();
console.log('Database connection closed');
console.log('\nNext steps:');
console.log('1. Restart your application');
console.log('2. Go to Settings and use the "Fix Related Notes" button'); 