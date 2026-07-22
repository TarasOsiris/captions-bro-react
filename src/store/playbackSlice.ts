// Transport state: the playhead position and play/pause. Session state — never
// part of an undo snapshot. The actual play/seek mechanics live in usePlayback.

import type { ImmerSlice } from './editorStore'

export interface PlaybackSlice {
  /** Playhead position, seconds from project start. */
  currentTime: number
  playing: boolean
  setCurrentTime: (t: number) => void
  setPlaying: (playing: boolean) => void
}

export const createPlaybackSlice: ImmerSlice<PlaybackSlice> = (set) => ({
  currentTime: 0,
  playing: false,
  setCurrentTime: (t) =>
    set((s) => {
      s.currentTime = t
    }),
  setPlaying: (playing) =>
    set((s) => {
      s.playing = playing
    }),
})
