/**
 * Global Task / Source domain types.
 *
 * A Task is independent of any project, worktree, or session. The
 * backend stores tasks under `~/.meecode/tasks/<task-id>/`.
 *
 * Phase 1 only models Task + Source listing; capture/attach/wiki
 * editing land in later phases.
 */

export interface Task {
  id: string
  name: string
  description: string
  created_at_ms: number
  updated_at_ms: number
}

/** Listing entry — includes derived `source_count` to skip a refetch. */
export interface TaskSummary {
  id: string
  name: string
  description: string
  created_at_ms: number
  updated_at_ms: number
  source_count: number
}

export type SourceKind = 'qa_block' | 'selection' | 'manual'

export interface SourceOrigin {
  session_id: string | null
  qa_id: string | null
  project_path: string | null
}

export interface Source {
  id: string
  task_id: string
  /** Backend stores the string verbatim — keep the union narrow but tolerate unknowns. */
  kind: SourceKind | string
  /** Human-authored label shown in the source list. May be empty for
   *  sources captured before titles existed — UI derives a fallback. */
  title: string
  content: string
  origin: SourceOrigin
  captured_at_ms: number
  /** Set by the organize loop when this Source has been folded into the wiki. */
  processed_at_ms?: number | null
}

export interface WikiFile {
  name: string
  size_bytes: number
  /** Absolute path on disk — the file viewer opens this directly. */
  path: string
}

export interface OrganizePreview {
  task_id: string
  unprocessed_count: number
  resume_session_id: string | null
}

export type OrganizeStatus = 'idle' | 'running' | 'error'

export interface SessionTaskBinding {
  session_id: string
  task_id: string
  attached_at_ms: number
}
