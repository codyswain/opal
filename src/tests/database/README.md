# Database Tests

This directory contains tests for the database functionality in the application.

## Current Status

- ✅ **DB Initialization Tests**: Basic tests for database creation and schema loading
- ❌ **DB Operations Tests**: Tests for CRUD operations (currently failing due to foreign key constraints)
- ❌ **DB Search Tests**: Tests for search functionality (currently failing due to data type mismatch)

## Issues to Address

1. **Foreign Key Constraint Issues**: 
   - The order of deleting records needs careful handling due to foreign key constraints
   - There may be additional constraints in the schema that need special handling

2. **Data Type Mismatch in AI Metadata**: 
   - The `embedding` column in `ai_metadata` table appears to have specific type requirements
   - Need to determine correct format for inserting test data

## Next Steps

1. Fix the foreign key constraint issues by:
   - Using PRAGMA statements to temporarily disable foreign keys during test setup
   - Investigating circular foreign key dependencies
   - Using database transactions for test setup and teardown

2. Fix data type issues:
   - Examine schema more closely to understand column types
   - Query actual data to see format used in production

3. Additional tests to implement:
   - Performance tests for larger data sets
   - Tests for vector search functionality
   - Tests for database migration functionality

## Running Tests

```bash
# Run all database tests
npm test -- src/tests/database

# Run only the initialization tests (currently passing)
npm test -- src/tests/database/db-initialization.test.ts
``` 