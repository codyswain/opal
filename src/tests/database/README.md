# Database Tests

This directory contains tests for the database functionality in the application.

## Current Status

- ✅ **DB Initialization Tests**: Basic tests for database creation and schema loading
- ✅ **DB Operations Tests**: Tests for CRUD operations on items, notes, and related tables
- ✅ **DB Search Tests**: Tests for search functionality using SQL queries

## Implementation Notes

1. **Foreign Key Handling**:

   - Tests temporarily disable foreign key constraints during setup with `db.pragma('foreign_keys = OFF')`
   - This prevents errors when clearing tables with dependencies
   - Foreign keys are re-enabled for the actual tests to ensure proper behavior

2. **AI Metadata/Embedding Tests**:
   - The `ai_metadata` table is specifically for storing OpenAI embeddings
   - Embedding data requires special handling (base64 encoded JSON)
   - Tests don't directly interact with this table to avoid complexity

## Future Test Enhancements

1. Additional tests to implement:

   - Performance tests for larger data sets
   - Tests for vector search functionality
   - Tests for database migration functionality
   - Tests for embedding storage and retrieval

2. Testing AI functionality:
   - Mock the OpenAI API for testing embedding creation
   - Test vector similarity search functionality
   - Test semantic search capabilities

## Running Tests

```bash
# Run all database tests
npm test -- src/tests/database

# Run specific test files
npm test -- src/tests/database/db-initialization.test.ts
npm test -- src/tests/database/db-operations.test.ts
npm test -- src/tests/database/db-search.test.ts
```
