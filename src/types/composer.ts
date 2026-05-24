/**
 * Composer 주변에서 여러 컴포넌트가 주고받는 두 종류의 데이터 모양을
 * 한 곳에 모은다. 각 컴포넌트가 인라인으로 같은 인터페이스를 반복 정의하면
 * 새 필드를 추가할 때 누락이 생기므로 통합.
 */

/**
 * QaCard / ExpandPane의 캡처 버튼 / CommentFloat가 발생시키는 capture
 * source. Task 캡처 다이얼로그(TaskPicker)는 이 source를 받아 origin을
 * 보존한 Source를 만든다.
 */
export interface CaptureSource {
  kind: 'qa_block' | 'selection'
  content: string
  qaId: string
  /** Suggested title shown pre-filled in the Task picker — user can edit. */
  suggestedTitle?: string
}

/**
 * 파일 패널에서 선택된 코드 조각을 composer에 add-context로 넘길 때 쓰는
 * payload. 줄 번호 범위는 inclusive이고, single-line 선택일 때는
 * startLine === endLine.
 */
export interface CodeSnippet {
  text: string
  path: string
  startLine: number
  endLine: number
}
