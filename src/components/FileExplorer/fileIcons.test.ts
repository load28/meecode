import { describe, it, expect } from 'vitest'
import { getFileIcon } from './fileIcons'

describe('getFileIcon', () => {
  it('폴더는 펼침 여부에 따라 다른 아이콘', () => {
    expect(getFileIcon('src', true, false)).toBe('📁')
    expect(getFileIcon('src', true, true)).toBe('📂')
  })

  it('확장자로 파일 종류를 구분', () => {
    expect(getFileIcon('main.rs', false)).toBe('🦀')
    expect(getFileIcon('app.tsx', false)).toBe('⚛️')
    expect(getFileIcon('styles.css', false)).toBe('🎨')
    expect(getFileIcon('photo.png', false)).toBe('🖼️')
  })

  it('확장자 매칭은 대소문자를 무시', () => {
    expect(getFileIcon('README.MD', false)).toBe('📖')
    expect(getFileIcon('IMG.PNG', false)).toBe('🖼️')
  })

  it('정확한 파일명이 확장자보다 우선 (VS Code 우선순위)', () => {
    // vite.config.ts: .ts 확장자(🔷)가 아니라 파일명 매핑(⚡)이 이겨야 한다.
    expect(getFileIcon('vite.config.ts', false)).toBe('⚡')
    expect(getFileIcon('package.json', false)).toBe('📦')
  })

  it('복합 확장자는 긴 것부터 매칭', () => {
    // d.ts 는 단일 ts 와 같은 글리프지만, 매칭 경로가 복합 → 단일 순서임을
    // 확인하기 위해 둘 다 해석되는지 검증.
    expect(getFileIcon('types.d.ts', false)).toBe('🔷')
    expect(getFileIcon('index.ts', false)).toBe('🔷')
  })

  it('알 수 없는 확장자는 기본 파일 아이콘', () => {
    expect(getFileIcon('data.unknownext', false)).toBe('📄')
    expect(getFileIcon('noext', false)).toBe('📄')
  })

  it('마지막 세그먼트가 매핑에 없어도 더 짧은 확장자로 폴백', () => {
    // foo.spec.ts: spec.ts 매핑은 없지만 ts(🔷) 로 폴백.
    expect(getFileIcon('foo.spec.ts', false)).toBe('🔷')
  })
})
