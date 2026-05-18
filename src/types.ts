export interface Config {
  markdown_threshold: number
  claude_path: string | null
}

export interface SelectionState {
  text: string
  rect: DOMRect | null
}
