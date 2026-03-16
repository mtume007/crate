import { useEffect, useRef } from 'react'
import AlbumMatcher from './AlbumMatcher'
import type { DiscogsCandidate } from './AlbumMatcher'

interface PendingAlbum {
  albumId: number
  artist: string
  title: string
  year?: string
  format?: string
  trackCount?: number
}

interface AddModalProps {
  album: PendingAlbum | null
  onConfirm: (albumId: number, candidate: DiscogsCandidate | null, discogsUrl?: string) => void
  onSkip: (albumId: number) => void
  onClose: () => void
}

export default function AddModal({ album, onConfirm, onSkip, onClose }: AddModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!album) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [album, onClose])

  if (!album) return null

  return (
    <div
      className="add-modal-overlay"
      ref={overlayRef}
      onClick={e => { if (e.target === overlayRef.current) onClose() }}
    >
      <div className="add-modal">
        <div className="add-modal-header">
          <span className="add-modal-label">Add album</span>
          <button className="add-modal-close" onClick={onClose}>✕</button>
        </div>
        <AlbumMatcher
          artist={album.artist}
          title={album.title}
          year={album.year}
          format={album.format}
          trackCount={album.trackCount}
          onConfirm={(candidate, url) => onConfirm(album.albumId, candidate, url)}
          onSkip={() => onSkip(album.albumId)}
        />
      </div>
    </div>
  )
}
