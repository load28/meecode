import * as monaco from 'monaco-editor'
import { INITIAL, type IGrammar, type StateStack } from 'vscode-textmate'
import { loadGrammarForLanguage } from './registry'

// Wraps a TextMate rule stack as a Monaco tokenizer state. Equality is by
// reference: vscode-textmate returns the same StateStack when a line doesn't
// change the stack, so identical references mean "no rescan needed".
class TextMateState implements monaco.languages.IState {
  constructor(readonly ruleStack: StateStack) {}
  clone(): monaco.languages.IState {
    return new TextMateState(this.ruleStack)
  }
  equals(other: monaco.languages.IState): boolean {
    return other instanceof TextMateState && other.ruleStack === this.ruleStack
  }
}

/**
 * The deepest (most specific) TextMate scope becomes the Monaco token type.
 * Monaco resolves theme colors by longest dot-prefixed match, so a scope like
 * `keyword.control.toml` is colored by the `keyword` (or `keyword.control`)
 * theme rule — the same resolution VS Code's TextMate themes use.
 */
function scopeToToken(scopes: string[]): string {
  return scopes.length ? scopes[scopes.length - 1] : ''
}

function createTokensProvider(
  grammar: IGrammar,
): monaco.languages.TokensProvider {
  return {
    getInitialState: () => new TextMateState(INITIAL),
    tokenize(line, state) {
      const result = grammar.tokenizeLine(
        line,
        (state as TextMateState).ruleStack,
      )
      return {
        tokens: result.tokens.map((t) => ({
          startIndex: t.startIndex,
          scopes: scopeToToken(t.scopes),
        })),
        endState: new TextMateState(result.ruleStack),
      }
    },
  }
}

/**
 * Replace a language's tokenizer with its TextMate grammar (when a plugin
 * provided one). Returns a disposable that unregisters the tokenizer, or null
 * if no grammar is available for the language.
 */
export async function wireTextMate(
  languageId: string,
): Promise<monaco.IDisposable | null> {
  const grammar = await loadGrammarForLanguage(languageId)
  if (!grammar) return null
  return monaco.languages.setTokensProvider(
    languageId,
    createTokensProvider(grammar),
  )
}
