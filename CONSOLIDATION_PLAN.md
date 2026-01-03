# Download-Media Consolidation Plan

## Overview
Consolidate redundant code between `src/download-media.ts` and existing helpers/types.
Target: Reduce download-media.ts from 1946 lines while improving DRYness.

## Progress Log
<!-- Append progress updates here -->

### 2026-01-03 - Task 1 Complete
- Removed duplicate Discord interfaces from types.ts (lines 364-431)
- Enhanced first DiscordAttachment: made proxy_url optional
- Enhanced first DiscordEmbed: added type, timestamp, author, fields
- Kept DiscordSticker as-is (was identical)
- Verified build passes, download-media --help works

### 2026-01-03 - Task 2 Complete
- Extended MediaDownloadItem in types.ts with channelId, guildId, userId, originalData, messageContent, reactions
- Kept new fields optional for mediaHelper.ts compatibility
- Removed duplicate interface from download-media.ts (now imports from types)
- Added non-null assertions (!) where download-media.ts uses these fields
- Verified build passes, download-media --help works

### 2026-01-03 - Task 3 Complete
- Moved DownloadStats, MediaAnalytics, MediaManifestEntry, MediaManifest to types.ts
- Kept internal interfaces (MediaReference, MediaIndexEntry, DailyMediaMetadata) in download-media.ts
- download-media.ts reduced from 1931 to 1865 lines (-66 lines)
- Verified build passes, CLI works

### 2026-01-03 - Task 4 Complete
- Replaced 3 inline createHash calls with generateUrlHash from fileHelper
- Removed crypto import from download-media.ts
- Verified build passes, CLI works

### 2026-01-03 - Task 5 Complete
- Replaced 3 inline setTimeout Promises with delay() from generalHelper
- Removed private sleep() method from DiscordRateLimiter class
- Fixed variable naming collision (delay → retryDelay)
- download-media.ts reduced to 1864 lines (-1 line)

### 2026-01-03 - Task 6 Skipped
- Async magic number detection is download-specific, shouldn't be in generic fileHelper

### 2026-01-03 - Task 7 Complete
- No changes needed - optional fields are backwards compatible

### 2026-01-03 - Task 8 Complete
- Final verification: build passes, CLI works, exports verified
- **Final results: download-media.ts reduced from 1946 to 1864 lines (-82 lines, -4.2%)**
- types.ts grew from ~395 to 473 lines (+78 lines) to hold shared interfaces

### 2026-01-03 - Additional Extraction
- Changed non-null assertions (!) to fallbacks (|| 'unknown') for safety
- Moved media utils to mediaHelper.ts: normalizeDiscordUrl, isSpoiler, isAnimated, getStickerExtension, getValidatedExtension, CONTENT_TYPE_TO_EXT, VALID_URL_EXTENSIONS
- Extracted DiscordRateLimiter to src/helpers/rateLimiter.ts
- Moved detectActualFileType and getFileTypeDirAsync from download-media.ts to fileHelper.ts

**Final results:**
- download-media.ts: 1946 → 1545 lines (-401 lines, -20.6%)
- mediaHelper.ts: 203 → 324 lines (+121 lines)
- fileHelper.ts: 285 → 362 lines (+77 lines)
- rateLimiter.ts: 145 lines (new)
- types.ts: ~395 → 473 lines (+78 lines)

---

## Tasks

### Task 1: Remove duplicate Discord interfaces from types.ts
- **Status**: `completed`
- **Files**: `src/types.ts`
- **Description**: Remove duplicate `DiscordAttachment`, `DiscordEmbed`, `DiscordSticker` definitions (lines 364-431 duplicate lines 213-268)
- **Verification**: `npm run build` passes, no TypeScript errors

### Task 2: Extend MediaDownloadItem in types.ts
- **Status**: `completed`
- **Files**: `src/types.ts`, `src/download-media.ts`
- **Description**: Add missing fields to types.ts MediaDownloadItem: `channelId`, `guildId`, `userId`, `originalData`, `messageContent`, `reactions`. Remove duplicate interface from download-media.ts.
- **Verification**: `npm run build` passes

### Task 3: Add manifest interfaces to types.ts
- **Status**: `completed`
- **Files**: `src/types.ts`, `src/download-media.ts`
- **Description**: Move `MediaManifest`, `MediaManifestEntry`, `MediaIndexEntry`, `MediaReference`, `DailyMediaMetadata`, `DownloadStats`, `MediaAnalytics` interfaces to types.ts
- **Verification**: `npm run build` passes

### Task 4: Use generateUrlHash from fileHelper
- **Status**: `completed`
- **Files**: `src/download-media.ts`, `src/helpers/fileHelper.ts`
- **Description**: Replace inline `createHash('sha256').update(url).digest('hex')` calls with `generateUrlHash` from fileHelper. May need to add truncation variant.
- **Verification**: `npm run build` passes, manifest generation works

### Task 5: Use delay from generalHelper
- **Status**: `completed`
- **Files**: `src/download-media.ts`
- **Description**: Replace inline `new Promise(resolve => setTimeout(resolve, ms))` with `delay` from generalHelper
- **Verification**: `npm run build` passes

### Task 6: Consolidate getFileTypeDir
- **Status**: `completed`
- **Files**: `src/helpers/fileHelper.ts`, `src/download-media.ts`
- **Description**: Enhance fileHelper's `getFileTypeDir` with async magic number detection from download-media.ts. Export both sync and async versions.
- **Verification**: `npm run build` passes, file type detection still works
- **Note**: Originally skipped but completed on user request. Added detectActualFileType and getFileTypeDirAsync to fileHelper.ts.

### Task 7: Update mediaHelper to use extended MediaDownloadItem
- **Status**: `completed` (no changes needed - optional fields are backwards compatible)
- **Files**: `src/helpers/mediaHelper.ts`
- **Description**: Update mediaHelper functions to work with extended MediaDownloadItem interface
- **Verification**: `npm run build` passes

### Task 8: Final cleanup and verification
- **Status**: `completed`
- **Files**: All modified files
- **Description**: Remove any remaining dead code, verify all imports, run full test
- **Verification**: `npm run build` passes, `node dist/download-media.js --help` works, manifest generation works

---

## Verification Commands
```bash
# Build check
npm run build

# Quick functional test
node dist/download-media.js --help

# Manifest generation test
node dist/download-media.js --generate-manifest --db ./data/elizaos.sqlite --source elizaos --output ./test-output --all
cat test-output/manifest.json | head -50
rm -rf test-output/
```

## Session Protocol
1. Read this file to understand current state
2. Check git log for recent changes: `git log --oneline -5`
3. Work on ONE task (lowest numbered pending task)
4. Run verification commands
5. Commit changes with descriptive message
6. Update this file: change task status to `completed`, add progress log entry
