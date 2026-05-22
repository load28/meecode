import { SlashMenu } from './SlashMenu'
import { MentionMenu } from './MentionMenu'
import type { UseSlashMenuResult } from '../../hooks/useSlashMenu'
import type { UseMentionMenuResult } from '../../hooks/useMentionMenu'

interface Props {
  slash: UseSlashMenuResult
  mention: UseMentionMenuResult
}

/**
 * composer 카드 위에 떠있는 두 팝오버 — slash 명령 팔레트와 @ 멘션 자동완성.
 * 둘은 mutually exclusive: 멘션이 활성이면 slash는 숨긴다.
 */
export function ComposerMenus({ slash, mention }: Props) {
  return (
    <>
      {slash.show && slash.items.length > 0 && !mention.state && (
        <SlashMenu
          ref={slash.listRef}
          items={slash.items}
          selectedIndex={slash.selectedIndex}
          onHover={slash.setSelectedIndex}
          onSelect={slash.select}
        />
      )}
      {mention.state && mention.results.length > 0 && (
        <MentionMenu
          ref={mention.listRef}
          results={mention.results}
          selectedIndex={mention.selectedIndex}
          onHover={mention.setSelectedIndex}
          onSelect={mention.select}
        />
      )}
    </>
  )
}
