import React from 'react';
import { toOpalFileUrl } from '@/common/opalFileUrl';
import type { DiskEntry } from '@/types/disk';

/**
 * Chromium plays these natively. `key` on the element forces a remount when the
 * selection changes. Without it React reuses the media element and keeps the
 * previous file's playback position and buffered data.
 *
 * Deliberately no autoplay: clicking through a folder of videos should not
 * start a wall of sound.
 */
export const MediaPreview: React.FC<{ entry: DiskEntry }> = ({ entry }) => {
  const source = toOpalFileUrl(entry.path);

  if (entry.kind === 'audio') {
    return (
      <div className="flex-1 grid place-items-center p-6">
        <audio
          key={entry.path}
          src={source}
          controls
          preload="metadata"
          data-testid="audio-preview"
          className="w-full max-w-md"
        />
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 grid place-items-center bg-black/80 p-2">
      <video
        key={entry.path}
        src={source}
        controls
        preload="metadata"
        data-testid="video-preview"
        className="max-w-full max-h-full"
      />
    </div>
  );
};
