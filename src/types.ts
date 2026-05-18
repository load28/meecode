export interface Config {
  markdown_threshold: number
  claude_path: string | null
}

export interface SelectionState {
  text: string
  rect: DOMRect | null
}

export interface QaPair {
  id: string
  user_text: string
  assistant_text: string
  timestamp: string
}
