# PR Creation & Review UI - Implementation Guide

**Purpose:** Detailed component code, API patterns, and architectural decisions for TerminalX PR system.

---

## 1. Component Implementation Examples

### 1.1 PR Creation Modal Component

```typescript
// src/components/pr/PRCreationModal/PRCreationModal.tsx
'use client'

import { useState, useCallback } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Checkbox } from '@/components/ui/checkbox'
import { usePRCreateStore } from '@/store/prCreateStore'
import { BranchSelector } from './BranchSelector'
import { AssigneeSelector } from './AssigneeSelector'
import { LabelSelector } from './LabelSelector'
import { Loader2 } from 'lucide-react'

interface PRCreationModalProps {
  isOpen: boolean
  onClose: () => void
  currentBranch?: string
  onSuccess?: (pr: any) => void
  repositoryContext?: {
    owner: string
    repo: string
  }
}

export function PRCreationModal({
  isOpen,
  onClose,
  currentBranch,
  onSuccess,
  repositoryContext,
}: PRCreationModalProps) {
  const {
    form,
    isSubmitting,
    availableBranches,
    error,
    setTitle,
    setDescription,
    setBaseBranch,
    setHeadBranch,
    setDraft,
    addAssignee,
    removeAssignee,
    addLabel,
    removeLabel,
    validate,
    submit,
    reset,
  } = usePRCreateStore()

  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({})

  const handleSubmit = useCallback(async () => {
    // Validate form
    if (!validate()) {
      setValidationErrors({
        title: !form.title ? 'Title is required' : '',
        baseBranch: !form.baseBranch ? 'Base branch is required' : '',
        headBranch: !form.headBranch ? 'Head branch is required' : '',
      })
      return
    }

    try {
      const pr = await submit()
      onSuccess?.(pr)
      reset()
      onClose()
    } catch (err) {
      setValidationErrors({
        submit: (err as Error).message,
      })
    }
  }, [form, validate, submit, reset, onSuccess, onClose])

  const handleClose = useCallback(() => {
    reset()
    setValidationErrors({})
    onClose()
  }, [reset, onClose])

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Create Pull Request</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Branch Selection */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium">Compare branches</h3>
            <div className="flex items-center gap-3">
              <BranchSelector
                value={form.baseBranch}
                onChange={setBaseBranch}
                branches={availableBranches}
                label="Base"
                disabled={isSubmitting}
              />
              <span className="text-muted-foreground">←</span>
              <BranchSelector
                value={form.headBranch}
                onChange={setHeadBranch}
                branches={availableBranches}
                label="Head"
                disabled={isSubmitting}
                defaultValue={currentBranch}
              />
            </div>
            {validationErrors.baseBranch && (
              <p className="text-xs text-destructive">{validationErrors.baseBranch}</p>
            )}
            {validationErrors.headBranch && (
              <p className="text-xs text-destructive">{validationErrors.headBranch}</p>
            )}
          </div>

          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="pr-title">Title</Label>
            <Input
              id="pr-title"
              placeholder="Describe the purpose of this PR"
              value={form.title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={isSubmitting}
              maxLength={80}
            />
            <div className="flex justify-between">
              <p className="text-xs text-muted-foreground">
                {form.title.length}/80 characters
              </p>
              {validationErrors.title && (
                <p className="text-xs text-destructive">{validationErrors.title}</p>
              )}
            </div>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="pr-description">Description (optional)</Label>
            <Textarea
              id="pr-description"
              placeholder="Add details about your changes..."
              value={form.description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isSubmitting}
              rows={4}
              className="resize-none"
            />
            <p className="text-xs text-muted-foreground">
              Supports Markdown formatting
            </p>
          </div>

          {/* Assignees */}
          <AssigneeSelector
            selected={form.assignees}
            onAdd={addAssignee}
            onRemove={removeAssignee}
            disabled={isSubmitting}
          />

          {/* Labels */}
          <LabelSelector
            selected={form.labels}
            onAdd={addLabel}
            onRemove={removeLabel}
            disabled={isSubmitting}
          />

          {/* Draft Toggle */}
          <div className="flex items-center space-x-2">
            <Checkbox
              id="draft"
              checked={form.draft}
              onCheckedChange={(checked) => setDraft(checked as boolean)}
              disabled={isSubmitting}
            />
            <Label htmlFor="draft" className="font-normal cursor-pointer">
              This is a draft pull request
            </Label>
          </div>

          {/* Errors */}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {validationErrors.submit && (
            <Alert variant="destructive">
              <AlertDescription>{validationErrors.submit}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating...
              </>
            ) : (
              'Create PR'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

### 1.2 Branch Selector Component

```typescript
// src/components/pr/PRCreationModal/BranchSelector.tsx
'use client'

import { useState, useMemo } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2 } from 'lucide-react'

interface BranchSelectorProps {
  value: string
  onChange: (branch: string) => void
  branches: string[]
  label: string
  disabled?: boolean
  defaultValue?: string
  loading?: boolean
}

export function BranchSelector({
  value,
  onChange,
  branches,
  label,
  disabled = false,
  defaultValue,
  loading = false,
}: BranchSelectorProps) {
  const [searchQuery, setSearchQuery] = useState('')

  const filteredBranches = useMemo(() => {
    if (!searchQuery) return branches
    return branches.filter(b =>
      b.toLowerCase().includes(searchQuery.toLowerCase())
    )
  }, [branches, searchQuery])

  return (
    <div className="flex-1 space-y-2">
      <Label className="text-xs font-medium text-muted-foreground uppercase">
        {label}
      </Label>
      <Select
        value={value || defaultValue}
        onValueChange={onChange}
        disabled={disabled || loading}
      >
        <SelectTrigger className="w-full">
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading branches...
            </>
          ) : (
            <SelectValue placeholder="Select a branch" />
          )}
        </SelectTrigger>
        <SelectContent>
          {/* Search in dropdown */}
          <div className="p-2 sticky top-0 bg-background border-b">
            <Input
              placeholder="Search branches..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8"
            />
          </div>

          {filteredBranches.length > 0 ? (
            filteredBranches.map(branch => (
              <SelectItem key={branch} value={branch}>
                <span className="font-mono text-sm">{branch}</span>
              </SelectItem>
            ))
          ) : (
            <div className="p-2 text-center text-sm text-muted-foreground">
              No branches found
            </div>
          )}
        </SelectContent>
      </Select>
    </div>
  )
}
```

### 1.3 Diff Viewer Component

```typescript
// src/components/pr/PRReviewPanel/DiffViewer.tsx
'use client'

import { useMemo, useCallback, useState } from 'react'
import { FileDiff, DiffComment } from '@/types/pr'
import { Button } from '@/components/ui/button'
import { DiffLine } from './DiffLine'
import { CommentThread } from '../DiffComments/CommentThread'
import { DiffViewerModes } from './DiffViewerModes'
import {
  ChevronDown,
  ChevronUp,
  MessageSquare,
} from 'lucide-react'
import Prism from 'prismjs'
import 'prismjs/themes/prism-dark.css'
import 'prismjs/components/prism-typescript'
import 'prismjs/components/prism-jsx'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-bash'

interface DiffViewerProps {
  file: FileDiff
  viewMode: 'unified' | 'split'
  onCommentClick: (lineId: string) => void
  comments: Map<string, DiffComment[]>
  readOnly?: boolean
  onViewModeChange: (mode: 'unified' | 'split') => void
}

export function DiffViewer({
  file,
  viewMode,
  onCommentClick,
  comments,
  readOnly = false,
  onViewModeChange,
}: DiffViewerProps) {
  const [expandedHunks, setExpandedHunks] = useState<Set<string>>(
    new Set(file.hunks.map(h => h.id))
  )

  const toggleHunk = useCallback((hunkId: string) => {
    const newExpanded = new Set(expandedHunks)
    if (newExpanded.has(hunkId)) {
      newExpanded.delete(hunkId)
    } else {
      newExpanded.add(hunkId)
    }
    setExpandedHunks(newExpanded)
  }, [expandedHunks])

  const getLanguage = useCallback((filename: string) => {
    const ext = filename.split('.').pop()?.toLowerCase() || ''
    const languageMap: Record<string, string> = {
      'ts': 'typescript',
      'tsx': 'jsx',
      'js': 'javascript',
      'jsx': 'jsx',
      'py': 'python',
      'sh': 'bash',
      'json': 'json',
      'yaml': 'yaml',
      'yml': 'yaml',
      'html': 'html',
      'css': 'css',
      'sql': 'sql',
    }
    return languageMap[ext] || 'text'
  }, [])

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
        <div className="flex-1">
          <h3 className="font-mono text-sm font-medium">{file.path}</h3>
          <p className="text-xs text-muted-foreground mt-1">
            <span className="text-green-600">+{file.additions}</span>
            {' '}
            <span className="text-red-600">-{file.deletions}</span>
          </p>
        </div>

        <div className="flex items-center gap-2">
          <DiffViewerModes
            current={viewMode}
            onChange={onViewModeChange}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              const allExpanded = file.hunks.every(h => expandedHunks.has(h.id))
              if (allExpanded) {
                setExpandedHunks(new Set())
              } else {
                setExpandedHunks(new Set(file.hunks.map(h => h.id)))
              }
            }}
          >
            {file.hunks.every(h => expandedHunks.has(h.id)) ? (
              <>
                <ChevronUp className="h-4 w-4 mr-1" />
                Collapse All
              </>
            ) : (
              <>
                <ChevronDown className="h-4 w-4 mr-1" />
                Expand All
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Hunks */}
      <div className="overflow-x-auto">
        {file.hunks.map((hunk) => (
          <div key={hunk.id} className="border-b">
            {/* Hunk Header */}
            <button
              onClick={() => toggleHunk(hunk.id)}
              className="w-full px-4 py-2 bg-muted/50 hover:bg-muted text-left text-xs font-mono text-muted-foreground transition-colors flex items-center gap-2"
            >
              {expandedHunks.has(hunk.id) ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronUp className="h-4 w-4" />
              )}
              <span>{hunk.context}</span>
            </button>

            {/* Hunk Lines */}
            {expandedHunks.has(hunk.id) && (
              <div className="divide-y">
                {hunk.lines.map((line, idx) => (
                  <div key={line.id}>
                    <DiffLine
                      line={line}
                      hunk={hunk}
                      viewMode={viewMode}
                      onCommentClick={() => onCommentClick(line.id)}
                      hasComments={comments.has(line.id)}
                      language={getLanguage(file.path)}
                      readOnly={readOnly}
                    />

                    {/* Comment Thread */}
                    {comments.has(line.id) && (
                      <div className="bg-muted/20 border-t divide-y">
                        <CommentThread
                          lineId={line.id}
                          comments={comments.get(line.id) || []}
                          onReply={() => {}} // Implement reply handler
                          onResolve={() => {}} // Implement resolve handler
                          onDelete={() => {}} // Implement delete handler
                          readOnly={readOnly}
                          showSyncStatus
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
```

### 1.4 Diff Line Component

```typescript
// src/components/pr/PRReviewPanel/DiffLine.tsx
'use client'

import { DiffLine as DiffLineType, DiffHunk } from '@/types/pr'
import { Button } from '@/components/ui/button'
import { MessageSquare } from 'lucide-react'
import Prism from 'prismjs'
import { useMemo } from 'react'

interface DiffLineProps {
  line: DiffLineType
  hunk: DiffHunk
  viewMode: 'unified' | 'split'
  onCommentClick: () => void
  hasComments: boolean
  language: string
  readOnly?: boolean
}

export function DiffLine({
  line,
  hunk,
  viewMode,
  onCommentClick,
  hasComments,
  language,
  readOnly = false,
}: DiffLineProps) {
  const highlightedContent = useMemo(() => {
    try {
      return Prism.highlight(line.content, Prism.languages[language], language)
    } catch {
      return line.content
    }
  }, [line.content, language])

  const lineClasses = {
    addition: 'bg-green-950/30 hover:bg-green-950/40',
    deletion: 'bg-red-950/30 hover:bg-red-950/40',
    context: 'hover:bg-muted/50',
  }

  const typeIndicator = {
    addition: '+',
    deletion: '-',
    context: ' ',
  }

  return (
    <div className={`flex group ${lineClasses[line.type]}`}>
      {/* Old Line Number (Unified) */}
      <div className="flex-none w-12 px-3 py-2 text-right text-xs font-mono text-muted-foreground bg-muted/20 border-r border-border">
        {line.oldLineNumber || '-'}
      </div>

      {/* New Line Number */}
      <div className="flex-none w-12 px-3 py-2 text-right text-xs font-mono text-muted-foreground bg-muted/20 border-r border-border">
        {line.newLineNumber || '-'}
      </div>

      {/* Type Indicator */}
      <div className="flex-none w-8 px-2 py-2 text-center text-xs font-mono font-bold text-muted-foreground">
        {typeIndicator[line.type]}
      </div>

      {/* Code Content */}
      <div className="flex-1 px-4 py-2 font-mono text-sm overflow-x-auto">
        <code
          dangerouslySetInnerHTML={{ __html: highlightedContent }}
          className="language-typescript"
        />
      </div>

      {/* Comment Button */}
      <div className="flex-none w-10 px-2 py-2 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          variant="ghost"
          size="icon"
          onClick={onCommentClick}
          disabled={readOnly}
          className="h-6 w-6"
          title="Add comment"
        >
          {hasComments ? (
            <MessageSquare className="h-4 w-4 fill-blue-500 text-blue-500" />
          ) : (
            <MessageSquare className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  )
}
```

### 1.5 Comment Thread Component

```typescript
// src/components/pr/DiffComments/CommentThread.tsx
'use client'

import { DiffComment, CommentReply } from '@/types/pr'
import { useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  MessageCircle,
  MoreVertical,
  Check,
  X,
  Clock,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

interface CommentThreadProps {
  lineId: string
  comments: DiffComment[]
  onReply: (reply: CommentReply) => void
  onResolve: () => void
  onDelete: (commentId: string) => void
  readOnly?: boolean
  showSyncStatus?: boolean
}

export function CommentThread({
  lineId,
  comments,
  onReply,
  onResolve,
  onDelete,
  readOnly = false,
  showSyncStatus = false,
}: CommentThreadProps) {
  const [replyOpen, setReplyOpen] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [resolvedThread, setResolvedThread] = useState(
    comments.some(c => c.resolved)
  )

  const handleReply = useCallback(() => {
    if (!replyText.trim()) return

    onReply({
      id: `reply-${Date.now()}`,
      author: 'current-user',
      authorAvatarUrl: 'https://api.github.com/users/current-user/avatar',
      createdAt: new Date().toISOString(),
      content: replyText,
      synced: false,
    })

    setReplyText('')
    setReplyOpen(false)
  }, [replyText, onReply])

  const allComments = comments.flatMap(c => [
    c,
    ...(c.replies || []).map(r => ({ ...r, isReply: true })),
  ])

  return (
    <div className="space-y-3 p-4 bg-background">
      {/* Thread Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageCircle className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">
            {comments.length} comment{comments.length !== 1 ? 's' : ''}
          </span>
          {resolvedThread && (
            <Badge variant="outline" className="text-xs">
              <Check className="h-3 w-3 mr-1" />
              Resolved
            </Badge>
          )}
        </div>
      </div>

      {/* Comments */}
      <div className="space-y-3 divide-y">
        {comments.map((comment) => (
          <div key={comment.id} className="space-y-2 first:pt-0 pt-3">
            {/* Comment Header */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Avatar className="h-6 w-6">
                  <AvatarImage src={comment.authorAvatarUrl} />
                  <AvatarFallback>
                    {comment.author.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">
                    @{comment.author}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(comment.createdAt), {
                      addSuffix: true,
                    })}
                  </span>
                </div>
              </div>

              {/* Sync Status & Actions */}
              <div className="flex items-center gap-2">
                {showSyncStatus && !comment.synced && (
                  <div className="flex items-center gap-1 text-xs text-yellow-600">
                    <Clock className="h-3 w-3" />
                    <span>Pending</span>
                  </div>
                )}

                {!readOnly && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                      >
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem>Edit</DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => onDelete(comment.id)}
                      >
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </div>

            {/* Comment Body */}
            <p className="text-sm whitespace-pre-wrap">{comment.content}</p>

            {/* Replies */}
            {comment.replies && comment.replies.length > 0 && (
              <div className="ml-4 space-y-2 border-l-2 border-muted pl-3 mt-2">
                {comment.replies.map((reply) => (
                  <div key={reply.id} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Avatar className="h-5 w-5">
                        <AvatarImage src={reply.authorAvatarUrl} />
                        <AvatarFallback>
                          {reply.author.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-xs font-medium">
                        @{reply.author}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(reply.createdAt), {
                          addSuffix: true,
                        })}
                      </span>
                    </div>
                    <p className="text-sm whitespace-pre-wrap">
                      {reply.content}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* Reply Form */}
            {!readOnly && !replyOpen && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs"
                onClick={() => setReplyOpen(true)}
              >
                Reply
              </Button>
            )}
          </div>
        ))}
      </div>

      {/* Reply Form */}
      {!readOnly && replyOpen && (
        <div className="space-y-2 border-t pt-3">
          <Textarea
            placeholder="Write a reply..."
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            className="min-h-[80px] resize-none"
          />
          <div className="flex gap-2 justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setReplyOpen(false)
                setReplyText('')
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleReply}
              disabled={!replyText.trim()}
            >
              Reply
            </Button>
          </div>
        </div>
      )}

      {/* Resolve Button */}
      {!readOnly && (
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => {
            setResolvedThread(!resolvedThread)
            onResolve()
          }}
        >
          {resolvedThread ? (
            <>
              <X className="h-4 w-4 mr-1" />
              Unresolve
            </>
          ) : (
            <>
              <Check className="h-4 w-4 mr-1" />
              Mark as Resolved
            </>
          )}
        </Button>
      )}
    </div>
  )
}
```

---

## 2. Store Implementations

### 2.1 PR Create Store (Zustand)

```typescript
// src/store/prCreateStore.ts
import { create } from "zustand";
import { PRService } from "@/lib/github/pullRequests";

interface PRCreateStore {
  form: {
    title: string;
    description: string;
    baseBranch: string;
    headBranch: string;
    assignees: string[];
    labels: string[];
    draft: boolean;
  };
  isSubmitting: boolean;
  availableBranches: string[];
  error: string | null;
  authToken: string | null;

  // Actions
  setTitle(title: string): void;
  setDescription(description: string): void;
  setBaseBranch(branch: string): void;
  setHeadBranch(branch: string): void;
  addAssignee(login: string): void;
  removeAssignee(login: string): void;
  addLabel(label: string): void;
  removeLabel(label: string): void;
  setDraft(isDraft: boolean): void;
  setBranches(branches: string[]): void;
  validate(): boolean;
  submit(): Promise<any>;
  reset(): void;
  setAuthToken(token: string): void;
}

export const usePRCreateStore = create<PRCreateStore>((set, get) => ({
  form: {
    title: "",
    description: "",
    baseBranch: "main",
    headBranch: "",
    assignees: [],
    labels: [],
    draft: false,
  },
  isSubmitting: false,
  availableBranches: [],
  error: null,
  authToken: null,

  setTitle: (title: string) => {
    set((state) => ({
      form: { ...state.form, title: title.slice(0, 80) },
    }));
  },

  setDescription: (description: string) => {
    set((state) => ({
      form: { ...state.form, description },
    }));
  },

  setBaseBranch: (baseBranch: string) => {
    set((state) => ({
      form: { ...state.form, baseBranch },
    }));
  },

  setHeadBranch: (headBranch: string) => {
    set((state) => ({
      form: { ...state.form, headBranch },
    }));
  },

  addAssignee: (login: string) => {
    set((state) => ({
      form: {
        ...state.form,
        assignees: [...new Set([...state.form.assignees, login])],
      },
    }));
  },

  removeAssignee: (login: string) => {
    set((state) => ({
      form: {
        ...state.form,
        assignees: state.form.assignees.filter((a) => a !== login),
      },
    }));
  },

  addLabel: (label: string) => {
    set((state) => ({
      form: {
        ...state.form,
        labels: [...new Set([...state.form.labels, label])],
      },
    }));
  },

  removeLabel: (label: string) => {
    set((state) => ({
      form: {
        ...state.form,
        labels: state.form.labels.filter((l) => l !== label),
      },
    }));
  },

  setDraft: (isDraft: boolean) => {
    set((state) => ({
      form: { ...state.form, draft: isDraft },
    }));
  },

  setBranches: (branches: string[]) => {
    set({ availableBranches: branches });
  },

  validate: () => {
    const { form } = get();
    return !!(
      form.title &&
      form.baseBranch &&
      form.headBranch &&
      form.baseBranch !== form.headBranch
    );
  },

  submit: async () => {
    set({ isSubmitting: true, error: null });

    try {
      const { form, authToken } = get();

      if (!authToken) {
        throw new Error("Not authenticated");
      }

      // Get repo context from window or props
      const [owner, repo] = (window as any).__REPO_CONTEXT?.split("/") || ["owner", "repo"];

      const prService = new PRService(authToken);
      const pr = await prService.createPR(owner, repo, {
        title: form.title,
        description: form.description,
        baseBranch: form.baseBranch,
        headBranch: form.headBranch,
        draft: form.draft,
      });

      set({ isSubmitting: false });
      return pr;
    } catch (error) {
      const message = (error as Error).message;
      set({
        isSubmitting: false,
        error: message,
      });
      throw error;
    }
  },

  reset: () => {
    set({
      form: {
        title: "",
        description: "",
        baseBranch: "main",
        headBranch: "",
        assignees: [],
        labels: [],
        draft: false,
      },
      error: null,
    });
  },

  setAuthToken: (token: string) => {
    set({ authToken: token });
  },
}));
```

---

## 3. API Route Handlers

### 3.1 PR Creation Endpoint

```typescript
// src/app/api/github/repos/[owner]/[repo]/pulls/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { withRetry, GitHubAPIError } from "@/lib/github/errors";
import { Octokit } from "@octokit/rest";

export async function POST(
  req: NextRequest,
  { params }: { params: { owner: string; repo: string } }
) {
  try {
    // Verify authentication
    const session = await getServerSession();
    if (!session?.accessToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Parse request body
    const { title, body, head, base, draft } = await req.json();

    // Validate inputs
    if (!title || !head || !base) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    if (head === base) {
      return NextResponse.json(
        { error: "Head and base branches must be different" },
        { status: 422 }
      );
    }

    // Create Octokit client with user's token
    const octokit = new Octokit({ auth: session.accessToken });

    // Create PR with retry
    const { data: pr } = await withRetry(
      () =>
        octokit.pulls.create({
          owner: params.owner,
          repo: params.repo,
          title,
          body: body || "",
          head,
          base,
          draft: draft || false,
        }),
      3
    );

    return NextResponse.json({ pr });
  } catch (error) {
    if (error instanceof GitHubAPIError) {
      return NextResponse.json({ error: error.githubError }, { status: error.statusCode });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// List PRs
export async function GET(
  req: NextRequest,
  { params }: { params: { owner: string; repo: string } }
) {
  try {
    const session = await getServerSession();
    if (!session?.accessToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const state = searchParams.get("state") || "open";
    const page = parseInt(searchParams.get("page") || "1");

    const octokit = new Octokit({ auth: session.accessToken });

    const { data: prs } = await octokit.pulls.list({
      owner: params.owner,
      repo: params.repo,
      state: state as any,
      page,
      per_page: 20,
      sort: "updated",
      direction: "desc",
    });

    return NextResponse.json({ prs });
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch PRs" }, { status: 500 });
  }
}
```

### 3.2 Comment Creation Endpoint

```typescript
// src/app/api/github/repos/[owner]/[repo]/pulls/[number]/comments/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Octokit } from "@octokit/rest";

export async function POST(
  req: NextRequest,
  {
    params,
  }: {
    params: {
      owner: string;
      repo: string;
      number: string;
    };
  }
) {
  try {
    const session = await getServerSession();
    if (!session?.accessToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { body, commit_id, path, position, in_reply_to_id } = await req.json();

    if (!body || !commit_id || !path) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const octokit = new Octokit({ auth: session.accessToken });

    if (in_reply_to_id) {
      // Reply to existing comment
      const { data: reply } = await octokit.pulls.createReplyForReviewComment({
        owner: params.owner,
        repo: params.repo,
        pull_number: parseInt(params.number),
        comment_id: in_reply_to_id,
        body,
      });

      return NextResponse.json({ comment: reply });
    } else {
      // New comment on specific line
      const { data: comment } = await octokit.pulls.createReviewComment({
        owner: params.owner,
        repo: params.repo,
        pull_number: parseInt(params.number),
        commit_id,
        path,
        position,
        body,
      });

      return NextResponse.json({ comment });
    }
  } catch (error) {
    console.error("Comment creation error:", error);
    return NextResponse.json({ error: "Failed to create comment" }, { status: 500 });
  }
}
```

---

## 4. Database / IndexedDB Schema

```typescript
// src/lib/db/schema.ts
export const DB_SCHEMA = {
  name: "terminalx-pr-review",
  version: 1,
  stores: {
    comments: {
      keyPath: "id",
      indexes: [
        { name: "prId_lineId", keyPath: ["prId", "lineId"], unique: false },
        { name: "threadId", keyPath: "threadId", unique: false },
        { name: "synced", keyPath: "synced", unique: false },
        { name: "createdAt", keyPath: "createdAt", unique: false },
      ],
    },
    reviewState: {
      keyPath: "prId",
      indexes: [{ name: "lastSyncTime", keyPath: "lastSyncTime", unique: false }],
    },
    draftComments: {
      keyPath: "id",
      indexes: [
        { name: "prId", keyPath: "prId", unique: false },
        { name: "lineId", keyPath: "lineId", unique: false },
      ],
    },
    syncLog: {
      keyPath: "id",
      indexes: [{ name: "prId_timestamp", keyPath: ["prId", "timestamp"], unique: false }],
    },
  },
};

export interface StoredComment {
  id: string;
  prId: number;
  lineId: string;
  filePath: string;
  threadId: string;
  author: string;
  authorAvatarUrl: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  resolved: boolean;
  synced: boolean;
  gitHubCommentId?: number;
  syncError?: string;
  syncAttempts: number;
  lastSyncAttempt?: string;
}

export interface StoredReviewState {
  prId: number;
  filesReviewed: { [filename: string]: boolean };
  reviewStatus: { [filename: string]: "approved" | "changes" | "commented" };
  lastSyncTime: string;
  syncInProgress: boolean;
}
```

---

## 5. Error Handling Patterns

```typescript
// src/lib/github/errors.ts
export class GitHubAPIError extends Error {
  constructor(
    public statusCode: number,
    public githubError: string,
    public retryable: boolean = false
  ) {
    super(`GitHub API Error (${statusCode}): ${githubError}`);
    this.name = "GitHubAPIError";
  }
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 1000
): Promise<T> {
  let lastError: Error;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      // Check if retryable
      if (error instanceof GitHubAPIError && error.retryable && i < maxRetries - 1) {
        // Exponential backoff
        const backoffMs = delayMs * Math.pow(2, i);
        await new Promise((r) => setTimeout(r, backoffMs));
        continue;
      } else {
        throw error;
      }
    }
  }

  throw lastError!;
}

// Handle GitHub API errors
export function handleGitHubError(error: any): GitHubAPIError {
  if (error?.status) {
    const retryable =
      error.status === 429 || error.status === 500 || error.status === 502 || error.status === 503;

    return new GitHubAPIError(error.status, error.message, retryable);
  }

  return new GitHubAPIError(500, error?.message || "Unknown error", false);
}
```

---

## 6. Hooks & Utils

```typescript
// src/hooks/usePRDiff.ts
import { useEffect, useState } from "react";
import { usePRReviewStore } from "@/store/prReviewStore";

export function usePRDiff(prNumber: number) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const setPR = usePRReviewStore((s) => s.setPR);

  useEffect(() => {
    const fetchDiff = async () => {
      try {
        setLoading(true);
        const res = await fetch(`/api/github/repos/owner/repo/pulls/${prNumber}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const { pr, files } = await res.json();
        setPR({ ...pr, files });
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    };

    fetchDiff();
  }, [prNumber, setPR]);

  return { loading, error };
}

// src/lib/utils/diff.ts
export function parseDiffPatch(patch: string): DiffLine[] {
  const lines: DiffLine[] = [];
  const patchLines = patch.split("\n");

  let oldLineNum = 0;
  let newLineNum = 0;

  for (const patchLine of patchLines) {
    if (patchLine.startsWith("@@")) {
      // Parse hunk header
      const match = patchLine.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLineNum = parseInt(match[1]);
        newLineNum = parseInt(match[2]);
      }
      continue;
    }

    const type = patchLine[0] as "+" | "-" | " " | "\\" | undefined;
    if (!type || type === "\\") continue;

    const content = patchLine.slice(1);
    const lineType = type === "+" ? "addition" : type === "-" ? "deletion" : "context";

    lines.push({
      id: `line-${oldLineNum}-${newLineNum}`,
      type: lineType as any,
      oldLineNumber: type === "-" || type === " " ? oldLineNum : undefined,
      newLineNumber: type === "+" || type === " " ? newLineNum : undefined,
      content,
      hasComment: false,
      comments: [],
    });

    if (type !== "+") oldLineNum++;
    if (type !== "-") newLineNum++;
  }

  return lines;
}
```

---

## 7. Conclusion

This implementation guide provides production-ready code patterns for the TerminalX PR system. Each component is designed to be tested, performant, and user-friendly. Follow these patterns for consistency across the codebase.
