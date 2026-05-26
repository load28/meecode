import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { ExpandPane } from '../ExpandPane'
import { FilePanel } from '../FilePanel'
import { ChatColumn } from './ChatColumn'
import type { UseClaudeSessionResult } from '../../hooks/useClaudeSession'
import type { UseFileTabsResult, PendingEdit } from '../../hooks/useFileTabs'
import type { PendingComposerSelection } from '../../hooks/usePendingSelection'
import type { QaPair } from '../../types'
import type { CaptureSource, CodeSnippet } from '../../types/composer'
import { innerLayoutKey } from '../../state/persistedFlags'

interface SelectionApi {
  pending: PendingComposerSelection | null
  consume: () => void
  addComment: (text: string) => void
  addSnippet: (snippet: CodeSnippet) => void
}

/**
 * 채팅 컬럼은 항상 그 옆에 expand pane / file panel 두 패널과 함께 살아간다.
 * 어떤 조합으로 펼쳐지는지에 따라 채팅 컬럼의 default size가 결정된다.
 */
function chatPanelDefaultSize(
  expandOpen: boolean,
  fileTabsOpen: boolean,
): number {
  if (expandOpen && fileTabsOpen) return 40
  if (expandOpen || fileTabsOpen) return 55
  return 100
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
}

/**
 * 메인 영역의 안쪽 PanelGroup — chat / expand / file 세 패널을 묶는다.
 * 패널 사이즈는 tabId별 autoSaveId로 보존되며, 사이드 패널(Tasks) 사이즈는
 * 바깥 PanelGroup이 관리한다.
 */
export function InnerPanelGroup({
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
}: Props) {
  return (
    <PanelGroup
      direction="horizontal"
      autoSaveId={innerLayoutKey(tabId)}
    >
      <Panel
        id="chat"
        order={1}
        defaultSize={chatPanelDefaultSize(
          isExpandOpen,
          fileTabs.tabs.length > 0,
        )}
        minSize={25}
      >
        <ChatColumn
          tabId={tabId}
          claude={claude}
          projectPath={projectPath}
          recentUserTexts={recentUserTexts}
          claudeReady={claudeReady}
          pendingSelection={selection.pending}
          onSelectionConsumed={selection.consume}
          onAddComment={selection.addComment}
          onCapture={onCapture}
          onExpand={onExpand}
          onOpenFile={onOpenFile}
          onOpenSettings={onOpenSettings}
        />
      </Panel>
      {isExpandOpen && (
        <>
          <PanelResizeHandle className="resize-handle" />
          <Panel id="expand" order={2} defaultSize={30} minSize={20}>
            <ExpandPane
              pair={expandedPair}
              isOpen={isExpandOpen}
              onToggle={onToggleExpand}
              onOpenFile={onOpenFile}
              pairs={claude.pairs}
              pendingTool={claude.pendingTool}
              turnInProgress={claude.turnInProgress}
              taskActivity={claude.taskActivity}
              hookActivity={claude.hookActivity}
              onAddComment={selection.addComment}
              onCapture={onCapture}
            />
          </Panel>
        </>
      )}
      {!isDetached && fileTabs.tabs.length > 0 && (
        <>
          <PanelResizeHandle className="resize-handle" />
          <Panel id="file" order={3} defaultSize={35} minSize={20}>
            <FilePanel
              tabs={fileTabs.tabs}
              activePath={fileTabs.activePath}
              onSelect={fileTabs.setActive}
              onClose={fileTabs.close}
              onCloseAll={fileTabs.closeAll}
              onSetViewMode={fileTabs.setViewMode}
              onSetMarkdownView={fileTabs.setMarkdownView}
              onSyncTab={fileTabs.syncDisk}
              onAddSelectionToComposer={selection.addSnippet}
              onDetach={onDetachFilePanel}
            />
          </Panel>
        </>
      )}
    </PanelGroup>
  )
}
