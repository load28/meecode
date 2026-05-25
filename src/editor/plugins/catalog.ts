import type { LanguagePlugin } from './types'

/**
 * Built-in plugin catalog. Plugins are registered (declared to Monaco) at
 * startup but stay dormant until the user enables them in Settings — grammars
 * and language servers load only on activation, never upfront.
 *
 * TOML ships here as a worked example: Monaco has no built-in TOML support, so
 * enabling this plugin is what gives `.toml` files syntax highlighting, via a
 * lazily code-split TextMate grammar.
 */
export const BUILTIN_PLUGINS: LanguagePlugin[] = [
  {
    id: 'toml',
    label: 'TOML',
    extensions: ['.toml'],
    filenames: ['Cargo.lock', 'Pipfile'],
    aliases: ['TOML', 'toml'],
    grammar: {
      scopeName: 'source.toml',
      load: () =>
        import('./grammars/toml.tmLanguage.json?raw').then((m) => ({
          content: m.default,
          format: 'json' as const,
        })),
    },
    configuration: async () => ({
      comments: { lineComment: '#' },
      brackets: [
        ['[', ']'],
        ['{', '}'],
      ],
      autoClosingPairs: [
        { open: '[', close: ']' },
        { open: '{', close: '}' },
        { open: '"', close: '"' },
        { open: "'", close: "'" },
      ],
      surroundingPairs: [
        { open: '[', close: ']' },
        { open: '{', close: '}' },
        { open: '"', close: '"' },
        { open: "'", close: "'" },
      ],
    }),
  },
]
