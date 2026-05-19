import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { Mode, SlashCommand } from '../../types'
import './ChatComposer.css'

// Fallback list shown before session:init delivers the authoritative
// `slash_commands` payload. Mirrors Claude Code 2.1.143's built-ins and the
// common plugin / skill slash commands so the menu has useful entries even on
// the first frame.
const BUILTIN_SLASH: Array<{ name: string; description?: string }> = [
  // Core session
  { name: '/help', description: '도움말 보기' },
  { name: '/clear', description: '대화 내역 비우기' },
  { name: '/compact', description: '대화 압축' },
  { name: '/resume', description: '세션 이어하기' },
  { name: '/exit', description: '세션 종료' },
  { name: '/quit', description: '세션 종료' },
  // Account / status
  { name: '/login', description: '로그인' },
  { name: '/logout', description: '로그아웃' },
  { name: '/status', description: '시스템 상태' },
  { name: '/cost', description: '사용량/비용 보기' },
  { name: '/usage', description: '토큰 사용량 보기' },
  // Model & behavior
  { name: '/model', description: '모델 선택' },
  { name: '/think-harder', description: '더 깊이 사고' },
  { name: '/ultraplan', description: 'Ultra plan 모드' },
  { name: '/ultrareview', description: 'Ultra review (멀티-에이전트 검토)' },
  { name: '/config', description: '설정 변경' },
  { name: '/permissions', description: '도구 권한 관리' },
  // Workspace
  { name: '/init', description: '프로젝트 초기화' },
  { name: '/add-dir', description: '작업 디렉토리 추가' },
  { name: '/diff', description: '변경 사항 보기' },
  { name: '/todos', description: 'TODO 목록 보기' },
  { name: '/memory', description: '메모리 보기' },
  { name: '/export', description: '대화 export' },
  // Tooling
  { name: '/agents', description: '에이전트 목록' },
  { name: '/mcp', description: 'MCP 서버 관리' },
  { name: '/ide', description: 'IDE 통합' },
  { name: '/vim', description: 'Vim 모드 토글' },
  { name: '/install-github-app', description: 'GitHub 앱 설치' },
  { name: '/migrate-installer', description: '인스톨러 마이그레이션' },
  // Workflow / loop / schedule
  { name: '/loop', description: 'Loop 모드 시작' },
  { name: '/schedule', description: '작업 스케줄' },
  { name: '/review', description: '코드 리뷰' },
  { name: '/security-review', description: '보안 리뷰' },
  { name: '/pr_comments', description: 'PR 댓글 가져오기' },
  // Feedback / misc
  { name: '/bug', description: '버그 리포트' },
  { name: '/feedback', description: '피드백 전송' },
  { name: '/release-notes', description: '릴리즈 노트' },
  { name: '/upgrade', description: '업그레이드' },
  { name: '/remember', description: '메모리에 기억' },
  // Plugin namespaces (matches actual plugin slash commands seen in VS Code)
  { name: '/superpowers:brainstorming', description: '아이디어를 디자인으로' },
  { name: '/superpowers:writing-plans', description: '구현 계획 작성' },
  { name: '/superpowers:executing-plans', description: '계획 실행' },
  { name: '/superpowers:subagent-driven-development', description: '서브에이전트 주도 개발' },
  { name: '/superpowers:test-driven-development', description: 'TDD 워크플로우' },
  { name: '/superpowers:debugging', description: '체계적 디버깅' },
  { name: '/superpowers:requesting-code-review', description: '코드 리뷰 요청' },
  { name: '/superpowers:finishing-a-development-branch', description: '브랜치 마무리' },
  { name: '/superpowers:using-git-worktrees', description: 'Git worktree 격리' },
  { name: '/context7:resolve-library-id', description: 'Context7 라이브러리 검색' },
  { name: '/context7:query-docs', description: 'Context7 문서 질의' },
  { name: '/honcho:chat', description: 'Honcho 메모리 대화' },
  { name: '/honcho:get_context', description: 'Honcho 컨텍스트 조회' },
  { name: '/serena:activate_project', description: 'Serena 프로젝트 활성화' },
  { name: '/serena:find_symbol', description: 'Serena 심볼 검색' },
]

const MODE_LABEL: Record<Mode, string> = {
  default: '⏎ 기본 모드',
  plan: '📋 Plan 모드',
  'auto-accept': '⚡ Auto-accept 모드',
}

interface Props {
  mode: Mode
  disabled: boolean
  sendUserMessage: (
    text: string,
    images?: Array<{ media_type: string; data: string }>,
  ) => Promise<void>
  cycleMode: () => void
  slashCommands?: SlashCommand[]
  model?: string | null
  onInterrupt?: () => void
  busy?: boolean
  projectPath?: string
  recentUserTexts?: string[]
  onClearConversation?: () => void
  pendingContext?: { id: number; text: string } | null
  onContextConsumed?: () => void
}

interface PendingImage {
  id: string
  mediaType: string
  data: string // base64 (no prefix)
  previewUrl: string // data: URL
}

interface MentionState {
  startIndex: number
  query: string
}

export function ChatComposer({
  mode,
  disabled,
  sendUserMessage,
  cycleMode,
  slashCommands,
  model,
  onInterrupt,
  busy,
  projectPath,
  recentUserTexts,
  onClearConversation,
  pendingContext,
  onContextConsumed,
}: Props) {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [showSlash, setShowSlash] = useState(false)
  const [slashIdx, setSlashIdx] = useState(0)
  const [mention, setMention] = useState<MentionState | null>(null)
  const [mentionResults, setMentionResults] = useState<string[]>([])
  const [mentionIdx, setMentionIdx] = useState(0)
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([])
  const [historyIdx, setHistoryIdx] = useState<number | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const isComposingRef = useRef(false)
  const slashListRef = useRef<HTMLUListElement | null>(null)
  const mentionListRef = useRef<HTMLUListElement | null>(null)
  const lastContextIdRef = useRef<number | null>(null)

  useEffect(() => {
    if (!pendingContext) return
    if (lastContextIdRef.current === pendingContext.id) return
    lastContextIdRef.current = pendingContext.id
    setValue((v) => {
      const sep = v && !v.endsWith('\n') ? '\n' : ''
      return v + sep + pendingContext.text
    })
    requestAnimationFrame(() => {
      const ta = textareaRef.current
      if (ta) {
        ta.focus()
        ta.setSelectionRange(ta.value.length, ta.value.length)
      }
    })
    onContextConsumed?.()
  }, [pendingContext, onContextConsumed])

  useEffect(() => {
    if (!showSlash) return
    const list = slashListRef.current
    if (!list) return
    const item = list.children[slashIdx] as HTMLElement | undefined
    if (item && typeof item.scrollIntoView === 'function') {
      item.scrollIntoView({ block: 'nearest' })
    }
  }, [slashIdx, showSlash])

  useEffect(() => {
    if (!mention) return
    const list = mentionListRef.current
    if (!list) return
    const item = list.children[mentionIdx] as HTMLElement | undefined
    if (item && typeof item.scrollIntoView === 'function') {
      item.scrollIntoView({ block: 'nearest' })
    }
  }, [mentionIdx, mention])

  const submit = async () => {
    if (!value && pendingImages.length === 0) return
    const snapshot = value
    const images = pendingImages.map((p) => ({
      media_type: p.mediaType,
      data: p.data,
    }))
    setError(null)
    try {
      await sendUserMessage(snapshot, images.length > 0 ? images : undefined)
      setValue('')
      setPendingImages([])
      setShowSlash(false)
      setMention(null)
    } catch (e) {
      setError(String(e))
    }
  }

  const ingestFile = async (file: File): Promise<PendingImage | null> => {
    if (!file.type.startsWith('image/')) return null
    const buf = await file.arrayBuffer()
    const bytes = new Uint8Array(buf)
    let binary = ''
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
    const base64 = btoa(binary)
    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      mediaType: file.type,
      data: base64,
      previewUrl: `data:${file.type};base64,${base64}`,
    }
  }

  const onPaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData?.items ?? [])
    const images = items.filter((i) => i.kind === 'file' && i.type.startsWith('image/'))
    if (images.length === 0) return
    e.preventDefault()
    for (const item of images) {
      const file = item.getAsFile()
      if (!file) continue
      const img = await ingestFile(file)
      if (img) setPendingImages((prev) => [...prev, img])
    }
  }

  const onDrop = async (e: React.DragEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.dataTransfer.files ?? [])
    const images = files.filter((f) => f.type.startsWith('image/'))
    if (images.length === 0) return
    e.preventDefault()
    for (const f of images) {
      const img = await ingestFile(f)
      if (img) setPendingImages((prev) => [...prev, img])
    }
  }

  const removeImage = (id: string) => {
    setPendingImages((prev) => prev.filter((p) => p.id !== id))
  }

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const openFilePicker = () => {
    fileInputRef.current?.click()
  }
  const onFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    for (const f of files) {
      const img = await ingestFile(f)
      if (img) setPendingImages((prev) => [...prev, img])
    }
    e.target.value = ''
  }

  const detectMention = (text: string, caret: number): MentionState | null => {
    if (caret === 0) return null
    let i = caret - 1
    while (i >= 0) {
      const ch = text[i]
      if (ch === '@') {
        const before = i === 0 ? ' ' : text[i - 1]
        if (before === ' ' || before === '\n' || i === 0) {
          return { startIndex: i, query: text.slice(i + 1, caret) }
        }
        return null
      }
      if (ch === ' ' || ch === '\n' || ch === '\t') return null
      i--
    }
    return null
  }

  useEffect(() => {
    if (!mention || !projectPath) {
      setMentionResults([])
      return
    }
    let alive = true
    const run = async () => {
      try {
        const results = await invoke<string[]>('search_files', {
          args: { project_path: projectPath, query: mention.query },
        })
        if (alive) setMentionResults(results)
      } catch {
        if (alive) setMentionResults([])
      }
    }
    run()
    return () => {
      alive = false
    }
  }, [mention, projectPath])

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      isComposingRef.current ||
      e.keyCode === 229 ||
      (e.nativeEvent as KeyboardEvent).isComposing
    ) {
      return
    }
    // Slash command palette navigation takes priority.
    if (showSlash && allSlashes.length > 0 && !mention) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSlashIdx((i) => Math.min(i + 1, allSlashes.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSlashIdx((i) => Math.max(i - 1, 0))
        return
      }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        e.preventDefault()
        const pick = allSlashes[Math.min(slashIdx, allSlashes.length - 1)]
        if (pick) onSelectSlash(pick.name)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setShowSlash(false)
        return
      }
    }
    // Mention palette navigation.
    if (mention && mentionResults.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionIdx((i) => Math.min(i + 1, mentionResults.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionIdx((i) => Math.max(i - 1, 0))
        return
      }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        e.preventDefault()
        const pick = mentionResults[Math.min(mentionIdx, mentionResults.length - 1)]
        if (pick) onSelectMention(pick)
        return
      }
    }
    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault()
      cycleMode()
      return
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'l' || e.key === 'L') && onClearConversation) {
      e.preventDefault()
      onClearConversation()
      return
    }
    if (
      e.key === 'ArrowUp' &&
      !e.shiftKey &&
      recentUserTexts &&
      recentUserTexts.length > 0 &&
      value === '' &&
      historyIdx === null
    ) {
      e.preventDefault()
      const lastIdx = recentUserTexts.length - 1
      setHistoryIdx(lastIdx)
      setValue(recentUserTexts[lastIdx])
      return
    }
    if (e.key === 'ArrowUp' && historyIdx !== null && historyIdx > 0) {
      e.preventDefault()
      const next = historyIdx - 1
      setHistoryIdx(next)
      setValue(recentUserTexts![next])
      return
    }
    if (e.key === 'ArrowDown' && historyIdx !== null) {
      e.preventDefault()
      if (historyIdx < (recentUserTexts?.length ?? 0) - 1) {
        const next = historyIdx + 1
        setHistoryIdx(next)
        setValue(recentUserTexts![next])
      } else {
        setHistoryIdx(null)
        setValue('')
      }
      return
    }
    if (e.key === 'Escape') {
      if (mention) {
        e.preventDefault()
        setMention(null)
        return
      }
      if (busy && onInterrupt) {
        e.preventDefault()
        onInterrupt()
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  const allSlashes: SlashCommand[] = (() => {
    const dynamic = slashCommands ?? []
    const seen = new Set<string>()
    const out: SlashCommand[] = []
    // Dynamic (from session:init) is authoritative — list it first.
    for (const c of [...dynamic, ...BUILTIN_SLASH]) {
      const key = c.name.startsWith('/') ? c.name : '/' + c.name
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ ...c, name: key })
    }
    const q = value.trim().toLowerCase()
    if (!q.startsWith('/')) return []
    return out.filter((c) => c.name.toLowerCase().startsWith(q))
  })()

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value
    const caret = e.target.selectionStart ?? v.length
    setValue(v)
    setShowSlash(v.startsWith('/'))
    setSlashIdx(0)
    setMention(detectMention(v, caret))
    setMentionIdx(0)
    setHistoryIdx(null)
  }

  const onSelectSlash = (cmd: string) => {
    setValue(cmd + ' ')
    setShowSlash(false)
  }

  const onSelectMention = (path: string) => {
    if (!mention) return
    const before = value.slice(0, mention.startIndex)
    const after = value.slice(mention.startIndex + 1 + mention.query.length)
    const inserted = `@${path} `
    const next = before + inserted + after
    setValue(next)
    setMention(null)
    const ta = textareaRef.current
    if (ta) {
      const pos = (before + inserted).length
      requestAnimationFrame(() => {
        ta.focus()
        ta.setSelectionRange(pos, pos)
      })
    }
  }

  return (
    <div className="chat-composer">
      {error && (
        <div role="alert" className="chat-composer__error">
          {error}
        </div>
      )}
      {showSlash && allSlashes.length > 0 && !mention && (
        <ul ref={slashListRef} className="chat-composer__slash" role="listbox">
          {allSlashes.map((c, i) => (
            <li key={c.name}>
              <button
                type="button"
                className={
                  'chat-composer__slash-item' +
                  (i === slashIdx ? ' is-selected' : '')
                }
                onMouseEnter={() => setSlashIdx(i)}
                onClick={() => onSelectSlash(c.name)}
              >
                <span className="chat-composer__slash-name">{c.name}</span>
                {c.description && (
                  <span className="chat-composer__slash-desc">{c.description}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {mention && mentionResults.length > 0 && (
        <ul ref={mentionListRef} className="chat-composer__mention" role="listbox">
          {mentionResults.slice(0, 20).map((p, i) => (
            <li key={p}>
              <button
                type="button"
                className={
                  'chat-composer__mention-item' +
                  (i === mentionIdx ? ' is-selected' : '')
                }
                onMouseEnter={() => setMentionIdx(i)}
                onClick={() => onSelectMention(p)}
              >
                <span className="chat-composer__mention-path">{p}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {pendingImages.length > 0 && (
        <div className="chat-composer__attachments">
          {pendingImages.map((img) => (
            <div key={img.id} className="chat-composer__attachment">
              <img src={img.previewUrl} alt="첨부 이미지" />
              <button
                type="button"
                className="chat-composer__attachment-remove"
                onClick={() => removeImage(img.id)}
                aria-label="이미지 제거"
                title="제거"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="chat-composer__row">
        <textarea
          ref={textareaRef}
          className="chat-composer__textarea"
          value={value}
          disabled={disabled}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onDrop={onDrop}
          onDragOver={(e) => e.preventDefault()}
          onCompositionStart={() => {
            isComposingRef.current = true
          }}
          onCompositionEnd={() => {
            isComposingRef.current = false
          }}
          placeholder={
            disabled
              ? '도구 승인을 먼저 처리하세요…'
              : '메시지를 입력하세요 (Enter 전송 · Shift+Enter 줄바꿈 · @로 파일 · 이미지 paste/drop 지원)'
          }
          rows={2}
        />
        <div className="chat-composer__buttons">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            onChange={onFileInputChange}
          />
          <button
            type="button"
            onClick={openFilePicker}
            title="이미지 첨부"
            aria-label="이미지 첨부"
          >
            🖼
          </button>
          {onInterrupt && (
            <button
              type="button"
              className={
                'chat-composer__interrupt' +
                (busy ? ' is-active' : ' is-idle')
              }
              onClick={busy ? onInterrupt : undefined}
              disabled={!busy}
              title={busy ? '진행 중인 작업 취소 (ESC)' : '진행 중인 작업 없음'}
              aria-label="진행 중인 작업 중단"
            >
              <span className="chat-composer__interrupt-icon" aria-hidden="true">
                ⛔
              </span>
              <span className="chat-composer__interrupt-label">중단</span>
            </button>
          )}
          <button type="button" onClick={() => cycleMode()}>
            Shift+Tab
          </button>
        </div>
      </div>
      <div className="chat-composer__status" data-mode={mode}>
        <span>{MODE_LABEL[mode]}</span>
        {model && <span className="chat-composer__model">· {model}</span>}
      </div>
    </div>
  )
}
