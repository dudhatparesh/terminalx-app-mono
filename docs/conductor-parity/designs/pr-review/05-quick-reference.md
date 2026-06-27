# PR Creation & Review UI - Quick Reference & Diagrams

---

## 1. System Architecture Diagram

```
┌────────────────────────────────────────────────────────────────────┐
│                         TerminalX IDE                               │
├────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                    React Components                          │  │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐ │  │
│  │  │ PRCreationModal │  │ PRReviewPanel   │  │ CommentThread│ │  │
│  │  │ - Branch select │  │ - Diff viewer   │  │ - Inline     │ │  │
│  │  │ - Form inputs   │  │ - File list     │  │   comments   │ │  │
│  │  └────────┬────────┘  └────────┬────────┘  └──────┬───────┘ │  │
│  │           │                    │                   │          │  │
│  │           └────────┬───────────┴───────────┬───────┘          │  │
│  │                    │                       │                  │  │
│  │           ┌────────▼───────────────────────▼──────┐           │  │
│  │           │     Zustand Stores                    │           │  │
│  │           │ - prCreateStore                       │           │  │
│  │           │ - prReviewStore                       │           │  │
│  │           │ - CommentSyncService                  │           │  │
│  │           └────────┬────────────────────┬─────────┘           │  │
│  └────────────────────┼────────────────────┼────────────────────┘  │
│                       │                    │                       │
│  ┌────────────────────┼────────────────────┼────────────────────┐  │
│  │                   Persistence Layer                         │  │
│  │  ┌─────────────────────┐  ┌──────────────────────────────┐ │  │
│  │  │   IndexedDB         │  │   Session/Cookies            │ │  │
│  │  │ - Unsaved comments  │  │ - GitHub OAuth token         │ │  │
│  │  │ - Sync state        │  │ - User info                  │ │  │
│  │  │ - Review progress   │  │ - Branch cache               │ │  │
│  │  └─────────────────────┘  └──────────────────────────────┘ │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │              API Layer (Next.js Routes)                      │  │
│  │  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │  │
│  │  │ /auth   │  │ /pulls   │  │ /comments│  │ /branches    │  │  │
│  │  └─────────┘  └──────────┘  └──────────┘  └──────────────┘  │  │
│  └──────────────────┬──────────────────────────┬────────────────┘  │
│                     │                          │                   │
└─────────────────────┼──────────────────────────┼───────────────────┘
                      │                          │
                      │                          │
┌─────────────────────▼──────────────────────────▼───────────────────┐
│                    GitHub API (REST v3)                             │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ oauth.github.com/authorize    (OAuth flow)                   │  │
│  │ api.github.com/user           (Current user)                 │  │
│  │ api.github.com/repos/*/pulls  (PR CRUD)                      │  │
│  │ api.github.com/repos/*/commits (Diff data)                   │  │
│  │ api.github.com/repos/*/pulls/*/comments (Inline comments)    │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Data Flow Diagram

### 2.1 PR Creation Flow

```
User Input
    │
    ▼
┌─────────────────────────────┐
│ PRCreationModal Component    │
│  - Captures form data        │
│  - Real-time validation      │
└────────────┬────────────────┘
             │
             ▼
┌─────────────────────────────┐
│ usePRCreateStore.submit()   │
│  - Client-side validation   │
│  - Auth token check         │
└────────────┬────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│ POST /api/github/repos/:owner/:repo │
│ /pulls (Server)                     │
│  - Validate input fields            │
│  - Check auth token                 │
│  - Rate limit check                 │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│ Octokit.pulls.create()              │
│  - GitHub API call                  │
│  - Retry with exponential backoff   │
└────────────┬────────────────────────┘
             │
       ┌─────┴─────┐
       │           │
   Success      Error
       │           │
       ▼           ▼
   Store PR    Show Error Toast
   Redirect    Suggest Actions
   to Review
```

### 2.2 Review & Comment Flow

```
User Opens PR
    │
    ▼
Fetch PR from GitHub API
    │
    ├─► Load PR metadata (title, author, commits)
    ├─► Load diff for all files
    ├─► Load existing GitHub comments
    └─► Load unsaved comments from IndexedDB
    │
    ▼
Display in PRReviewPanel
    │
    ├─► Show file list (left sidebar)
    └─► Show diff viewer (right panel)
    │
User clicks line to add comment
    │
    ▼
CommentThread Component opens
    │
    ▼
User types comment
    │
    ▼
Comment saved to:
    ├─► IndexedDB (local persistence)
    ├─► Zustand store (UI state)
    └─► Marked as "unsynced"
    │
    ▼
Auto-sync trigger (30s) OR Manual "Sync" button
    │
    ▼
┌─────────────────────────────────┐
│ CommentSyncService.syncToGitHub │
│ - Fetch all unsynced comments   │
│ - Batch POST to GitHub API      │
│ - Handle conflicts              │
│ - Retry failed syncs            │
└────────────┬────────────────────┘
             │
      ┌──────┴──────┐
      │             │
   Success      Error
      │             │
      ▼             ▼
 Update IndexedDB  Show error badge
 Mark synced       Suggest retry
 Update UI
```

### 2.3 Local Comment Persistence

```
Browser
┌──────────────────────────────────────────┐
│         Zustand Store (RAM)              │
│  - Current PR state                      │
│  - Comments in memory                    │
│  - Sync status                           │
│  └─ Lost on page refresh                 │
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│      IndexedDB (Browser Disk)            │
│  - Persistent storage                    │
│  - Survives page refresh                 │
│  - Synced/unsynced flags                 │
│  - Sync error logs                       │
│  ├─ 50MB quota per domain                │
│  └─ User can clear manually              │
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│        GitHub Servers                    │
│  - Source of truth                       │
│  - Public/shared comments                │
│  - Version control for review            │
└──────────────────────────────────────────┘

Sync Strategy:
1. User comments locally → Save to IndexedDB
2. Display immediately (optimistic UI)
3. Mark as "pending sync" (⏳)
4. Auto/manual sync → POST to GitHub
5. On success → Mark "synced" (✓)
6. On error → Retry with backoff
```

---

## 3. Component Hierarchy

```
App Layout
│
├─► PRPage
│   │
│   ├─► Header (PR #123, status, actions)
│   │
│   └─► PRReviewPanel
│       │
│       ├─► Sidebar
│       │   ├─► PRMetadata
│       │   │   ├─ Author avatar
│       │   │   ├─ Title
│       │   │   ├─ Created date
│       │   │   └─ Commit count
│       │   │
│       │   └─► FileList
│       │       ├─ Search/filter
│       │       └─ FileListItem[] (with status badges)
│       │
│       └─► MainContent
│           │
│           ├─► DiffViewerHeader
│           │   ├─ File path
│           │   ├─ +additions -deletions
│           │   └─ [View Mode Toggle]
│           │
│           └─► DiffViewer
│               │
│               └─► HunkList
│                   ├─► HunkHeader (@@...)
│                   │
│                   └─► DiffLineList
│                       └─► DiffLine[]
│                           ├─ Line numbers (old/new)
│                           ├─ Diff content
│                           ├─ Comment button
│                           └─ CommentThread (if comments exist)
│                               ├─ Comment[]
│                               │  ├─ Author avatar
│                               │  ├─ Text content
│                               │  ├─ Timestamp
│                               │  ├─ Actions (Edit, Delete, Reply)
│                               │  └─ Sync status badge
│                               │
│                               ├─ ReplyList
│                               │  └─ CommentReply[]
│                               │
│                               ├─ ReplyForm
│                               │
│                               └─ ResolveButton

PRCreationModal
│
├─► DialogContent
│   │
│   ├─► BranchSelector (Base)
│   │   └─ Searchable dropdown
│   │
│   ├─► BranchSelector (Head)
│   │   └─ Searchable dropdown
│   │
│   ├─► Title Input
│   │   └─ 80 char limit with counter
│   │
│   ├─► Description Textarea
│   │   ├─ Markdown support
│   │   └─ Character count
│   │
│   ├─► AssigneeSelector
│   │   ├─ Multi-select
│   │   ├─ Avatar display
│   │   └─ Search by name
│   │
│   ├─► LabelSelector
│   │   ├─ Multi-select
│   │   ├─ Color-coded
│   │   └─ Search/filter
│   │
│   ├─► Draft Toggle
│   │
│   └─► Form Validation Messages
```

---

## 4. State Management Flow

```
┌────────────────────────────────────────────────────────────────┐
│                      Zustand Stores                            │
├────────────────────────────────────────────────────────────────┤
│                                                                  │
│  usePRCreateStore                     usePRReviewStore         │
│  ├─ form (title, desc, branches)     ├─ currentPR             │
│  ├─ isSubmitting                     ├─ selectedFile          │
│  ├─ availableBranches                ├─ reviewState           │
│  ├─ error                            ├─ comments              │
│  │                                   ├─ authToken             │
│  │ Actions:                          ├─ isLoading             │
│  │ ├─ setTitle()                     ├─ error                 │
│  │ ├─ setDescription()               ├─ syncStatus            │
│  │ ├─ setBaseBranch()                │                        │
│  │ ├─ setHeadBranch()                │ Actions:               │
│  │ ├─ addAssignee()                  │ ├─ setPR()             │
│  │ ├─ removeAssignee()               │ ├─ setSelectedFile()   │
│  │ ├─ addLabel()                     │ ├─ toggleFileReviewed()│
│  │ ├─ removeLabel()                  │ ├─ addComment()        │
│  │ ├─ setDraft()                     │ ├─ updateComment()     │
│  │ ├─ validate()                     │ ├─ deleteComment()     │
│  │ ├─ submit() (async)               │ ├─ resolveThread()     │
│  │ ├─ reset()                        │ ├─ replyToComment()    │
│  │ └─ setAuthToken()                 │ ├─ syncCommentsToGitHub()
│  │                                   │ ├─ setAuthToken()      │
│  │                                   │ └─ markAsSynced()      │
│  │                                   │                        │
│  └───────────────────────────────────┴────────────────────────┘
│                                                                  │
│  Persistence (Storage Middleware):                              │
│  ├─ Persists to: localStorage                                   │
│  ├─ Keys: 'pr-create-storage', 'pr-review-storage'             │
│  └─ Rehydrates on app start                                    │
│                                                                  │
└────────────────────────────────────────────────────────────────┘

Event Flow:
  Component → Store Action → Update State → Re-render
  ↓
  Side Effect (async) → API call
  ↓
  Update Store → Re-render
  ↓
  Persist to localStorage/IndexedDB
```

---

## 5. API Endpoint Reference

### Authentication

```
GET  /api/auth/github              → Start OAuth flow
POST /api/auth/github/callback     → Handle OAuth callback
POST /api/auth/logout              → Clear session
GET  /api/auth/status              → Check auth status
```

### Pull Requests

```
GET    /api/github/repos/:owner/:repo/pulls              → List PRs
GET    /api/github/repos/:owner/:repo/pulls/:number      → Get PR detail
POST   /api/github/repos/:owner/:repo/pulls              → Create PR
PATCH  /api/github/repos/:owner/:repo/pulls/:number      → Update PR
POST   /api/github/repos/:owner/:repo/pulls/:number/merge → Merge PR
```

### Comments

```
GET    /api/github/repos/:owner/:repo/pulls/:number/comments     → List comments
POST   /api/github/repos/:owner/:repo/pulls/:number/comments     → Create comment
PATCH  /api/github/repos/:owner/:repo/pulls/comments/:id         → Edit comment
DELETE /api/github/repos/:owner/:repo/pulls/comments/:id         → Delete comment
POST   /api/github/repos/:owner/:repo/pulls/comments/:id/replies → Reply to comment
```

### Branches

```
GET /api/github/repos/:owner/:repo/branches     → List branches
GET /api/github/repos/:owner/:repo/branches/:ref → Get branch details
```

### Commits

```
GET /api/github/repos/:owner/:repo/pulls/:number/commits → Get PR commits
GET /api/github/repos/:owner/:repo/commits/:ref/diff     → Get commit diff
```

---

## 6. Error Handling Matrix

| Error Type               | Status | Retryable | User Message                        |
| ------------------------ | ------ | --------- | ----------------------------------- |
| Auth expired             | 401    | No        | "Reconnect to GitHub"               |
| Insufficient permissions | 403    | No        | "Check repository access"           |
| Branch not found         | 404    | No        | "Branch was deleted"                |
| Invalid input            | 422    | No        | "Check branch names/PR details"     |
| Rate limited             | 429    | Yes       | "Rate limited, retrying..."         |
| Server error             | 5xx    | Yes       | "GitHub service error, retrying..." |
| Network error            | -      | Yes       | "Connection lost, retrying..."      |
| Offline                  | -      | Yes       | "You are offline"                   |

---

## 7. File Status Indicators

```
✓  Reviewed                 → User has clicked "Mark reviewed"
○  Not reviewed             → Waiting to be reviewed
💬 Has comments             → Contains comment threads
🔴 Unresolved comments      → Has threads marked unresolved
✏  Being edited             → User is editing a comment
⏳ Pending sync             → Comment waiting to sync
✓  Synced                   → Synced to GitHub
⚠  Sync error              → Failed to sync, retry available
```

---

## 8. Keyboard Shortcuts (Future)

```
Ctrl/Cmd + P               → Quick PR search
Ctrl/Cmd + N               → New PR
Ctrl/Cmd + K               → Open file jump
Ctrl/Cmd + S               → Sync comments to GitHub
Ctrl/Cmd + R               → Mark current file reviewed
j/k                        → Navigate diffs
Enter                      → Open comment form
Escape                     → Close modals/forms
Tab                        → Navigate between hunks
```

---

## 9. Performance Optimizations

| Challenge                 | Solution                                    |
| ------------------------- | ------------------------------------------- |
| Large diffs (1000+ lines) | Virtual scrolling (react-window)            |
| Many comments             | Lazy load comments per file                 |
| Slow branch list          | Cache + searchable dropdown                 |
| Comment sync conflicts    | Exponential backoff + conflict resolver     |
| Large IndexedDB           | Auto-cleanup of archived PRs (30+ days old) |
| Initial load time         | Code splitting for PR components            |
| Memory usage              | Zustand store cleanup on unmount            |

---

## 10. Testing Checklist

### Unit Tests

- [ ] Branch validation logic
- [ ] Form validation rules
- [ ] Diff line parsing
- [ ] Comment thread grouping
- [ ] Sync service retry logic

### Component Tests

- [ ] PR creation modal submit
- [ ] Diff viewer rendering
- [ ] Comment thread UI
- [ ] File list status updates
- [ ] Error message display

### Integration Tests

- [ ] Full create PR workflow
- [ ] Review → comment → sync flow
- [ ] Offline support (IndexedDB)
- [ ] OAuth redirect flow
- [ ] Comment conflict resolution

### E2E Tests

- [ ] Create PR via UI
- [ ] Review and comment
- [ ] Sync to GitHub
- [ ] Archive PR
- [ ] Multi-user comment threads

---

## 11. Configuration & Env Variables

```bash
# GitHub OAuth
GITHUB_CLIENT_ID=xxxx
GITHUB_CLIENT_SECRET=xxxx
GITHUB_REDIRECT_URI=http://localhost:3000/api/auth/callback

# API Configuration
GITHUB_API_BASE_URL=https://api.github.com
GITHUB_API_TIMEOUT_MS=10000
GITHUB_API_MAX_RETRIES=3

# Feature Flags
ENABLE_PR_REVIEW=true
ENABLE_SPLIT_DIFF=true
ENABLE_COMMENT_THREADS=true
ENABLE_AUTO_SYNC=true

# Sync Settings
COMMENT_SYNC_INTERVAL_MS=30000
COMMENT_SYNC_BATCH_SIZE=10
COMMENT_SYNC_MAX_RETRIES=3
COMMENT_CLEANUP_DAYS=30

# Performance
DIFF_VIEWER_VIRTUALIZATION=true
DIFF_VIEWER_ITEM_HEIGHT=24
DIFF_VIEWER_OVERSCAN=5

# UI
DARK_MODE_ONLY=true
SYNTAX_HIGHLIGHTER=prismjs
```

---

## 12. Migration Path (Existing Features)

If TerminalX already has file browser/editor:

1. Reuse authentication patterns
2. Leverage existing WebSocket for real-time updates
3. Share file tree components with file browser
4. Extend existing diff viewing (if any)
5. Use same error handling patterns
6. Follow existing Tailwind theme

---

## 13. Documentation Files Generated

1. **PR_CREATION_REVIEW_UI_SPEC.md** (Main spec)
   - Complete data models
   - Component specifications
   - GitHub integration details
   - Comment system architecture
   - State management design
   - Workflow diagrams

2. **PR_CREATION_REVIEW_IMPLEMENTATION.md** (Code guide)
   - Working component examples
   - Store implementations
   - API route handlers
   - Error handling patterns
   - Database schema
   - Utility functions

3. **PR_UI_QUICK_REFERENCE.md** (This file)
   - System architecture
   - Data flow diagrams
   - Component hierarchy
   - API endpoints
   - Error matrix
   - Optimization tips

---

## 14. Next Steps

### Immediate (Week 1)

1. [ ] Review specs with team
2. [ ] Finalize GitHub OAuth setup
3. [ ] Create component folder structure
4. [ ] Set up Zustand stores

### Short-term (Week 2-3)

1. [ ] Build PR Creation Modal
2. [ ] Implement Diff Viewer
3. [ ] Create Comment Thread component
4. [ ] Set up API routes

### Medium-term (Week 4-6)

1. [ ] Integrate GitHub API calls
2. [ ] Build IndexedDB sync service
3. [ ] Implement error handling
4. [ ] Add loading states

### Long-term (Week 7+)

1. [ ] Write comprehensive tests
2. [ ] Performance optimization
3. [ ] Accessibility audit
4. [ ] Documentation & onboarding

---

## Contact & Support

For questions on:

- **Architecture**: See PR_CREATION_REVIEW_UI_SPEC.md Section 1-5
- **Implementation**: See PR_CREATION_REVIEW_IMPLEMENTATION.md
- **Components**: See PR_CREATION_REVIEW_UI_SPEC.md Section 3
- **APIs**: See this file, Section 5

---

**Last Updated:** June 2026  
**Version:** 1.0  
**Status:** Ready for Implementation
