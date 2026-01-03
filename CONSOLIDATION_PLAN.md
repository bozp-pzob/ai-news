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

---

## Tasks

### Task 1: Remove duplicate Discord interfaces from types.ts
- **Status**: `completed`
- **Files**: `src/types.ts`
- **Description**: Remove duplicate `DiscordAttachment`, `DiscordEmbed`, `DiscordSticker` definitions (lines 364-431 duplicate lines 213-268)
- **Verification**: `npm run build` passes, no TypeScript errors

### Task 2: Extend MediaDownloadItem in types.ts
- **Status**: `pending`
- **Files**: `src/types.ts`, `src/download-media.ts`
- **Description**: Add missing fields to types.ts MediaDownloadItem: `channelId`, `guildId`, `userId`, `originalData`, `messageContent`, `reactions`. Remove duplicate interface from download-media.ts.
- **Verification**: `npm run build` passes

### Task 3: Add manifest interfaces to types.ts
- **Status**: `pending`
- **Files**: `src/types.ts`, `src/download-media.ts`
- **Description**: Move `MediaManifest`, `MediaManifestEntry`, `MediaIndexEntry`, `MediaReference`, `DailyMediaMetadata`, `DownloadStats`, `MediaAnalytics` interfaces to types.ts
- **Verification**: `npm run build` passes

### Task 4: Use generateUrlHash from fileHelper
- **Status**: `pending`
- **Files**: `src/download-media.ts`, `src/helpers/fileHelper.ts`
- **Description**: Replace inline `createHash('sha256').update(url).digest('hex')` calls with `generateUrlHash` from fileHelper. May need to add truncation variant.
- **Verification**: `npm run build` passes, manifest generation works

### Task 5: Use delay from generalHelper
- **Status**: `pending`
- **Files**: `src/download-media.ts`
- **Description**: Replace inline `new Promise(resolve => setTimeout(resolve, ms))` with `delay` from generalHelper
- **Verification**: `npm run build` passes

### Task 6: Consolidate getFileTypeDir
- **Status**: `pending`
- **Files**: `src/helpers/fileHelper.ts`, `src/download-media.ts`
- **Description**: Enhance fileHelper's `getFileTypeDir` with async magic number detection from download-media.ts. Export both sync and async versions.
- **Verification**: `npm run build` passes, file type detection still works

### Task 7: Update mediaHelper to use extended MediaDownloadItem
- **Status**: `pending`
- **Files**: `src/helpers/mediaHelper.ts`
- **Description**: Update mediaHelper functions to work with extended MediaDownloadItem interface
- **Verification**: `npm run build` passes

### Task 8: Final cleanup and verification
- **Status**: `pending`
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
