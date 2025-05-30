CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,  -- UUID as TEXT
    type TEXT NOT NULL CHECK( type IN ('folder', 'file', 'note') ),
    path TEXT NOT NULL UNIQUE,
    parent_path TEXT,
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    size INTEGER,
    FOREIGN KEY (parent_path) REFERENCES items(path)
        ON UPDATE CASCADE  -- Crucial for renaming/moving folders
        ON DELETE RESTRICT -- Prevent deleting folders with children
);

CREATE TABLE IF NOT EXISTS notes (
    item_id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
);

-- New table for embedded items
CREATE TABLE IF NOT EXISTS embedded_items (
    id TEXT PRIMARY KEY,  -- UUID for the embedding
    note_id TEXT NOT NULL,  -- The note containing this embedded item
    embedded_item_id TEXT NOT NULL,  -- The item that is embedded
    position_in_note TEXT,  -- JSON field to store positioning info
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (note_id) REFERENCES items(id) ON DELETE CASCADE,
    FOREIGN KEY (embedded_item_id) REFERENCES items(id) ON DELETE CASCADE
);

DROP TABLE IF EXISTS ai_metadata;

CREATE TABLE IF NOT EXISTS ai_metadata (
    item_id TEXT PRIMARY KEY,
    summary TEXT,
    tags TEXT,  -- Consider a separate tags table later if needed
    embedding TEXT,  -- Storing JSON text representation of embeddings
    FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
);

-- Ensure the column has a large enough capacity
PRAGMA main.page_size = 32768;  -- 32 KB page size
PRAGMA main.cache_size = 10000; -- 10000 pages in memory

CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,  -- UUID
    role TEXT NOT NULL CHECK( role IN ('user', 'assistant') ),
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    conversation_id TEXT NOT NULL,  -- Group messages by conversation
    sequence INTEGER NOT NULL  -- Order within conversation
);

CREATE INDEX IF NOT EXISTS idx_items_path ON items (path);
CREATE INDEX IF NOT EXISTS idx_items_parent_path ON items (parent_path);
CREATE INDEX IF NOT EXISTS idx_items_type ON items (type);
CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation ON chat_messages (conversation_id, sequence);

-- FTS5 setup (for full-text search)
CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(content, summary, content=notes, content_rowid=item_id);

-- Drop existing triggers first
DROP TRIGGER IF EXISTS notes_ai;
DROP TRIGGER IF EXISTS notes_ad;
DROP TRIGGER IF EXISTS notes_au;
DROP TRIGGER IF EXISTS ai_metadata_ai;
DROP TRIGGER IF EXISTS ai_metadata_au;
DROP TRIGGER IF EXISTS ai_metadata_ad;

-- Create triggers
-- CREATE TRIGGER notes_ai AFTER INSERT ON notes BEGIN
--     INSERT INTO items_fts(rowid, content, summary)
--     SELECT new.item_id, new.content, ai_metadata.summary
--     FROM ai_metadata
--     WHERE ai_metadata.item_id = new.item_id;
-- END;

-- After delete from notes
-- CREATE TRIGGER notes_ad AFTER DELETE ON notes BEGIN
--   INSERT INTO items_fts(items_fts, rowid, content, summary) VALUES('delete', old.item_id, old.content, NULL);
-- END;

-- After update of notes content
-- CREATE TRIGGER notes_au AFTER UPDATE OF content ON notes BEGIN
--   INSERT INTO items_fts(items_fts, rowid, content, summary) VALUES('delete', old.item_id, old.content, NULL);
--   INSERT INTO items_fts(rowid, content, summary)
--   SELECT new.item_id, new.content, ai_metadata.summary
--   FROM ai_metadata
--   WHERE ai_metadata.item_id = new.item_id;
-- END;

-- After insert into ai_metadata
CREATE TRIGGER ai_metadata_ai AFTER INSERT ON ai_metadata BEGIN
    INSERT INTO items_fts(rowid, content, summary)
        SELECT notes.item_id, notes.content, new.summary
        FROM notes
        WHERE notes.item_id = new.item_id;
END;

--After update to ai_metadata
CREATE TRIGGER ai_metadata_au AFTER UPDATE ON ai_metadata BEGIN
    INSERT INTO items_fts(items_fts, rowid, content, summary)
    VALUES('delete', old.item_id, NULL, old.summary);
    INSERT INTO items_fts(rowid, content, summary)
        SELECT notes.item_id, notes.content, new.summary
        FROM notes
        WHERE notes.item_id = new.item_id;
END;

-- After delete from ai_metadata
CREATE TRIGGER ai_metadata_ad AFTER DELETE ON ai_metadata BEGIN
    INSERT INTO items_fts(items_fts, rowid, content, summary)
        VALUES('delete', old.item_id, NULL, old.summary);
END;

-- Vector search setup (using sqlite-vss)
-- This will be enabled dynamically in the code by loading the extension
-- CREATE VIRTUAL TABLE IF NOT EXISTS vector_index USING vss0(
--     embedding(1536), -- OpenAI's ada-002 embedding dimension
--     item_id TEXT
-- ); 