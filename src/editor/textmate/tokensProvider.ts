import * as monaco from 'monaco-editor'
import { INITIAL, type IGrammar, type StateStack } from 'vscode-textmate'
import { loadGrammarForLanguage } from './registry'
import { THEME_TOKEN_SCOPES } from '../monacoSetup'

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

function hasThemeRule(scope: string): boolean {
  return THEME_TOKEN_SCOPES.some(
    (rule) => scope === rule || scope.startsWith(rule + '.'),
  )
}

/**
 * Pick the Monaco token type for a TextMate scope stack. Monaco only sees one
 * token string and resolves its color by longest dot-prefixed rule, so passing
 * just the deepest scope drops the color whenever that scope has no rule but an
 * enclosing one does (e.g. `punctuation.definition.string` inside a `string`).
 * We instead walk the stack inside-out and return the most specific scope that
 * a theme rule actually matches — approximating, within Monaco's single-token
 * model, the full-stack selector matching VS Code's TextMate themes perform.
 */
function scopeToToken(scopes: string[]): string {
  for (let i = scopes.length - 1; i >= 0; i--) {
    if (hasThemeRule(scopes[i])) return scopes[i]
  }
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
