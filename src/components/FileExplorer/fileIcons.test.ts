import { describe, it, expect } from 'vitest'
import { getFileIcon } from './fileIcons'
import {
  ICON_DEFS,
  FILE_DEFAULT,
  FILE_NAMES,
  LANGUAGE_IDS,
} from './setiIconsData'

describe('getFileIcon', () => {
  it('폴더는 Seti 폰트가 아닌 이모지로, 펼침 여부에 따라 다름', () => {
    expect(getFileIcon('src', true, false)).toEqual({ char: '📁', seti: false })
    expect(getFileIcon('src', true, true)).toEqual({ char: '📂', seti: false })
  })

  it('확장자 → 언어 ID 경로로 Seti 글리프를 해석', () => {
    const ts = getFileIcon('main.ts', false)
    expect(ts.seti).toBe(true)
    expect(ts.char).toBe(ICON_DEFS[LANGUAGE_IDS.typescript].c)
    expect(ts.color).toBe(ICON_DEFS[LANGUAGE_IDS.typescript].color)
  })

  it('확장자 매칭은 대소문자를 무시', () => {
    expect(getFileIcon('MAIN.TS', false)).toEqual(getFileIcon('main.ts', false))
  })

  it('정확한 파일명이 확장자보다 우선 (VS Code 우선순위)', () => {
    // readme.md: markdown 확장자가 아니라 fileNames(_info) 가 이겨야 한다.
    const readme = getFileIcon('readme.md', false)
    expect(readme.char).toBe(ICON_DEFS[FILE_NAMES['readme.md']].c)
    const plainMd = getFileIcon('notes.md', false)
    expect(readme.char).not.toBe(plainMd.char)
  })

  it('확장자 없는 특수 파일명은 언어 ID로 해석', () => {
    const docker = getFileIcon('Dockerfile', false)
    expect(docker.char).toBe(ICON_DEFS[LANGUAGE_IDS.dockerfile].c)
  })

  it('알 수 없는 확장자는 기본 파일 아이콘', () => {
    const unknown = getFileIcon('data.zzzunknown', false)
    expect(unknown.char).toBe(ICON_DEFS[FILE_DEFAULT].c)
    expect(getFileIcon('noext', false).char).toBe(ICON_DEFS[FILE_DEFAULT].c)
  })

  it('마지막 세그먼트가 매핑에 없어도 더 짧은 확장자로 폴백', () => {
    // foo.spec.ts: spec.ts 매핑은 없지만 ts → typescript 로 폴백.
    expect(getFileIcon('foo.spec.ts', false).char).toBe(
      ICON_DEFS[LANGUAGE_IDS.typescript].c,
    )
  })
})
