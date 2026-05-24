/**
 * File-type icon resolution using VS Code's default file icon theme (Seti).
 *
 * VS Code resolves a file's icon against the theme in a fixed priority order
 * (file name → file extension → language id → default), enforced through CSS
 * specificity. We replicate that exact chain here against the vendored Seti
 * theme data (`setiIconsData.ts`) and the Seti icon font (`seti.woff`). The one
 * piece VS Code gets from its language registry — extension/name → language id —
 * is reproduced by EXT_TO_LANG / NAME_TO_LANG below, covering the language ids
 * the Seti theme actually maps.
 *
 * Seti defines no folder icons, so folders fall back to emoji glyphs (matching
 * the explorer's previous look); only files use the Seti font.
 */

import {
  ICON_DEFS,
  FILE_DEFAULT,
  FILE_NAMES,
  FILE_EXTENSIONS,
  LANGUAGE_IDS,
} from './setiIconsData'

export interface FileIcon {
  /** Glyph to render. */
  char: string
  /** Glyph color (Seti icons are colored); undefined → inherit. */
  color?: string
  /** When true, render `char` with the Seti icon font. */
  seti: boolean
}

const FOLDER: FileIcon = { char: '📁', seti: false }
const FOLDER_OPEN: FileIcon = { char: '📂', seti: false }

/** Extension → VS Code language id, restricted to ids the Seti theme maps. */
const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'typescriptreact',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  es6: 'javascript',
  jsx: 'javascriptreact',
  py: 'python',
  pyi: 'python',
  pyw: 'python',
  rb: 'ruby',
  gemspec: 'ruby',
  rake: 'ruby',
  rs: 'rust',
  go: 'go',
  java: 'java',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  hh: 'cpp',
  hxx: 'cpp',
  cs: 'csharp',
  csx: 'csharp',
  php: 'php',
  phtml: 'php',
  html: 'html',
  htm: 'html',
  xhtml: 'html',
  css: 'css',
  scss: 'scss',
  sass: 'sass',
  less: 'less',
  styl: 'stylus',
  md: 'markdown',
  markdown: 'markdown',
  mdown: 'markdown',
  mkd: 'markdown',
  yaml: 'yaml',
  yml: 'yaml',
  json: 'json',
  jsonc: 'jsonc',
  jsonl: 'jsonl',
  sh: 'shellscript',
  bash: 'shellscript',
  zsh: 'shellscript',
  ksh: 'shellscript',
  fish: 'shellscript',
  sql: 'sql',
  xml: 'xml',
  xsd: 'xml',
  xsl: 'xml',
  xslt: 'xml',
  plist: 'xml',
  vue: 'vue',
  swift: 'swift',
  kt: 'kotlin',
  kts: 'kotlin',
  dart: 'dart',
  lua: 'lua',
  pl: 'perl',
  pm: 'perl',
  hs: 'haskell',
  lhs: 'haskell',
  ex: 'elixir',
  exs: 'elixir',
  eex: 'elixir',
  heex: 'elixir',
  elm: 'elm',
  clj: 'clojure',
  cljs: 'clojure',
  cljc: 'clojure',
  edn: 'clojure',
  coffee: 'coffeescript',
  cson: 'coffeescript',
  fs: 'fsharp',
  fsi: 'fsharp',
  fsx: 'fsharp',
  groovy: 'groovy',
  gradle: 'gradle',
  jl: 'julia',
  r: 'r',
  m: 'objective-c',
  mm: 'objective-cpp',
  ps1: 'powershell',
  psm1: 'powershell',
  psd1: 'powershell',
  tex: 'latex',
  ltx: 'latex',
  bat: 'bat',
  cmd: 'bat',
  tf: 'terraform',
  tfvars: 'terraform',
  bicep: 'bicep',
  ml: 'ocaml',
  mli: 'ocaml',
  vala: 'vala',
  vapi: 'vala',
  hx: 'haxe',
  ini: 'properties',
  cfg: 'properties',
  conf: 'properties',
  properties: 'properties',
  env: 'dotenv',
  mk: 'makefile',
  mak: 'makefile',
  hbs: 'handlebars',
  handlebars: 'handlebars',
  mustache: 'mustache',
  pug: 'jade',
  jade: 'jade',
  haml: 'haml',
  njk: 'nunjucks',
  gd: 'godot',
  tscn: 'godot',
  tres: 'godot',
}

/** Extensionless / special base names → VS Code language id. */
const NAME_TO_LANG: Record<string, string> = {
  dockerfile: 'dockerfile',
  'docker-compose.yml': 'dockercompose',
  'docker-compose.yaml': 'dockercompose',
  makefile: 'makefile',
  gnumakefile: 'makefile',
  '.gitignore': 'ignore',
  '.npmignore': 'ignore',
  '.dockerignore': 'ignore',
  '.eslintignore': 'ignore',
  '.env': 'dotenv',
}

function defToIcon(id: string): FileIcon {
  const def = ICON_DEFS[id] ?? ICON_DEFS[FILE_DEFAULT]
  return { char: def.c, color: def.color, seti: true }
}

/**
 * Resolve the icon for an explorer entry. `isExpanded` only affects folders.
 * Mirrors VS Code's name → extension → language → default precedence.
 */
export function getFileIcon(
  name: string,
  isDir: boolean,
  isExpanded = false,
): FileIcon {
  if (isDir) return isExpanded ? FOLDER_OPEN : FOLDER

  const lower = name.toLowerCase()

  // 1) exact file name
  const byName = FILE_NAMES[lower]
  if (byName) return defToIcon(byName)

  // 2) extension, longest compound suffix first (file extension beats language)
  const segments = lower.split('.')
  for (let i = 1; i < segments.length; i++) {
    const ext = segments.slice(i).join('.')
    const byExt = FILE_EXTENSIONS[ext]
    if (byExt) return defToIcon(byExt)
    const lang = EXT_TO_LANG[ext]
    if (lang && LANGUAGE_IDS[lang]) return defToIcon(LANGUAGE_IDS[lang])
  }

  // 3) extensionless / special names resolved via language id
  const nameLang = NAME_TO_LANG[lower]
  if (nameLang && LANGUAGE_IDS[nameLang]) return defToIcon(LANGUAGE_IDS[nameLang])

  // 4) generic default
  return defToIcon(FILE_DEFAULT)
}
