import { ChatStream } from '../ChatStream'
import { ChatComposer } from '../ChatComposer'
import { QueueList } from './QueueList'
import type { UseClaudeSessionResult } from '../../hooks/useClaudeSession'
import type { PendingComposerSelection } from '../../hooks/usePendingSelection'
import type { OpenFileFn } from '../ToolViews'
import type { CaptureSource } from '../../types/composer'


interface Props {
  tabId: string
  /** useClaudeSession 결과 — props 폭증을 피하기 위해 통째로 받는다. */
  claude: UseClaudeSessionResult
  projectPath: string
  recentUserTexts: string[]
  claudeReady: boolean
  pendingSelection: PendingComposerSelection | null
  onSelectionConsumed: () => void
  onAddComment: (text: string) => void
  onCapture: (input: CaptureSource) => void
  onExpand: (id: string) => void
  onOpenFile: OpenFileFn
  onOpenSettings: () => void
}

/**
 * 채팅 컬럼: ChatStream(메시지 목록) + QueueList(대기 큐) +
 * ChatComposer(입력) 한 세트. MainLayout의 가장 안쪽 panel 안에 들어가는
 * 내용물 그대로다.
 *
 * onRespondTool 콜백 안에서 'allow + updatedInput 미지정' 케이스를
 * pendingTool.input으로 보강하는 정합화 로직만 이 컴포넌트가 들고 있다.
 */
export function ChatColumn({
  tabId,
  claude,
  projectPath,
  recentUserTexts,
  claudeReady,
  pendingSelection,
  onSelectionConsumed,
  onAddComment,
  onCapture,
  onExpand,
  onOpenFile,
  onOpenSettings,
}: Props) {
  const {
    pairs,
    pendingTool,
    taskActivity,
    hookActivity,
    turnInProgress,
    respondTool,
    queue,
    removeQueued,
    mode,
    sendUserMessage,
    cycleMode,
    slashCommands,
    model,
    clearConversation,
    interrupt,
  } = claude
  return (
    <div className="app__chat">
      <ChatStream
        pairs={pairs}
        onExpand={onExpand}
        pendingTool={pendingTool}
        onOpenFile={onOpenFile}
        taskActivity={taskActivity}
        hookActivity={hookActivity}
        turnInProgress={turnInProgress}
        onAddComment={onAddComment}
        onCapture={onCapture}
        onRespondTool={(reqId, allow, tuId, updatedInput, denialMessage) => {
          const effective =
            allow && (updatedInput === undefined || updatedInput === null)
              ? pendingTool?.input ?? {}
              : updatedInput
          respondTool(reqId, allow, tuId, effective, denialMessage)
        }}
      />
      <QueueList queue={queue} onRemove={removeQueued} />
      <ChatComposer
        tabId={tabId}
        mode={mode}
        disabled={pendingTool !== null}
        sendUserMessage={sendUserMessage}
        cycleMode={cycleMode}
        slashCommands={slashCommands}
        model={model}
        // CLI parity (CancelRequestHandler.canCancelRunningTask):
        // 진행 중일 때만 stop affordance가 활성. 큐 메시지는 자체 ×
        // 버튼이 있고 턴이 정리되면 자동 drain된다.
        busy={turnInProgress}
        projectPath={projectPath}
        recentUserTexts={recentUserTexts}
        onClearConversation={clearConversation}
        pendingSelection={pendingSelection}
        onSelectionConsumed={onSelectionConsumed}
        onInterrupt={() => {
          interrupt().catch(() => {})
        }}
        claudeReady={claudeReady}
        onOpenSettings={onOpenSettings}
      />
    </div>
  )
}
