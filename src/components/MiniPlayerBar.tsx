import React from 'react';
import {Headphones, Pause, Play, Volume2, X} from 'lucide-react';
import {useAudioPlayer} from '../lib/audioContext';

export const MiniPlayerBar: React.FC = () => {
  const {
    activeBook,
    mode,
    tracks,
    trackIndex,
    ttsChapters,
    ttsChapterIndex,
    ttsSegmentIndex,
    ttsSegments,
    isPlaying,
    currentTime,
    duration,
    playerExpanded,
    setPlayerExpanded,
    togglePlayPause,
    stopAndClose,
  } = useAudioPlayer();

  if (!activeBook || !mode || playerExpanded) return null;

  const trackLabel =
    mode === 'audiobook'
      ? tracks[trackIndex]?.title || `Part ${trackIndex + 1}`
      : ttsChapters[ttsChapterIndex]?.title || `Chapter ${ttsChapterIndex + 1}`;

  const progressRatio =
    mode === 'audiobook'
      ? duration > 0
        ? Math.min(100, (currentTime / duration) * 100)
        : 0
      : ttsSegments.length > 1
        ? Math.min(100, (ttsSegmentIndex / (ttsSegments.length - 1)) * 100)
        : 0;

  return (
    <div
      role="region"
      aria-label="Active audio mini-player"
      className="fixed bottom-14 md:bottom-4 left-0 right-0 md:left-auto md:right-6 md:w-[390px] z-30 pb-safe md:pb-0"
    >
      <div className="mx-0 md:mx-0 bg-[#F3EFE6]/95 dark:bg-[#1D1A17]/95 backdrop-blur-md border-t md:border border-stone-200 dark:border-stone-800 md:rounded-xl shadow-lg overflow-hidden">
        {/* Subtle progress hairline along top */}
        <div className="h-[2px] w-full bg-stone-300/60 dark:bg-stone-800">
          <div
            className="h-full bg-[#1E3A5F] dark:bg-[#7BA3D1] transition-all duration-300"
            style={{width: `${Math.max(2, progressRatio)}%`}}
          />
        </div>

        <div className="h-[50px] px-3 flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setPlayerExpanded(true)}
            className="flex items-center gap-2.5 flex-1 min-w-0 text-left min-h-[44px]"
          >
            <div className="w-8 h-8 rounded-md bg-[#1E3A5F]/10 dark:bg-[#7BA3D1]/15 flex items-center justify-center shrink-0 text-[#1E3A5F] dark:text-[#7BA3D1]">
              {mode === 'audiobook' ? (
                <Headphones className="w-4 h-4" />
              ) : (
                <Volume2 className="w-4 h-4" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-[#1C1917] dark:text-[#F3EFE8] truncate">
                {activeBook.title}
              </p>
              <p className="text-[11px] text-[#6B655E] dark:text-[#A8A095] truncate">
                {mode === 'audiobook' ? 'Human Audio' : 'Browser Voice'} · {trackLabel}
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={togglePlayPause}
            aria-label={isPlaying ? 'Pause audio' : 'Play audio'}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-[#1E3A5F] dark:text-[#7BA3D1] hover:bg-black/5 dark:hover:bg-white/10 shrink-0"
          >
            {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
          </button>

          <button
            type="button"
            onClick={stopAndClose}
            aria-label="Close audio player"
            className="min-h-[44px] min-w-[40px] flex items-center justify-center rounded-lg text-[#6B655E] dark:text-[#A8A095] hover:text-[#1C1917] dark:hover:text-[#F3EFE8] shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
