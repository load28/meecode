import { useEffect, useState } from 'react'
import type { Pin, WikiFileMeta } from '../../types'
import { useProjectKnowledge } from '../../hooks/useProjectKnowledge'
import { renderMarkdown } from '../MessageBubble'
import './KnowledgePanel.css'

type Tab = 'pins' | 'wiki' | 'organize'

interface Props {
  projectPath: string
  onClose: () => void
}

function fmtRelative(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 60_000) return '방금'
  const m = Math.floor(diff / 60_000)
  if (m < 60) return `${m}분 전`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}시간 전`
  const d = Math.floor(h / 24)
  return `${d}일 전`
}

function truncate(s: string, n: number): string {
  const first = s.split('\n')[0] ?? ''
  return first.length <= n ? first : `${first.slice(0, n)}…`
}

export function KnowledgePanel({ projectPath, onClose }: Props) {
  const knowledge = useProjectKnowledge(projectPath)
  const [tab, setTab] = useState<Tab>('pins')
  const [expandedPinId, setExpandedPinId] = useState<string | null>(null)

  // Auto-switch to organize tab while a job is running or diff is pending.
  useEffect(() => {
    if (
      knowledge.status === 'running' ||
      knowledge.status === 'diff-ready' ||
      knowledge.status === 'error'
    ) {
      setTab('organize')
    }
  }, [knowledge.status])

  return (
    <div className="knowledge-panel">
      <header className="knowledge-panel__header">
        <h2 className="knowledge-panel__title">📚 프로젝트 노트</h2>
        <button
          type="button"
          className="knowledge-panel__close"
          onClick={onClose}
          aria-label="패널 닫기"
        >
          ×
        </button>
      </header>
      <nav className="knowledge-panel__tabs">
        <button
          type="button"
          className={`knowledge-panel__tab${tab === 'pins' ? ' is-active' : ''}`}
          onClick={() => setTab('pins')}
        >
          📌 핀 ({knowledge.pins.length})
        </button>
        <button
          type="button"
          className={`knowledge-panel__tab${tab === 'wiki' ? ' is-active' : ''}`}
          onClick={() => setTab('wiki')}
        >
          📖 위키 ({knowledge.wiki.length})
        </button>
        <button
          type="button"
          className={`knowledge-panel__tab${tab === 'organize' ? ' is-active' : ''}`}
          onClick={() => setTab('organize')}
        >
          ✨ 정리
          {knowledge.status === 'running' && (
            <span className="knowledge-panel__tab-badge">●</span>
          )}
        </button>
      </nav>
      <div className="knowledge-panel__body">
        {tab === 'pins' && (
          <PinsTab
            pins={knowledge.pins}
            expandedId={expandedPinId}
            onToggleExpand={(id) =>
              setExpandedPinId((cur) => (cur === id ? null : id))
            }
            onDelete={knowledge.unpin}
          />
        )}
        {tab === 'wiki' && (
          <WikiTab
            wiki={knowledge.wiki}
            readWiki={knowledge.readWiki}
            onDelete={knowledge.deleteWiki}
          />
        )}
        {tab === 'organize' && (
          <OrganizeTab
            status={knowledge.status}
            progressChars={knowledge.progressChars}
            diff={knowledge.diff}
            error={knowledge.error}
            pinsCount={knowledge.pins.length}
            onStart={knowledge.startOrganize}
            onCancel={knowledge.cancelOrganize}
            onApply={knowledge.applyWikiDiff}
            onDismiss={knowledge.dismissDiff}
          />
        )}
      </div>
    </div>
  )
}

interface PinsTabProps {
  pins: Pin[]
  expandedId: string | null
  onToggleExpand: (id: string) => void
  onDelete: (id: string) => Promise<void>
}

function PinsTab({ pins, expandedId, onToggleExpand, onDelete }: PinsTabProps) {
  if (pins.length === 0) {
    return (
      <div className="knowledge-panel__empty">
        <p>아직 핀이 없습니다.</p>
        <p className="knowledge-panel__empty-hint">
          대화 메시지 옆 📌 버튼이나, 본문을 드래그한 뒤 나오는 핀 버튼으로
          스크랩할 수 있어요.
        </p>
      </div>
    )
  }
  const sorted = [...pins].sort((a, b) => b.picked_at_ms - a.picked_at_ms)
  return (
    <ul className="knowledge-panel__pins">
      {sorted.map((pin) => {
        const expanded = expandedId === pin.id
        return (
          <li key={pin.id} className="knowledge-panel__pin">
            <div className="knowledge-panel__pin-head">
              <span className="knowledge-panel__pin-marker">
                [^{pin.marker}]
              </span>
              <span className="knowledge-panel__pin-kind">{pin.segment_kind}</span>
              <span className="knowledge-panel__pin-time">
                {fmtRelative(pin.picked_at_ms)}
              </span>
              <button
                type="button"
                className="knowledge-panel__pin-toggle"
                onClick={() => onToggleExpand(pin.id)}
                aria-label={expanded ? '접기' : '펼치기'}
              >
                {expanded ? '▼' : '▶'}
              </button>
              <button
                type="button"
                className="knowledge-panel__pin-delete"
                onClick={() => void onDelete(pin.id)}
                aria-label="핀 삭제"
              >
                🗑
              </button>
            </div>
            {expanded ? (
              <pre className="knowledge-panel__pin-body">{pin.text}</pre>
            ) : (
              <div className="knowledge-panel__pin-preview">
                {truncate(pin.text, 140)}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

interface WikiTabProps {
  wiki: WikiFileMeta[]
  readWiki: (name: string) => Promise<string>
  onDelete: (name: string) => Promise<void>
}

function WikiTab({ wiki, readWiki, onDelete }: WikiTabProps) {
  const [active, setActive] = useState<string | null>(null)
  const [content, setContent] = useState<string>('')

  useEffect(() => {
    if (wiki.length > 0 && (!active || !wiki.some((w) => w.name === active))) {
      setActive(wiki[0].name)
    }
    if (wiki.length === 0) {
      setActive(null)
      setContent('')
    }
  }, [wiki, active])

  useEffect(() => {
    if (!active) {
      setContent('')
      return
    }
    let cancelled = false
    void readWiki(active).then((text) => {
      if (!cancelled) setContent(text)
    })
    return () => {
      cancelled = true
    }
  }, [active, readWiki])

  if (wiki.length === 0) {
    return (
      <div className="knowledge-panel__empty">
        <p>아직 위키 문서가 없습니다.</p>
        <p className="knowledge-panel__empty-hint">
          정리 탭에서 핀을 위키로 묶을 수 있어요.
        </p>
      </div>
    )
  }
  return (
    <div className="knowledge-panel__wiki">
      <ul className="knowledge-panel__wiki-list">
        {wiki.map((f) => (
          <li
            key={f.name}
            className={`knowledge-panel__wiki-item${
              active === f.name ? ' is-active' : ''
            }`}
          >
            <button
              type="button"
              className="knowledge-panel__wiki-name"
              onClick={() => setActive(f.name)}
            >
              {f.name}
            </button>
            <button
              type="button"
              className="knowledge-panel__wiki-del"
              onClick={() => {
                if (confirm(`${f.name}을(를) 삭제할까요?`)) {
                  void onDelete(f.name)
                }
              }}
              aria-label="위키 삭제"
            >
              🗑
            </button>
          </li>
        ))}
      </ul>
      <div className="knowledge-panel__wiki-view">
        <div
          className="knowledge-panel__wiki-md message-bubble__content"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
        />
      </div>
    </div>
  )
}

interface OrganizeTabProps {
  status: 'idle' | 'running' | 'diff-ready' | 'error'
  progressChars: number
  diff: import('../../types').WikiDiffEntry[] | null
  error: string | null
  pinsCount: number
  onStart: () => Promise<void>
  onCancel: () => Promise<void>
  onApply: (fileName: string, content: string) => Promise<void>
  onDismiss: () => void
}

function OrganizeTab({
  status,
  progressChars,
  diff,
  error,
  pinsCount,
  onStart,
  onCancel,
  onApply,
  onDismiss,
}: OrganizeTabProps) {
  return (
    <div className="knowledge-panel__organize">
      <div className="knowledge-panel__organize-controls">
        {status === 'idle' && (
          <>
            <button
              type="button"
              className="knowledge-panel__primary-btn"
              onClick={() => void onStart()}
              disabled={pinsCount === 0}
              title={
                pinsCount === 0
                  ? '핀을 먼저 추가하세요'
                  : '핀과 기존 위키를 클로드한테 정리시키기'
              }
            >
              ✨ 정리 시작 ({pinsCount} 핀)
            </button>
            <p className="knowledge-panel__hint">
              백그라운드에서 클로드 세션을 띄워 핀을 위키로 통합합니다. 결과는
              여기 diff로 표시되며 사용자가 적용을 결정합니다.
            </p>
          </>
        )}
        {status === 'running' && (
          <>
            <div className="knowledge-panel__progress">
              <span className="knowledge-panel__spinner" aria-hidden />
              <span>정리 중… ({progressChars}자 수신)</span>
            </div>
            <button
              type="button"
              className="knowledge-panel__secondary-btn"
              onClick={() => void onCancel()}
            >
              취소
            </button>
          </>
        )}
        {status === 'error' && (
          <>
            <div className="knowledge-panel__error">⚠ {error}</div>
            <button
              type="button"
              className="knowledge-panel__secondary-btn"
              onClick={onDismiss}
            >
              닫기
            </button>
          </>
        )}
        {status === 'diff-ready' && (
          <>
            <div className="knowledge-panel__diff-summary">
              {diff && diff.length > 0
                ? `📝 ${diff.length}개 파일 변경 제안`
                : error || '응답에서 변경 사항을 찾지 못했습니다.'}
            </div>
            <button
              type="button"
              className="knowledge-panel__secondary-btn"
              onClick={onDismiss}
            >
              모두 닫기
            </button>
          </>
        )}
      </div>
      {status === 'diff-ready' && diff && diff.length > 0 && (
        <div className="knowledge-panel__diffs">
          {diff.map((d) => (
            <DiffCard
              key={d.name}
              entry={d}
              onApply={() => void onApply(d.name, d.new_content)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface DiffCardProps {
  entry: import('../../types').WikiDiffEntry
  onApply: () => void
}

function DiffCard({ entry, onApply }: DiffCardProps) {
  const [view, setView] = useState<'new' | 'old' | 'rendered'>('rendered')
  const isNew = entry.old_content.length === 0
  return (
    <article className="knowledge-panel__diff-card">
      <header className="knowledge-panel__diff-head">
        <span className="knowledge-panel__diff-name">{entry.name}</span>
        <span className="knowledge-panel__diff-badge">
          {isNew ? 'NEW' : '수정'}
        </span>
        <div className="knowledge-panel__diff-view-toggle">
          <button
            type="button"
            className={view === 'rendered' ? 'is-active' : ''}
            onClick={() => setView('rendered')}
          >
            렌더
          </button>
          <button
            type="button"
            className={view === 'new' ? 'is-active' : ''}
            onClick={() => setView('new')}
          >
            새 raw
          </button>
          {!isNew && (
            <button
              type="button"
              className={view === 'old' ? 'is-active' : ''}
              onClick={() => setView('old')}
            >
              기존 raw
            </button>
          )}
        </div>
        <button
          type="button"
          className="knowledge-panel__diff-apply"
          onClick={onApply}
        >
          ✓ 적용
        </button>
      </header>
      <div className="knowledge-panel__diff-body">
        {view === 'rendered' && (
          <div
            className="knowledge-panel__diff-rendered message-bubble__content"
            dangerouslySetInnerHTML={{
              __html: renderMarkdown(entry.new_content),
            }}
          />
        )}
        {view === 'new' && (
          <pre className="knowledge-panel__diff-pre">{entry.new_content}</pre>
        )}
        {view === 'old' && (
          <pre className="knowledge-panel__diff-pre">{entry.old_content}</pre>
        )}
      </div>
    </article>
  )
}
