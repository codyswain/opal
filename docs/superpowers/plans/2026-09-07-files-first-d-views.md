# Files First D: Views Polish

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the saved-views surface faster to author: tag suggestions from the library, a folder picker for scope, tags visible on rows, and Cmd+F to filter.

**Spec:** `docs/superpowers/specs/2026-09-07-files-first-design.md`, Stream D.

### Task 1: Tags listing and suggestions

- [ ] `CollectionQueryService.tags()` returns distinct meaningful tags with counts from the index snapshot; `collections:tags` channel; `collectionsAPI.tags()`.
- [ ] `useTagSuggestions` hook loads on mount and on `collections:changed`; the tags chip input gets a `<datalist>` of suggestions.
- [ ] Rows in views show up to three tag pills after the name (`CollectionRowDecoration.tags`).

### Task 2: Folder picker and Cmd+F

- [ ] `FolderPickerDialog` browses opened roots one level at a time through `diskAPI.readDirectory` (directories only), with Up and Choose; `ScopeControl` gains "Choose folder…" and lists every chosen folder, removable.
- [ ] Cmd+F inside a view focuses the first chip text input or adds a Name chip.
- [ ] Tests for the service channel, the hook, the picker, the pills and the shortcut; commit.
