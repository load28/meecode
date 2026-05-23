import type { ToolRequest } from '../../types'
import { pickArray, pickString } from '../../utils/inputAccess'

/**
 * Edit 미리보기에 필요한 정규화된 형태. Edit / Write / MultiEdit /
 * NotebookEdit의 input은 형태가 제각각이라 카드에서는 단일 구조로
 * 정규화해두고 DiffView에 그대로 넘긴다.
 */
export interface EditPreview {
  filePath: string
  oldText: string
  newText: string
  kind: 'edit' | 'write' | 'multiedit' | 'notebookedit'
  /** MultiEdit의 총 edit 개수. Edit/Write는 1. */
  parts: number
}

/**
 * 도구별 input에서 diff 미리보기를 만든다. 도구가 파일을 만지지 않거나
 * 필요한 file_path가 없으면 null.
 */
export function extractPreview(req: ToolRequest): EditPreview | null {
  const input = req.input
  if (!input || typeof input !== 'object') return null
  const filePath = pickString(input, 'file_path')
  switch (req.tool_name) {
    case 'Edit': {
      if (!filePath) return null
      return {
        filePath,
        oldText: pickString(input, 'old_string'),
        newText: pickString(input, 'new_string'),
        kind: 'edit',
        parts: 1,
      }
    }
    case 'Write': {
      if (!filePath) return null
      return {
        filePath,
        oldText: '',
        newText: pickString(input, 'content'),
        kind: 'write',
        parts: 1,
      }
    }
    case 'MultiEdit': {
      if (!filePath) return null
      const edits = pickArray(input, 'edits') as Array<{
        old_string?: string
        new_string?: string
      }>
      // edit pair 전부를 이어 붙여 한 diff에 모든 변경이 보이도록 한다.
      const oldText = edits
        .map((e) => (typeof e.old_string === 'string' ? e.old_string : ''))
        .join('\n')
      const newText = edits
        .map((e) => (typeof e.new_string === 'string' ? e.new_string : ''))
        .join('\n')
      return {
        filePath,
        oldText,
        newText,
        kind: 'multiedit',
        parts: edits.length,
      }
    }
    case 'NotebookEdit': {
      const nbPath = pickString(input, 'notebook_path')
      if (!nbPath) return null
      return {
        filePath: nbPath,
        oldText: '',
        newText: pickString(input, 'new_source'),
        kind: 'notebookedit',
        parts: 1,
      }
    }
    default:
      return null
  }
}

/** 카드 헤더에 띄울 한 줄 요약 — input에서 가장 의미 있을 첫 필드. */
export function summarize(input: unknown): string {
  if (!input || typeof input !== 'object') return ''
  const obj = input as Record<string, unknown>
  const candidates = [
    'command',
    'file_path',
    'pattern',
    'query',
    'url',
    'description',
    'skill',
  ]
  for (const key of candidates) {
    const v = obj[key]
    if (typeof v === 'string' && v) return v
  }
  return JSON.stringify(obj).slice(0, 200)
}
