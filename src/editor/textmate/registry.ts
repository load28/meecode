import { Registry, parseRawGrammar, type IGrammar } from 'vscode-textmate'
import { getOnigLib } from './onig'

export interface GrammarSource {
  scopeName: string
  /** Raw grammar text (tmLanguage in JSON or plist form). */
  content: string
  /** Defaults to 'json'. plist grammars (older `.tmLanguage`) set 'plist'. */
  format?: 'json' | 'plist'
}

// scopeName -> source, filled in as plugins contribute grammars.
const grammarSources = new Map<string, GrammarSource>()
// languageId -> scopeName
const languageToScope = new Map<string, string>()

let registry: Registry | null = null

function getRegistry(): Registry {
  if (registry) return registry
  registry = new Registry({
    onigLib: getOnigLib(),
    loadGrammar: async (scopeName) => {
      const src = grammarSources.get(scopeName)
      if (!src) return null
      return parseRawGrammar(
        src.content,
        src.format === 'plist' ? `${scopeName}.plist` : `${scopeName}.json`,
      )
    },
  })
  return registry
}

/** Register a plugin's grammar so it can back a Monaco language's tokenizer. */
export function provideGrammar(languageId: string, src: GrammarSource): void {
  grammarSources.set(src.scopeName, src)
  languageToScope.set(languageId, src.scopeName)
}

export async function loadGrammarForLanguage(
  languageId: string,
): Promise<IGrammar | null> {
  const scope = languageToScope.get(languageId)
  if (!scope) return null
  return (await getRegistry().loadGrammar(scope)) ?? null
}
