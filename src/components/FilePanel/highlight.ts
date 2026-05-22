import Prism from 'prismjs'

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function langForPrism(lang: string): string {
  // Map our backend's language label to Prism's component names. Unknown
  // values fall back to plaintext so highlight() doesn't throw.
  if (Prism.languages[lang]) return lang
  return 'plaintext'
}

/**
 * Highlight `content` as `lang` using Prism, falling back to escaped
 * plain text when the grammar isn't loaded or Prism throws (it has a
 * narrow set of accepted token shapes; defensively escape on failure).
 */
export function highlight(content: string, lang: string): string {
  const key = langForPrism(lang)
  const grammar = Prism.languages[key]
  if (!grammar) return escapeHtml(content)
  try {
    return Prism.highlight(content, grammar, key)
  } catch {
    return escapeHtml(content)
  }
}
