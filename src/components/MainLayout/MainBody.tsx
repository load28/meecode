import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { TaskBrowser } from '../TaskBrowser'
import { FileExplorer } from '../FileExplorer'
import { InnerPanelGroup } from './InnerPanelGroup'
import type { UseClaudeSessionResult } from '../../hooks/useClaudeSession'
import type {
  ContentTab,
  UseFileTabsResult,
  PendingEdit,
} from '../../hooks/useFileTabs'
import type { QaPair } from '../../types'
import type { CaptureSource, CodeSnippet } from '../../types/composer'
import type { PendingComposerSelection } from '../../hooks/usePendingSelection'
import { PERSISTED_LAYOUT_KEYS } from '../../state/persistedFlags'

interface SelectionApi {
  pending: PendingComposerSelection | null
  consume: () => void
  addComment: (text: string) => void
  addSnippet: (snippet: CodeSnippet) => void
}

interface Props {
  tabId: string
  projectPath: string
  claudeReady: boolean
  claude: UseClaudeSessionResult
  fileTabs: UseFileTabsResult
  recentUserTexts: string[]
  expandedPair: QaPair | null
  isExpandOpen: boolean
  onToggleExpand: () => void
  isDetached: boolean
  onDetachFilePanel: () => void
  selection: SelectionApi
  onCapture: (input: CaptureSource) => void
  onExpand: (id: string) => void
  onOpenFile: (path: string, opts?: { pending?: PendingEdit | null }) => void
  onOpenSettings: () => void
  /** Tasks 사이드 패널의 표시 여부. */
  showTasks: boolean
  onToggleTasks: () => void
  /** 파일 탐색기 사이드 패널의 표시 여부. */
  showExplorer: boolean
  /** 탐색기에서 파일/폴더가 삭제됐을 때 — 관련 탭을 닫는다. */
  onPathDeleted: (path: string) => void
  /** 탐색기에서 파일/폴더가 이름변경/이동됐을 때 — 열린 탭 경로를 갱신한다. */
  onPathRenamed: (from: string, to: string) => void
  sessionId: string | null
  onInjectTask: (taskId: string) => Promise<void> | void
  /** Open a task source/wiki doc in the shared file viewer. */
  onOpenContent: (tab: ContentTab) => void
}

/**
 * MainLayout의 본문 — 두 단계 PanelGroup으로 main-content + (선택적)
 * Tasks 사이드 패널을 나눈다. 안쪽의 chat/expand/file 구성은 InnerPanelGroup이
 * 책임지고, 이 컴포넌트는 outer scope(앱-wide 좌우 분할)만 다룬다.
 *
 * Tasks 패널의 너비는 outer group이 관리하므로 탭을 옮겨도 같은 너비가
 * 유지된다 (autoSaveId='meecode.layout.knowledge' — 사용자 저장 데이터와의
 * 호환을 위해 옛 'knowledge' 이름을 그대로 둔다).
 */
export function MainBody({
  tabId,
  projectPath,
  claudeReady,
  claude,
  fileTabs,
  recentUserTexts,
  expandedPair,
  isExpandOpen,
  onToggleExpand,
  isDetached,
  onDetachFilePanel,
  selection,
  onCapture,
  onExpand,
  onOpenFile,
  onOpenSettings,
  showTasks,
  onToggleTasks,
  showExplorer,
  onPathDeleted,
  onPathRenamed,
  sessionId,
  onInjectTask,
  onOpenContent,
}: Props) {
  return (
    <div className="app__body">
      <PanelGroup
        direction="horizontal"
        autoSaveId={PERSISTED_LAYOUT_KEYS.mainOuter}
      >
        {showExplorer && (
          <>
            <Panel
              id="explorer"
              order={0}
              defaultSize={16}
              minSize={10}
              maxSize={40}
            >
              <FileExplorer
                projectPath={projectPath}
                activePath={fileTabs.activePath}
                onOpenFile={onOpenFile}
                onPathDeleted={onPathDeleted}
                onPathRenamed={onPathRenamed}
              />
            </Panel>
            <PanelResizeHandle className="resize-handle" />
          </>
        )}
        <Panel id="main-content" order={1} minSize={30}>
          <InnerPanelGroup
            tabId={tabId}
            projectPath={projectPath}
            claudeReady={claudeReady}
            claude={claude}
            fileTabs={fileTabs}
            recentUserTexts={recentUserTexts}
            expandedPair={expandedPair}
            isExpandOpen={isExpandOpen}
            onToggleExpand={onToggleExpand}
            isDetached={isDetached}
            onDetachFilePanel={onDetachFilePanel}
            selection={selection}
            onCapture={onCapture}
            onExpand={onExpand}
            onOpenFile={onOpenFile}
            onOpenSettings={onOpenSettings}
          />
        </Panel>
        {showTasks && (
          <>
            <PanelResizeHandle className="resize-handle" />
            <Panel id="knowledge" order={2} defaultSize={28} minSize={20}>
              <TaskBrowser
                onClose={onToggleTasks}
                sessionId={sessionId}
                projectPath={projectPath}
                onInjectTask={onInjectTask}
                onOpenContent={onOpenContent}
                onOpenFile={onOpenFile}
              />
            </Panel>
          </>
        )}
      </PanelGroup>
    </div>
  )
}
