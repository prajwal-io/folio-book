import React, {useState} from 'react';
import {
  BookOpen,
  ChevronDown,
  Headphones,
  ListMusic,
  Loader2,
  Moon,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  SkipBack,
  SkipForward,
  Volume2,
} from 'lucide-react';
import type {BookEdition, CatalogBook} from '../types/library';
import {type SleepTimerMode, useAudioPlayer} from '../lib/audioContext';
import {BookCover} from './BookCover';

function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

interface AudioPlayerModalProps {
  onSwitchToReader: (
    book: CatalogBook,
    edition: BookEdition,
    chapterIndex: number,
    scrollRatio: number,
  ) => void;
}

const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 1.75, 2];

const SLEEP_OPTIONS: Array<{id: SleepTimerMode; label: string}> = [
  {id: 'off', label: 'Off'},
  {id: '10', label: '10 min'},
  {id: '15', label: '15 min'},
  {id: '30', label: '30 min'},
  {id: '45', label: '45 min'},
  {id: '60', label: '60 min'},
  {id: 'chapter', label: 'End of chapter'},
];

export const AudioPlayerModal: React.FC<AudioPlayerModalProps> = ({onSwitchToReader}) => {
  const {
    activeBook,
    activeEdition,
    activeAudiobook,
    mode,
    tracks,
    trackIndex,
    ttsChapters,
    ttsChapterIndex,
    ttsSegments,
    ttsSegmentIndex,
    isPlaying,
    isLoading,
    currentTime,
    duration,
    playbackRate,
    voices,
    selectedVoiceURI,
    ttsSupported,
    ttsVoicesAvailable,
    sleepTimerMode,
    sleepRemainingSeconds,
    playerExpanded,
    error,
    setPlayerExpanded,
    togglePlayPause,
    pause,
    selectTrack,
    selectTtsChapter,
    seekBySeconds,
    seekToSeconds,
    jumpToTtsSegment,
    nextChapterOrTrack,
    prevChapterOrTrack,
    setPlaybackRate,
    setSelectedVoiceURI,
    setSleepTimer,
    switchAudioMechanism,
    getAlignedReadingLocation,
  } = useAudioPlayer();

  const [panelTab, setPanelTab] = useState<'controls' | 'chapters' | 'sleep'>('controls');

  if (!activeBook || !mode || !playerExpanded) return null;

  const hasAudiobookOption = (activeBook.audiobooks?.length ?? 0) > 0 || Boolean(activeAudiobook);
  const canReadInApp =
    activeEdition &&
    activeEdition.provider !== 'openstax' &&
    activeEdition.provider !== 'openalex' &&
    activeEdition.provider !== 'doab' &&
    activeEdition.provider !== 'obooko' &&
    activeEdition.provider !== 'librivox';

  const handleSwitchRead = () => {
    const loc = getAlignedReadingLocation();
    const targetEd = loc.edition || activeBook.editions[0];
    if (!targetEd) return;
    pause();
    setPlayerExpanded(false);
    onSwitchToReader(activeBook, targetEd, loc.chapterIndex, loc.scrollRatio);
  };

  const currentTrack = tracks[trackIndex];
  const currentTtsChapter = ttsChapters[ttsChapterIndex];

  const ttsEstimatedRemainingMins =
    mode === 'tts' && currentTtsChapter
      ? Math.max(
          1,
          Math.round(
            ((1 - (ttsSegments.length > 1 ? ttsSegmentIndex / (ttsSegments.length - 1) : 0)) *
              currentTtsChapter.wordCount) /
              (160 * playbackRate),
          ),
        )
      : 0;

  return (
    <div
      className="fixed inset-0 z-50 bg-[#FBF9F5] dark:bg-[#141210] text-[#1C1917] dark:text-[#F3EFE8] flex flex-col overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label="Audio Player"
    >
      {/* Top Bar */}
      <header className="sticky top-0 z-20 bg-[#FBF9F5]/95 dark:bg-[#141210]/95 backdrop-blur-md border-b border-stone-200/80 dark:border-stone-800/80 pt-safe">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setPlayerExpanded(false)}
            aria-label="Minimize player"
            className="inline-flex items-center gap-1.5 min-h-[44px] -ml-2 px-2 text-sm font-medium text-[#1C1917] dark:text-[#F3EFE8]"
          >
            <ChevronDown className="w-5 h-5" />
            <span>Minimize</span>
          </button>

          <p className="text-[11px] uppercase tracking-[0.16em] text-[#6B655E] dark:text-[#A8A095] truncate">
            {mode === 'audiobook' ? 'Human-Narrated Audiobook' : 'Synthesized Voice'}
          </p>

          <button
            type="button"
            onClick={handleSwitchRead}
            className="inline-flex items-center gap-1.5 min-h-[44px] px-2.5 text-xs font-medium text-[#1E3A5F] dark:text-[#7BA3D1] hover:underline shrink-0"
          >
            <BookOpen className="w-4 h-4" />
            <span>Read</span>
          </button>
        </div>
      </header>

      <div className="flex-1 max-w-2xl w-full mx-auto px-5 py-6 pb-14 flex flex-col justify-between gap-6">
        {/* Book Cover & Attribution */}
        <div className="flex flex-col items-center text-center space-y-4">
          <div className="w-40 sm:w-48">
            <BookCover
              title={activeBook.title}
              author={activeBook.primaryAuthor}
              coverUrl={activeBook.coverUrl}
              size="lg"
              className="shadow-lg"
            />
          </div>

          <div className="space-y-1.5 max-w-md">
            <p className="text-xs uppercase tracking-[0.15em] text-[#1E3A5F] dark:text-[#7BA3D1] font-medium">
              {mode === 'audiobook' ? (
                <span className="inline-flex items-center gap-1.5">
                  <Headphones className="w-3.5 h-3.5" />
                  <span>
                    Human-Narrated · {activeAudiobook?.providerLabel || 'LibriVox'}
                  </span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <Volume2 className="w-3.5 h-3.5" />
                  <span>Synthesized Voice · Free Browser Speech</span>
                </span>
              )}
            </p>
            <h1 className="font-display text-2xl sm:text-3xl font-semibold leading-tight text-balance">
              {activeBook.title}
            </h1>
            <p className="text-sm text-[#6B655E] dark:text-[#A8A095]">
              {activeBook.primaryAuthor}
              {mode === 'audiobook' && activeAudiobook?.narrators?.length
                ? ` · Read by ${activeAudiobook.narrators.slice(0, 2).join(', ')}`
                : ''}
            </p>
          </div>

          {/* Honest mechanism toggle when both LibriVox audio & in-app text exist */}
          {hasAudiobookOption && canReadInApp && (
            <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-[#F3EFE6] dark:bg-[#1D1A17] border border-stone-200/80 dark:border-stone-800">
              <button
                type="button"
                onClick={() => void switchAudioMechanism('audiobook')}
                className={`min-h-[36px] px-3 rounded-md text-xs font-medium transition-colors ${
                  mode === 'audiobook'
                    ? 'bg-white dark:bg-[#2A2622] text-[#1C1917] dark:text-[#F3EFE8] shadow-sm'
                    : 'text-[#6B655E] dark:text-[#A8A095]'
                }`}
              >
                Human Audiobook
              </button>
              <button
                type="button"
                onClick={() => void switchAudioMechanism('tts')}
                className={`min-h-[36px] px-3 rounded-md text-xs font-medium transition-colors ${
                  mode === 'tts'
                    ? 'bg-white dark:bg-[#2A2622] text-[#1C1917] dark:text-[#F3EFE8] shadow-sm'
                    : 'text-[#6B655E] dark:text-[#A8A095]'
                }`}
              >
                Browser Voice (TTS)
              </button>
            </div>
          )}
        </div>

        {/* Honest Error / Limitation Notice */}
        {error && (
          <div className="p-4 rounded-xl bg-[#F3EFE6] dark:bg-[#1D1A17] border border-[#9A3412]/30 dark:border-[#E07A5F]/30 text-xs text-[#9A3412] dark:text-[#F28482] leading-relaxed">
            {error}
          </div>
        )}

        {mode === 'tts' && ttsSupported && !ttsVoicesAvailable && !error && (
          <div className="p-4 rounded-xl bg-[#F3EFE6] dark:bg-[#1D1A17] border border-stone-200 dark:border-stone-800 text-xs text-[#6B655E] dark:text-[#A8A095] leading-relaxed">
            No operating-system Speech Synthesis voices were detected in this browser. Voice playback requires browser/OS speech voices; human-narrated LibriVox audiobooks stream on every device.
          </div>
        )}

        {/* Active Chapter / Sentence Preview & Progress Scrubber */}
        <div className="space-y-4">
          <div className="text-center space-y-1">
            <p className="text-sm font-medium text-[#1C1917] dark:text-[#F3EFE8] truncate">
              {mode === 'audiobook'
                ? currentTrack?.title || `Track ${trackIndex + 1}`
                : currentTtsChapter?.title || `Chapter ${ttsChapterIndex + 1}`}
            </p>
            {mode === 'tts' && ttsSegments[ttsSegmentIndex] && (
              <p className="font-prose text-xs sm:text-sm italic text-[#6B655E] dark:text-[#A8A095] line-clamp-2 max-w-lg mx-auto">
                “{ttsSegments[ttsSegmentIndex]}”
              </p>
            )}
          </div>

          {mode === 'audiobook' ? (
            <div className="space-y-1.5">
              <input
                type="range"
                min={0}
                max={Math.max(1, duration)}
                value={Math.min(duration, currentTime)}
                onChange={(e) => seekToSeconds(Number(e.target.value))}
                aria-label="Audio position"
                className="w-full accent-[#1E3A5F] dark:accent-[#7BA3D1] h-2 cursor-pointer"
              />
              <div className="flex items-center justify-between text-xs tabular-nums text-[#6B655E] dark:text-[#A8A095]">
                <span>{formatClock(currentTime)}</span>
                <span>
                  Track {trackIndex + 1} / {Math.max(1, tracks.length)}
                </span>
                <span>{duration > 0 ? `-${formatClock(Math.max(0, duration - currentTime))}` : '--:--'}</span>
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <input
                type="range"
                min={0}
                max={Math.max(1, ttsSegments.length - 1)}
                value={ttsSegmentIndex}
                onChange={(e) => jumpToTtsSegment(Number(e.target.value))}
                aria-label="Voice narration progress"
                className="w-full accent-[#1E3A5F] dark:accent-[#7BA3D1] h-2 cursor-pointer"
              />
              <div className="flex items-center justify-between text-xs tabular-nums text-[#6B655E] dark:text-[#A8A095]">
                <span>
                  Segment {ttsSegmentIndex + 1} / {Math.max(1, ttsSegments.length)}
                </span>
                <span>
                  Ch {ttsChapterIndex + 1} / {Math.max(1, ttsChapters.length)}
                </span>
                <span>~{ttsEstimatedRemainingMins}m left</span>
              </div>
            </div>
          )}

          {/* Primary Transport Controls */}
          <div className="flex items-center justify-center gap-3 sm:gap-5 pt-1">
            <button
              type="button"
              onClick={prevChapterOrTrack}
              disabled={mode === 'audiobook' ? trackIndex === 0 : ttsChapterIndex === 0}
              aria-label="Previous chapter"
              className="min-h-[48px] min-w-[48px] flex items-center justify-center rounded-full hover:bg-stone-200/70 dark:hover:bg-stone-800 disabled:opacity-30"
            >
              <SkipBack className="w-5 h-5" />
            </button>

            <button
              type="button"
              onClick={() => seekBySeconds(-15)}
              aria-label={mode === 'audiobook' ? 'Rewind 15 seconds' : 'Previous sentence'}
              className="min-h-[48px] min-w-[48px] flex flex-col items-center justify-center rounded-full hover:bg-stone-200/70 dark:hover:bg-stone-800"
            >
              <RotateCcw className="w-5 h-5" />
              <span className="text-[10px] tabular-nums font-medium leading-none mt-0.5">
                {mode === 'audiobook' ? '15s' : 'Prev'}
              </span>
            </button>

            <button
              type="button"
              disabled={isLoading}
              onClick={togglePlayPause}
              aria-label={isPlaying ? 'Pause' : 'Play'}
              className="w-16 h-16 rounded-full bg-[#1E3A5F] text-white dark:bg-[#7BA3D1] dark:text-[#141210] flex items-center justify-center shadow-lg hover:opacity-95 active:scale-95 transition-all disabled:opacity-60"
            >
              {isLoading ? (
                <Loader2 className="w-6 h-6 animate-spin" />
              ) : isPlaying ? (
                <Pause className="w-7 h-7 fill-current" />
              ) : (
                <Play className="w-7 h-7 fill-current ml-0.5" />
              )}
            </button>

            <button
              type="button"
              onClick={() => seekBySeconds(15)}
              aria-label={mode === 'audiobook' ? 'Forward 15 seconds' : 'Next sentence'}
              className="min-h-[48px] min-w-[48px] flex flex-col items-center justify-center rounded-full hover:bg-stone-200/70 dark:hover:bg-stone-800"
            >
              <RotateCw className="w-5 h-5" />
              <span className="text-[10px] tabular-nums font-medium leading-none mt-0.5">
                {mode === 'audiobook' ? '15s' : 'Next'}
              </span>
            </button>

            <button
              type="button"
              onClick={nextChapterOrTrack}
              disabled={
                mode === 'audiobook'
                  ? trackIndex >= tracks.length - 1
                  : ttsChapterIndex >= ttsChapters.length - 1
              }
              aria-label="Next chapter"
              className="min-h-[48px] min-w-[48px] flex items-center justify-center rounded-full hover:bg-stone-200/70 dark:hover:bg-stone-800 disabled:opacity-30"
            >
              <SkipForward className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Lower Utility Drawer Tabs: Speed/Voice, Chapters, Sleep Timer */}
        <div className="rounded-2xl bg-[#F3EFE6]/75 dark:bg-[#1D1A17] border border-stone-200/80 dark:border-stone-800 overflow-hidden">
          <div className="grid grid-cols-3 border-b border-stone-200/80 dark:border-stone-800 text-xs font-medium">
            <button
              type="button"
              onClick={() => setPanelTab('controls')}
              className={`min-h-[44px] flex items-center justify-center gap-1.5 ${
                panelTab === 'controls'
                  ? 'text-[#1E3A5F] dark:text-[#7BA3D1] border-b-2 border-[#1E3A5F] dark:border-[#7BA3D1]'
                  : 'text-[#6B655E] dark:text-[#A8A095]'
              }`}
            >
              <span>Speed & Voice</span>
            </button>
            <button
              type="button"
              onClick={() => setPanelTab('chapters')}
              className={`min-h-[44px] flex items-center justify-center gap-1.5 ${
                panelTab === 'chapters'
                  ? 'text-[#1E3A5F] dark:text-[#7BA3D1] border-b-2 border-[#1E3A5F] dark:border-[#7BA3D1]'
                  : 'text-[#6B655E] dark:text-[#A8A095]'
              }`}
            >
              <ListMusic className="w-3.5 h-3.5" />
              <span>
                Chapters ({mode === 'audiobook' ? tracks.length : ttsChapters.length})
              </span>
            </button>
            <button
              type="button"
              onClick={() => setPanelTab('sleep')}
              className={`min-h-[44px] flex items-center justify-center gap-1.5 ${
                panelTab === 'sleep'
                  ? 'text-[#1E3A5F] dark:text-[#7BA3D1] border-b-2 border-[#1E3A5F] dark:border-[#7BA3D1]'
                  : 'text-[#6B655E] dark:text-[#A8A095]'
              }`}
            >
              <Moon className="w-3.5 h-3.5" />
              <span>
                {sleepTimerMode === 'off'
                  ? 'Sleep Timer'
                  : sleepTimerMode === 'chapter'
                    ? 'End Ch.'
                    : formatClock(sleepRemainingSeconds || 0)}
              </span>
            </button>
          </div>

          <div className="p-4">
            {panelTab === 'controls' && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#6B655E] dark:text-[#A8A095] uppercase tracking-wider">
                      Narration Speed
                    </span>
                    <span className="font-semibold tabular-nums">{playbackRate.toFixed(2).replace(/\.00$/, '')}x</span>
                  </div>
                  <div className="grid grid-cols-6 gap-1.5">
                    {SPEED_OPTIONS.map((rate) => (
                      <button
                        key={rate}
                        type="button"
                        onClick={() => setPlaybackRate(rate)}
                        className={`min-h-[40px] rounded-lg text-xs font-medium tabular-nums border transition-colors ${
                          Math.abs(playbackRate - rate) < 0.04
                            ? 'bg-[#1E3A5F] text-white border-[#1E3A5F] dark:bg-[#7BA3D1] dark:text-[#141210] dark:border-[#7BA3D1]'
                            : 'bg-white/70 dark:bg-[#141210] border-stone-200 dark:border-stone-800'
                        }`}
                      >
                        {rate}x
                      </button>
                    ))}
                  </div>
                </div>

                {mode === 'tts' && (
                  <div className="space-y-2 pt-2 border-t border-stone-200/70 dark:border-stone-800">
                    <label
                      htmlFor="player-tts-voice"
                      className="block text-xs uppercase tracking-wider text-[#6B655E] dark:text-[#A8A095]"
                    >
                      Browser Speech Voice
                    </label>
                    {ttsVoicesAvailable ? (
                      <select
                        id="player-tts-voice"
                        value={selectedVoiceURI || ''}
                        onChange={(e) => setSelectedVoiceURI(e.target.value)}
                        className="w-full min-h-[44px] px-3 rounded-lg bg-white dark:bg-[#141210] border border-stone-300 dark:border-stone-700 text-xs sm:text-sm"
                      >
                        <option value="">System Default Voice</option>
                        {voices.map((v) => (
                          <option key={v.voiceURI} value={v.voiceURI}>
                            {v.name} ({v.lang}) {v.localService ? '· On-device' : ''}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <p className="text-xs text-[#6B655E] dark:text-[#A8A095]">
                        No system speech voices exposed by this browser.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {panelTab === 'chapters' && (
              <div className="max-h-56 overflow-y-auto divide-y divide-stone-200/70 dark:divide-stone-800 -m-4">
                {mode === 'audiobook'
                  ? tracks.map((t) => (
                      <button
                        key={t.index}
                        type="button"
                        onClick={() => selectTrack(t.index, true)}
                        className={`w-full text-left px-4 py-3 min-h-[48px] flex items-center justify-between gap-3 hover:bg-black/5 dark:hover:bg-white/5 ${
                          t.index === trackIndex ? 'font-semibold text-[#1E3A5F] dark:text-[#7BA3D1]' : ''
                        }`}
                      >
                        <span className="text-xs sm:text-sm truncate">{t.title}</span>
                        <span className="text-xs tabular-nums text-[#6B655E] dark:text-[#A8A095] shrink-0">
                          {formatClock(t.durationSeconds)}
                        </span>
                      </button>
                    ))
                  : ttsChapters.map((ch) => (
                      <button
                        key={ch.index}
                        type="button"
                        onClick={() => selectTtsChapter(ch.index, 0, true)}
                        className={`w-full text-left px-4 py-3 min-h-[48px] flex items-center justify-between gap-3 hover:bg-black/5 dark:hover:bg-white/5 ${
                          ch.index === ttsChapterIndex
                            ? 'font-semibold text-[#1E3A5F] dark:text-[#7BA3D1]'
                            : ''
                        }`}
                      >
                        <span className="text-xs sm:text-sm truncate">{ch.title}</span>
                        <span className="text-xs tabular-nums text-[#6B655E] dark:text-[#A8A095] shrink-0">
                          ~{Math.max(1, Math.round(ch.wordCount / 160))}m
                        </span>
                      </button>
                    ))}
              </div>
            )}

            {panelTab === 'sleep' && (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {SLEEP_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setSleepTimer(opt.id)}
                    className={`min-h-[42px] px-3 rounded-lg text-xs font-medium border transition-colors ${
                      sleepTimerMode === opt.id
                        ? 'bg-[#1E3A5F] text-white border-[#1E3A5F] dark:bg-[#7BA3D1] dark:text-[#141210] dark:border-[#7BA3D1]'
                        : 'bg-white/70 dark:bg-[#141210] border-stone-200 dark:border-stone-800'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
