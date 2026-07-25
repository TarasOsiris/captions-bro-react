// Keeps every font the document needs loaded, whatever caused it to be needed.
//
// Mounted once next to the other orchestration hooks in routes/index.tsx. It
// subscribes to the document rather than hanging off the picker, because the
// cases that matter most are the ones with NO UI action behind them: restoring a
// saved project on load, and undo/redo bringing a clip back. A load triggered
// from the font picker alone would miss both.
//
// `ensureFont` is memoized per face and never rejects, so re-running this on
// every document change is cheap and safe.

import { useEffect } from 'react'
import { useEditorStore } from '@/store/editorStore'
import { allClips } from '@/lib/model/selectors'
import { withTextDefaults } from '@/lib/model/text'
import { ensureFont } from '@/lib/text/fontLoader'

export function useFontLoader() {
  // A stable key over just the faces in play, so this effect re-runs when a
  // family/weight actually changes rather than on every keystroke.
  const faces = useEditorStore((s) => {
    const seen = new Set<string>()
    for (const clip of allClips(s.project)) {
      if (clip.type !== 'text') continue
      const style = withTextDefaults(clip.textStyle)
      seen.add(
        `${style.fontFamily}|${style.bold ? 1 : 0}|${style.italic ? 1 : 0}`,
      )
    }
    return [...seen].sort().join(',')
  })

  useEffect(() => {
    if (faces === '') return
    for (const face of faces.split(',')) {
      const [family, bold, italic] = face.split('|')
      void ensureFont(family, { bold: bold === '1', italic: italic === '1' })
    }
  }, [faces])
}
