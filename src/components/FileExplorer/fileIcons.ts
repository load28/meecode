/**
 * File-type icon resolution modelled on VS Code's file icon themes.
 *
 * VS Code resolves an icon by matching a resource against a declarative theme
 * (`iconDefinitions` + `fileNames` / `fileExtensions` / `languageIds` + folder
 * defaults) in a fixed priority order, enforced via CSS specificity. We mirror
 * that order here in plain data, rendering each definition as an emoji glyph so
 * the explorer gains per-type icons with no extra assets or dependencies.
 *
 * Resolution priority (highest first), same as VS Code:
 *   1. exact file name (lowercased)        — FILE_NAMES
 *   2. compound extension, longest first   — FILE_EXTENSIONS ("d.ts", "test.ts")
 *   3. single extension                    — FILE_EXTENSIONS ("ts")
 *   4. generic file default
 * Folders resolve to collapsed/expanded defaults, with optional name overrides.
 */

const ICON = {
  file: '📄',
  folder: '📁',
  folderExpanded: '📂',
}

/** Exact basename (lowercased) → icon. Wins over any extension match. */
const FILE_NAMES: Record<string, string> = {
  'package.json': '📦',
  'package-lock.json': '📦',
  'yarn.lock': '📦',
  'pnpm-lock.yaml': '📦',
  'bun.lockb': '📦',
  'tsconfig.json': '🔧',
  'tsconfig.node.json': '🔧',
  'jsconfig.json': '🔧',
  'vite.config.ts': '⚡',
  'vite.config.js': '⚡',
  'vitest.config.ts': '⚡',
  'readme.md': '📖',
  readme: '📖',
  license: '⚖️',
  'license.md': '⚖️',
  licence: '⚖️',
  '.gitignore': '🌿',
  '.gitattributes': '🌿',
  '.gitmodules': '🌿',
  dockerfile: '🐳',
  '.dockerignore': '🐳',
  'docker-compose.yml': '🐳',
  'docker-compose.yaml': '🐳',
  'cargo.toml': '🦀',
  'cargo.lock': '🦀',
  makefile: '🛠️',
  '.env': '🔑',
  '.npmrc': '🔧',
  '.editorconfig': '🔧',
}

/**
 * Extension → icon. Keys are matched against the suffix segments of the
 * lowercased name, longest compound first (so `d.ts` beats `ts`).
 */
const FILE_EXTENSIONS: Record<string, string> = {
  // TypeScript / JavaScript
  'd.ts': '🔷',
  ts: '🔷',
  mts: '🔷',
  cts: '🔷',
  tsx: '⚛️',
  js: '🟨',
  mjs: '🟨',
  cjs: '🟨',
  jsx: '⚛️',
  // Other languages
  rs: '🦀',
  py: '🐍',
  go: '🐹',
  rb: '💎',
  java: '☕',
  kt: '🟪',
  kts: '🟪',
  c: '🔵',
  h: '🔵',
  cpp: '🔵',
  cc: '🔵',
  cxx: '🔵',
  hpp: '🔵',
  cs: '🟦',
  php: '🐘',
  swift: '🕊️',
  sh: '🐚',
  bash: '🐚',
  zsh: '🐚',
  lua: '🌙',
  vue: '💚',
  svelte: '🧡',
  // Markup / style / data
  html: '🌐',
  htm: '🌐',
  css: '🎨',
  scss: '🎨',
  sass: '🎨',
  less: '🎨',
  json: '🧾',
  jsonc: '🧾',
  yaml: '⚙️',
  yml: '⚙️',
  toml: '⚙️',
  xml: '📰',
  md: '📝',
  markdown: '📝',
  mdx: '📝',
  env: '🔑',
  sql: '🗄️',
  csv: '📊',
  // Images
  png: '🖼️',
  jpg: '🖼️',
  jpeg: '🖼️',
  gif: '🖼️',
  svg: '🖼️',
  webp: '🖼️',
  ico: '🖼️',
  bmp: '🖼️',
  // Media
  mp4: '🎬',
  mov: '🎬',
  webm: '🎬',
  mkv: '🎬',
  avi: '🎬',
  mp3: '🎵',
  wav: '🎵',
  flac: '🎵',
  ogg: '🎵',
  // Archives / docs / fonts
  zip: '🗜️',
  tar: '🗜️',
  gz: '🗜️',
  rar: '🗜️',
  '7z': '🗜️',
  pdf: '📕',
  txt: '📃',
  log: '📃',
  doc: '📘',
  docx: '📘',
  xls: '📗',
  xlsx: '📗',
  ppt: '📙',
  pptx: '📙',
  ttf: '🔤',
  otf: '🔤',
  woff: '🔤',
  woff2: '🔤',
}

/**
 * Resolve the icon glyph for an explorer entry. `isExpanded` only affects
 * folders. Mirrors VS Code's name → extension → default precedence.
 */
export function getFileIcon(
  name: string,
  isDir: boolean,
  isExpanded = false,
): string {
  if (isDir) return isExpanded ? ICON.folderExpanded : ICON.folder

  const lower = name.toLowerCase()

  const byName = FILE_NAMES[lower]
  if (byName) return byName

  const segments = lower.split('.')
  for (let i = 1; i < segments.length; i++) {
    const ext = segments.slice(i).join('.')
    const byExt = FILE_EXTENSIONS[ext]
    if (byExt) return byExt
  }

  return ICON.file
}
