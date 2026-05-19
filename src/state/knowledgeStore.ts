/**
 * Per-project knowledge store: pins, wiki files, organize-job state.
 *
 * Keyed by project_path (not tab id) because pins/wiki are a property of
 * the project on disk, not the chat tab. Two tabs on the same project
 * see the same pins.
 */
import { listen } from '@tauri-apps/api/event'
import type {
  OrganizeStatus,
  Pin,
  WikiDiffEntry,
  WikiFileMeta,
} from '../types'

export interface ProjectKnowledge {
  pins: Pin[]
  wiki: WikiFileMeta[]
  status: OrganizeStatus
  progressChars: number
  diff: WikiDiffEntry[] | null
  error: string | null
}

export function initialProjectKnowledge(): ProjectKnowledge {
  return {
    pins: [],
    wiki: [],
    status: 'idle',
    progressChars: 0,
    diff: null,
    error: null,
  }
}

const state = new Map<string, ProjectKnowledge>()
const subscribers = new Map<string, Set<() => void>>()

function getOrCreate(projectPath: string): ProjectKnowledge {
  let p = state.get(projectPath)
  if (!p) {
    p = initialProjectKnowledge()
    state.set(projectPath, p)
  }
  return p
}

function notify(projectPath: string) {
  const subs = subscribers.get(projectPath)
  if (!subs) return
  for (const cb of subs) cb()
}

export function getKnowledgeSnapshot(projectPath: string): ProjectKnowledge {
  return getOrCreate(projectPath)
}

export function subscribeKnowledge(
  projectPath: string,
  cb: () => void,
): () => void {
  let subs = subscribers.get(projectPath)
  if (!subs) {
    subs = new Set()
    subscribers.set(projectPath, subs)
  }
  subs.add(cb)
  return () => {
    subs!.delete(cb)
  }
}

export function setKnowledge(
  projectPath: string,
  updater: (prev: ProjectKnowledge) => ProjectKnowledge,
): void {
  const prev = getOrCreate(projectPath)
  const next = updater(prev)
  if (next === prev) return
  state.set(projectPath, next)
  notify(projectPath)
}

let bootstrapped = false

export function bootstrapKnowledgeListeners(): void {
  if (bootstrapped) return
  bootstrapped = true

  listen<{ project_path: string }>('organize:start', (e) => {
    setKnowledge(e.payload.project_path, (s) => ({
      ...s,
      status: 'running',
      progressChars: 0,
      diff: null,
      error: null,
    }))
  })

  listen<{ project_path: string; chars: number }>(
    'organize:progress',
    (e) => {
      setKnowledge(e.payload.project_path, (s) => ({
        ...s,
        progressChars: e.payload.chars,
      }))
    },
  )

  listen<{
    project_path: string
    files: WikiDiffEntry[]
    raw_chars: number
  }>('organize:diff', (e) => {
    setKnowledge(e.payload.project_path, (s) => ({
      ...s,
      status: 'diff-ready',
      diff: e.payload.files,
      error:
        e.payload.files.length === 0
          ? `정리 응답에서 <wiki-file> 블록을 찾지 못했습니다 (raw ${e.payload.raw_chars}자).`
          : null,
    }))
  })

  listen<{ project_path: string | null }>('organize:exit', (e) => {
    if (!e.payload.project_path) return
    setKnowledge(e.payload.project_path, (s) => {
      // If we already produced a diff, stay in diff-ready. Otherwise
      // claude exited without giving us anything — fall back to idle so
      // the UI doesn't get stuck on a spinner.
      if (s.status === 'diff-ready') return s
      return { ...s, status: 'idle' }
    })
  })

  listen<{ project_path: string | null }>('organize:cancelled', (e) => {
    if (!e.payload.project_path) return
    setKnowledge(e.payload.project_path, (s) => ({
      ...s,
      status: 'idle',
      diff: null,
    }))
  })

  listen<{ line: string }>('organize:stderr', (e) => {
    console.warn('[organize stderr]', e.payload.line)
  })
}
