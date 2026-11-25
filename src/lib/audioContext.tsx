import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  AudiobookEdition,
  AudiobookTrack,
  AudioModeType,
  BookEdition,
  CatalogBook,
  ListeningProgress,
  ReaderChapter,
  ReaderPreferences,
} from '../types/library';
import {libraryApi} from './api';
import {personalStorage} from './storage';

export type SleepTimerMode = 'off' | '10' | '15' | '30' | '45' | '60' | 'chapter';

interface StartListeningOptions {
  book: CatalogBook;
  edition?: BookEdition;
  audiobook?: AudiobookEdition;
  preferredMode?: AudioModeType;
  chapterIndex?: number;
  scrollRatio?: number;
  resumeSaved?: boolean;
  expand?: boolean;
}

interface AudioContextValue {
  activeBook: CatalogBook | null;
  activeEdition: BookEdition | null;
  activeAudiobook: AudiobookEdition | null;
  mode: AudioModeType | null;
  tracks: AudiobookTrack[];
  trackIndex: number;
  ttsChapters: ReaderChapter[];
  ttsChapterIndex: number;
  ttsSegments: string[];
  ttsSegmentIndex: number;
  isPlaying: boolean;
  isLoading: boolean;
  currentTime: number;
  duration: number;
  playbackRate: number;
  voices: SpeechSynthesisVoice[];
  selectedVoiceURI: string | null;
  ttsSupported: boolean;
  ttsVoicesAvailable: boolean;
  sleepTimerMode: SleepTimerMode;
  sleepRemainingSeconds: number | null;
  playerExpanded: boolean;
  error: string | null;
  setPlayerExpanded: (expanded: boolean) => void;
  startListening: (opts: StartListeningOptions) => Promise<void>;
  togglePlayPause: () => void;
  pause: () => void;
  stopAndClose: () => void;
  selectTrack: (idx: number, autoplay?: boolean) => void;
  selectTtsChapter: (idx: number, startSegment?: number, autoplay?: boolean) => void;
  seekBySeconds: (delta: number) => void;
  seekToSeconds: (seconds: number) => void;
  stepTtsSegment: (delta: number) => void;
  jumpToTtsSegment: (segIdx: number) => void;
  nextChapterOrTrack: () => void;
  prevChapterOrTrack: () => void;
  setPlaybackRate: (rate: number) => void;
  setSelectedVoiceURI: (uri: string) => void;
  setSleepTimer: (mode: SleepTimerMode) => void;
  switchAudioMechanism: (nextMode: AudioModeType) => Promise<void>;
  getAlignedReadingLocation: () => {chapterIndex: number; scrollRatio: number; edition: BookEdition | null};
}

const AudioPlayerContext = createContext<AudioContextValue | null>(null);

export function extractSpeechSegmentsFromHtml(html: string): string[] {
  if (!html) return [];
  let plain = '';
  if (typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const blocks = Array.from(doc.querySelectorAll('h1, h2, h3, h4, p, blockquote, li'));
    if (blocks.length > 0) {
      plain = blocks
        .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .join('\n');
    } else {
      plain = (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
    }
  } else {
    plain = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  if (!plain) return [];

  const segments: string[] = [];
  const paragraphs = plain.split(/\n+/);
  for (const para of paragraphs) {
    const cleanPara = para.trim();
    if (!cleanPara) continue;
    // Split long paragraphs into natural sentences <= 220 chars to avoid Web Speech engine stalls
    const sentenceParts = cleanPara.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) || [cleanPara];
    let buffer = '';
    for (const part of sentenceParts) {
      const s = part.trim();
      if (!s) continue;
      if ((buffer + ' ' + s).trim().length <= 210) {
        buffer = buffer ? `${buffer} ${s}` : s;
      } else {
        if (buffer) segments.push(buffer);
        if (s.length <= 220) {
          buffer = s;
        } else {
          // Hard split extra-long clauses cleanly on commas or word boundaries
          const words = s.split(/\s+/);
          let chunk = '';
          for (const w of words) {
            if ((chunk + ' ' + w).trim().length > 200) {
              if (chunk) segments.push(chunk);
              chunk = w;
            } else {
              chunk = chunk ? `${chunk} ${w}` : w;
            }
          }
          buffer = chunk;
        }
      }
    }
    if (buffer) segments.push(buffer);
  }
  return segments;
}

export const AudioPlayerProvider: React.FC<{
  preferences: ReaderPreferences;
  onUpdatePreferences: (next: ReaderPreferences) => void;
  onListeningProgressSaved: (progress: ListeningProgress) => void;
  onRecordHistory: (book: CatalogBook) => void;
  onActiveListeningSeconds?: (seconds: number) => void;
  children: React.ReactNode;
}> = ({
  preferences,
  onUpdatePreferences,
  onListeningProgressSaved,
  onRecordHistory,
  onActiveListeningSeconds,
  children,
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ttsSessionRef = useRef<number>(0);
  const lastSaveMsRef = useRef<number>(0);

  const [activeBook, setActiveBook] = useState<CatalogBook | null>(null);
  const [activeEdition, setActiveEdition] = useState<BookEdition | null>(null);
  const [activeAudiobook, setActiveAudiobook] = useState<AudiobookEdition | null>(null);
  const [mode, setMode] = useState<AudioModeType | null>(null);

  // LibriVox MP3 state
  const [tracks, setTracks] = useState<AudiobookTrack[]>([]);
  const [trackIndex, setTrackIndex] = useState<number>(0);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);

  // Browser TTS state
  const [ttsChapters, setTtsChapters] = useState<ReaderChapter[]>([]);
  const [ttsChapterIndex, setTtsChapterIndex] = useState<number>(0);
  const [ttsSegments, setTtsSegments] = useState<string[]>([]);
  const [ttsSegmentIndex, setTtsSegmentIndex] = useState<number>(0);

  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [playerExpanded, setPlayerExpanded] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const [playbackRate, setPlaybackRateState] = useState<number>(preferences.playbackRate || 1);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceURI, setSelectedVoiceURIState] = useState<string | null>(
    preferences.preferredVoiceURI || null,
  );
  const [sleepTimerMode, setSleepTimerMode] = useState<SleepTimerMode>('off');
  const [sleepRemainingSeconds, setSleepRemainingSeconds] = useState<number | null>(null);

  const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const ttsVoicesAvailable = voices.length > 0;

  // Keep local rate/voice synced if preferences load async
  useEffect(() => {
    setPlaybackRateState(preferences.playbackRate || 1);
    setSelectedVoiceURIState(preferences.preferredVoiceURI || null);
  }, [preferences.playbackRate, preferences.preferredVoiceURI]);

  // Populate Web Speech API voices cleanly
  useEffect(() => {
    if (!ttsSupported) return;
    const refreshVoices = () => {
      const list = window.speechSynthesis.getVoices() || [];
      const sorted = [...list].sort((a, b) => {
        const aEn = a.lang.toLowerCase().startsWith('en') ? 0 : 1;
        const bEn = b.lang.toLowerCase().startsWith('en') ? 0 : 1;
        if (aEn !== bEn) return aEn - bEn;
        const aLoc = a.localService ? 0 : 1;
        const bLoc = b.localService ? 0 : 1;
        if (aLoc !== bLoc) return aLoc - bLoc;
        return a.name.localeCompare(b.name);
      });
      setVoices(sorted);
    };
    refreshVoices();
    window.speechSynthesis.addEventListener?.('voiceschanged', refreshVoices);
    return () => {
      window.speechSynthesis.removeEventListener?.('voiceschanged', refreshVoices);
    };
  }, [ttsSupported]);

  // Create persistent HTMLAudioElement once
  useEffect(() => {
    if (typeof Audio === 'undefined') return;
    const el = new Audio();
    el.preload = 'metadata';
    audioRef.current = el;
    return () => {
      el.pause();
      el.src = '';
      audioRef.current = null;
    };
  }, []);

  const cancelSpeech = useCallback(() => {
    ttsSessionRef.current += 1;
    if (ttsSupported) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
    }
  }, [ttsSupported]);

  // Save current listening progress to IndexedDB
  const persistListeningNow = useCallback(
    (overrides?: Partial<ListeningProgress>) => {
      if (!activeBook || !mode) return;
      let percentComplete = 0;
      if (mode === 'audiobook' && tracks.length > 0) {
        const totalSecs = tracks.reduce((s, t) => s + (t.durationSeconds || 0), 0);
        const doneSecs =
          tracks.slice(0, trackIndex).reduce((s, t) => s + (t.durationSeconds || 0), 0) +
          currentTime;
        percentComplete =
          totalSecs > 0
            ? Math.min(100, Math.max(1, (doneSecs / totalSecs) * 100))
            : Math.min(100, Math.max(1, ((trackIndex + 1) / tracks.length) * 100));
      } else if (mode === 'tts' && ttsChapters.length > 0) {
        const ratio = ttsSegments.length > 1 ? ttsSegmentIndex / (ttsSegments.length - 1) : 0;
        percentComplete = Math.min(
          100,
          Math.max(1, ((ttsChapterIndex + ratio) / ttsChapters.length) * 100),
        );
      }

      const record: ListeningProgress = {
        bookId: activeBook.id,
        audioMode: mode,
        audiobookId: activeAudiobook?.audiobookId,
        editionId: activeEdition?.editionId,
        chapterIndex: mode === 'audiobook' ? trackIndex : ttsChapterIndex,
        totalChapters: mode === 'audiobook' ? tracks.length : ttsChapters.length,
        positionSeconds: currentTime,
        durationSeconds: duration,
        ttsSegmentIndex,
        ttsTotalSegments: ttsSegments.length,
        percentComplete,
        lastListenedAt: new Date().toISOString(),
        book: activeBook,
        ...overrides,
      };

      void personalStorage.saveListeningProgress(record).then(() => {
        onListeningProgressSaved(record);
      });
      void personalStorage.saveLastSession({
        bookId: activeBook.id,
        activeMode: 'listen',
        updatedAt: record.lastListenedAt,
        book: activeBook,
      });
    },
    [
      activeAudiobook?.audiobookId,
      activeBook,
      activeEdition?.editionId,
      currentTime,
      duration,
      mode,
      onListeningProgressSaved,
      trackIndex,
      tracks,
      ttsChapterIndex,
      ttsChapters.length,
      ttsSegmentIndex,
      ttsSegments.length,
    ],
  );

  // Speak a specific TTS segment and chain forward safely
  const speakSegmentAt = useCallback(
    (
      segments: string[],
      segIdx: number,
      chapIdx: number,
      chapters: ReaderChapter[],
      rate: number,
      voiceURI: string | null,
    ) => {
      if (!ttsSupported) {
        setError('Text-to-Speech is not supported in this browser.');
        setIsPlaying(false);
        return;
      }
      const voiceList = window.speechSynthesis.getVoices();
      if (voiceList.length === 0) {
        setError(
          'No speech synthesis voices are available in this browser environment. Try a device with system TTS voices installed or listen to a human-narrated LibriVox audiobook.',
        );
        setIsPlaying(false);
        return;
      }

      if (segIdx >= segments.length) {
        // End of chapter
        if (sleepTimerMode === 'chapter') {
          setIsPlaying(false);
          setSleepTimerMode('off');
          setSleepRemainingSeconds(null);
          return;
        }
        if (chapIdx < chapters.length - 1) {
          const nextChapIdx = chapIdx + 1;
          const nextSegs = extractSpeechSegmentsFromHtml(chapters[nextChapIdx].html);
          setTtsChapterIndex(nextChapIdx);
          setTtsSegments(nextSegs);
          setTtsSegmentIndex(0);
          speakSegmentAt(nextSegs, 0, nextChapIdx, chapters, rate, voiceURI);
        } else {
          setIsPlaying(false);
        }
        return;
      }

      cancelSpeech();
      const mySession = ttsSessionRef.current;
      const text = segments[segIdx];
      if (!text) return;

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = rate;
      if (voiceURI) {
        const found = voiceList.find((v) => v.voiceURI === voiceURI);
        if (found) utterance.voice = found;
      } else {
        const defaultEn = voiceList.find((v) => v.lang.toLowerCase().startsWith('en'));
        if (defaultEn) utterance.voice = defaultEn;
      }

      utterance.onstart = () => {
        if (ttsSessionRef.current !== mySession) return;
        setIsPlaying(true);
        setError(null);
      };

      utterance.onend = () => {
        if (ttsSessionRef.current !== mySession) return;
        const nextIdx = segIdx + 1;
        setTtsSegmentIndex(nextIdx);
        speakSegmentAt(segments, nextIdx, chapIdx, chapters, rate, voiceURI);
      };

      utterance.onerror = (ev) => {
        if (ttsSessionRef.current !== mySession) return;
        if (ev.error === 'interrupted' || ev.error === 'canceled') return;
        setError(`Speech playback stopped (${ev.error || 'browser audio blocked'}).`);
        setIsPlaying(false);
      };

      try {
        window.speechSynthesis.speak(utterance);
        setIsPlaying(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to start browser voice.');
        setIsPlaying(false);
      }
    },
    [cancelSpeech, sleepTimerMode, ttsSupported],
  );

  // Sync HTMLAudioElement event handlers for LibriVox playback
  useEffect(() => {
    const el = audioRef.current;
    if (!el || mode !== 'audiobook') return;

    const onTimeUpdate = () => {
      setCurrentTime(el.currentTime || 0);
      if (Number.isFinite(el.duration) && el.duration > 0) {
        setDuration(el.duration);
      }
      if (Date.now() - lastSaveMsRef.current > 4000) {
        lastSaveMsRef.current = Date.now();
        persistListeningNow({
          positionSeconds: el.currentTime || 0,
          durationSeconds: Number.isFinite(el.duration) ? el.duration : duration,
        });
      }
    };

    const onLoadedMetadata = () => {
      if (Number.isFinite(el.duration) && el.duration > 0) {
        setDuration(el.duration);
      }
    };

    const onPlay = () => {
      setIsPlaying(true);
      setIsLoading(false);
      setError(null);
    };

    const onPause = () => {
      setIsPlaying(false);
      persistListeningNow({
        positionSeconds: el.currentTime || 0,
      });
    };

    const onEnded = () => {
      if (sleepTimerMode === 'chapter') {
        setIsPlaying(false);
        setSleepTimerMode('off');
        setSleepRemainingSeconds(null);
        return;
      }
      if (trackIndex < tracks.length - 1) {
        const nextIdx = trackIndex + 1;
        setTrackIndex(nextIdx);
        setCurrentTime(0);
        const nextTrack = tracks[nextIdx];
        if (nextTrack && audioRef.current) {
          audioRef.current.src = nextTrack.audioUrl;
          audioRef.current.playbackRate = playbackRate;
          setDuration(nextTrack.durationSeconds || 0);
          void audioRef.current.play().catch((err) => {
            setError(err instanceof Error ? err.message : 'Tap Play to continue next chapter.');
            setIsPlaying(false);
          });
        }
      } else {
        setIsPlaying(false);
      }
    };

    const onError = () => {
      setIsLoading(false);
      setIsPlaying(false);
      setError('Could not stream this MP3 track from Archive.org/LibriVox.');
    };

    el.addEventListener('timeupdate', onTimeUpdate);
    el.addEventListener('loadedmetadata', onLoadedMetadata);
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('ended', onEnded);
    el.addEventListener('error', onError);

    return () => {
      el.removeEventListener('timeupdate', onTimeUpdate);
      el.removeEventListener('loadedmetadata', onLoadedMetadata);
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('ended', onEnded);
      el.removeEventListener('error', onError);
    };
  }, [duration, mode, persistListeningNow, playbackRate, sleepTimerMode, trackIndex, tracks]);

  // Periodically save TTS listening position when active
  useEffect(() => {
    if (mode !== 'tts' || !activeBook || !isPlaying) return;
    const t = window.setInterval(() => {
      persistListeningNow();
    }, 3500);
    return () => window.clearInterval(t);
  }, [activeBook, isPlaying, mode, persistListeningNow]);

  // Track genuine active listening seconds for daily goals & reading insights
  useEffect(() => {
    if (!isPlaying || !activeBook || !onActiveListeningSeconds) return;
    const timer = window.setInterval(() => {
      onActiveListeningSeconds(15);
    }, 15000);
    return () => window.clearInterval(timer);
  }, [activeBook, isPlaying, onActiveListeningSeconds]);

  // Sleep timer countdown
  useEffect(() => {
    if (sleepTimerMode === 'off' || sleepTimerMode === 'chapter' || !isPlaying) return;
    if (sleepRemainingSeconds === null || sleepRemainingSeconds <= 0) return;

    const timer = window.setInterval(() => {
      setSleepRemainingSeconds((prev) => {
        if (prev === null) return null;
        if (prev <= 1) {
          // Pause playback
          if (audioRef.current && mode === 'audiobook') {
            audioRef.current.pause();
          }
          cancelSpeech();
          setIsPlaying(false);
          setSleepTimerMode('off');
          return null;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cancelSpeech, isPlaying, mode, sleepRemainingSeconds, sleepTimerMode]);

  const setSleepTimer = useCallback((next: SleepTimerMode) => {
    setSleepTimerMode(next);
    if (next === 'off' || next === 'chapter') {
      setSleepRemainingSeconds(null);
    } else {
      setSleepRemainingSeconds(Number(next) * 60);
    }
  }, []);

  const pause = useCallback(() => {
    if (mode === 'audiobook' && audioRef.current) {
      audioRef.current.pause();
    } else if (mode === 'tts') {
      cancelSpeech();
    }
    setIsPlaying(false);
    persistListeningNow();
  }, [cancelSpeech, mode, persistListeningNow]);

  const selectTrack = useCallback(
    (idx: number, autoplay = true) => {
      const target = tracks[idx];
      if (!target || !audioRef.current) return;
      cancelSpeech();
      setTrackIndex(idx);
      setCurrentTime(0);
      setDuration(target.durationSeconds || 0);
      setError(null);
      audioRef.current.src = target.audioUrl;
      audioRef.current.currentTime = 0;
      audioRef.current.playbackRate = playbackRate;
      if (autoplay) {
        setIsLoading(true);
        void audioRef.current.play().catch((err) => {
          setIsLoading(false);
          setIsPlaying(false);
          setError(err instanceof Error ? err.message : 'Tap Play to start audio.');
        });
      } else {
        setIsPlaying(false);
      }
    },
    [cancelSpeech, playbackRate, tracks],
  );

  const selectTtsChapter = useCallback(
    (idx: number, startSegment = 0, autoplay = true) => {
      const chap = ttsChapters[idx];
      if (!chap) return;
      const segs = extractSpeechSegmentsFromHtml(chap.html);
      const clampedSeg = Math.max(0, Math.min(segs.length - 1, startSegment));
      setTtsChapterIndex(idx);
      setTtsSegments(segs);
      setTtsSegmentIndex(clampedSeg);
      setError(null);
      if (autoplay) {
        speakSegmentAt(segs, clampedSeg, idx, ttsChapters, playbackRate, selectedVoiceURI);
      } else {
        cancelSpeech();
        setIsPlaying(false);
      }
    },
    [cancelSpeech, playbackRate, selectedVoiceURI, speakSegmentAt, ttsChapters],
  );

  const togglePlayPause = useCallback(() => {
    if (!activeBook || !mode) return;
    if (isPlaying) {
      pause();
      return;
    }

    if (mode === 'audiobook' && audioRef.current) {
      const currentTrack = tracks[trackIndex];
      if (!audioRef.current.src && currentTrack) {
        audioRef.current.src = currentTrack.audioUrl;
        audioRef.current.currentTime = currentTime;
      }
      audioRef.current.playbackRate = playbackRate;
      void audioRef.current.play().catch((err) => {
        setError(err instanceof Error ? err.message : 'Playback requires user interaction.');
        setIsPlaying(false);
      });
    } else if (mode === 'tts') {
      speakSegmentAt(
        ttsSegments,
        ttsSegmentIndex,
        ttsChapterIndex,
        ttsChapters,
        playbackRate,
        selectedVoiceURI,
      );
    }
  }, [
    activeBook,
    currentTime,
    isPlaying,
    mode,
    pause,
    playbackRate,
    selectedVoiceURI,
    speakSegmentAt,
    trackIndex,
    tracks,
    ttsChapterIndex,
    ttsChapters,
    ttsSegmentIndex,
    ttsSegments,
  ]);

  const stopAndClose = useCallback(() => {
    pause();
    if (audioRef.current) {
      audioRef.current.src = '';
    }
    setActiveBook(null);
    setActiveEdition(null);
    setActiveAudiobook(null);
    setMode(null);
    setTracks([]);
    setTtsChapters([]);
    setTtsSegments([]);
    setPlayerExpanded(false);
    setError(null);
    setSleepTimerMode('off');
    setSleepRemainingSeconds(null);
  }, [pause]);

  const seekBySeconds = useCallback(
    (delta: number) => {
      if (mode === 'audiobook' && audioRef.current) {
        const dur = audioRef.current.duration || duration || 0;
        const next = Math.max(0, Math.min(dur, (audioRef.current.currentTime || 0) + delta));
        audioRef.current.currentTime = next;
        setCurrentTime(next);
      } else if (mode === 'tts') {
        const step = delta >= 0 ? 1 : -1;
        const nextSeg = Math.max(0, Math.min(ttsSegments.length - 1, ttsSegmentIndex + step));
        setTtsSegmentIndex(nextSeg);
        if (isPlaying) {
          speakSegmentAt(
            ttsSegments,
            nextSeg,
            ttsChapterIndex,
            ttsChapters,
            playbackRate,
            selectedVoiceURI,
          );
        }
      }
    },
    [
      duration,
      isPlaying,
      mode,
      playbackRate,
      selectedVoiceURI,
      speakSegmentAt,
      ttsChapterIndex,
      ttsChapters,
      ttsSegmentIndex,
      ttsSegments,
    ],
  );

  const seekToSeconds = useCallback((seconds: number) => {
    if (mode !== 'audiobook' || !audioRef.current) return;
    const dur = audioRef.current.duration || duration || 0;
    const clamped = Math.max(0, Math.min(dur, seconds));
    audioRef.current.currentTime = clamped;
    setCurrentTime(clamped);
  }, [duration, mode]);

  const stepTtsSegment = useCallback(
    (delta: number) => {
      if (mode !== 'tts') return;
      const next = Math.max(0, Math.min(ttsSegments.length - 1, ttsSegmentIndex + delta));
      setTtsSegmentIndex(next);
      if (isPlaying) {
        speakSegmentAt(
          ttsSegments,
          next,
          ttsChapterIndex,
          ttsChapters,
          playbackRate,
          selectedVoiceURI,
        );
      }
    },
    [
      isPlaying,
      mode,
      playbackRate,
      selectedVoiceURI,
      speakSegmentAt,
      ttsChapterIndex,
      ttsChapters,
      ttsSegmentIndex,
      ttsSegments,
    ],
  );

  const jumpToTtsSegment = useCallback(
    (segIdx: number) => {
      if (mode !== 'tts') return;
      const clamped = Math.max(0, Math.min(ttsSegments.length - 1, segIdx));
      setTtsSegmentIndex(clamped);
      if (isPlaying) {
        speakSegmentAt(
          ttsSegments,
          clamped,
          ttsChapterIndex,
          ttsChapters,
          playbackRate,
          selectedVoiceURI,
        );
      }
    },
    [
      isPlaying,
      mode,
      playbackRate,
      selectedVoiceURI,
      speakSegmentAt,
      ttsChapterIndex,
      ttsChapters,
      ttsSegmentIndex,
      ttsSegments,
    ],
  );

  const nextChapterOrTrack = useCallback(() => {
    if (mode === 'audiobook' && trackIndex < tracks.length - 1) {
      selectTrack(trackIndex + 1, true);
    } else if (mode === 'tts' && ttsChapterIndex < ttsChapters.length - 1) {
      selectTtsChapter(ttsChapterIndex + 1, 0, true);
    }
  }, [mode, selectTrack, selectTtsChapter, trackIndex, tracks.length, ttsChapterIndex, ttsChapters.length]);

  const prevChapterOrTrack = useCallback(() => {
    if (mode === 'audiobook' && trackIndex > 0) {
      selectTrack(trackIndex - 1, true);
    } else if (mode === 'tts' && ttsChapterIndex > 0) {
      selectTtsChapter(ttsChapterIndex - 1, 0, true);
    }
  }, [mode, selectTrack, selectTtsChapter, trackIndex, ttsChapterIndex]);

  const setPlaybackRate = useCallback(
    (rate: number) => {
      const clamped = Math.max(0.75, Math.min(2.0, rate));
      setPlaybackRateState(clamped);
      onUpdatePreferences({...preferences, playbackRate: clamped});
      if (mode === 'audiobook' && audioRef.current) {
        audioRef.current.playbackRate = clamped;
      } else if (mode === 'tts' && isPlaying) {
        speakSegmentAt(
          ttsSegments,
          ttsSegmentIndex,
          ttsChapterIndex,
          ttsChapters,
          clamped,
          selectedVoiceURI,
        );
      }
    },
    [
      isPlaying,
      mode,
      onUpdatePreferences,
      preferences,
      selectedVoiceURI,
      speakSegmentAt,
      ttsChapterIndex,
      ttsChapters,
      ttsSegmentIndex,
      ttsSegments,
    ],
  );

  const setSelectedVoiceURI = useCallback(
    (uri: string) => {
      setSelectedVoiceURIState(uri);
      onUpdatePreferences({...preferences, preferredVoiceURI: uri});
      if (mode === 'tts' && isPlaying) {
        speakSegmentAt(
          ttsSegments,
          ttsSegmentIndex,
          ttsChapterIndex,
          ttsChapters,
          playbackRate,
          uri,
        );
      }
    },
    [
      isPlaying,
      mode,
      onUpdatePreferences,
      playbackRate,
      preferences,
      speakSegmentAt,
      ttsChapterIndex,
      ttsChapters,
      ttsSegmentIndex,
      ttsSegments,
    ],
  );

  const startListening = useCallback(
    async (opts: StartListeningOptions) => {
      const {
        book,
        edition,
        audiobook,
        preferredMode,
        chapterIndex,
        scrollRatio,
        resumeSaved = true,
        expand = true,
      } = opts;

      cancelSpeech();
      if (audioRef.current) {
        audioRef.current.pause();
      }
      setIsPlaying(false);
      setIsLoading(true);
      setError(null);
      setActiveBook(book);
      if (expand) setPlayerExpanded(true);
      onRecordHistory(book);

      const savedListening = resumeSaved
        ? await personalStorage.getListeningProgress(book.id)
        : null;
      const targetEdition =
        edition ||
        book.editions.find((e) => e.editionId === savedListening?.editionId) ||
        book.editions[0] ||
        null;
      setActiveEdition(targetEdition);

      const chosenAudiobook =
        audiobook ||
        book.audiobooks?.find((a) => a.audiobookId === savedListening?.audiobookId) ||
        book.audiobooks?.[0] ||
        null;

      const wantMode: AudioModeType =
        preferredMode ||
        (chosenAudiobook ? 'audiobook' : savedListening?.audioMode || 'tts');

      if (wantMode === 'audiobook') {
        try {
          const res = await libraryApi.getAudiobookTracks({
            bookId: book.id,
            audiobookId: chosenAudiobook?.audiobookId,
          });
          const resolvedAb = res.audiobook || chosenAudiobook;
          const fetchedTracks = res.tracks || [];
          if (resolvedAb && fetchedTracks.length > 0) {
            setActiveAudiobook(resolvedAb);
            setTracks(fetchedTracks);
            setMode('audiobook');

            let startIdx = 0;
            let startPos = 0;
            if (typeof chapterIndex === 'number' && fetchedTracks.length > 0) {
              // Estimate track from reader chapter & scroll ratio if user switched from Read -> Listen
              const ratio = Math.max(0, Math.min(1, scrollRatio || 0));
              if (fetchedTracks.length >= 1) {
                startIdx = Math.min(fetchedTracks.length - 1, Math.max(0, chapterIndex));
                startPos = Math.floor((fetchedTracks[startIdx]?.durationSeconds || 0) * ratio);
              }
            } else if (savedListening && savedListening.audioMode === 'audiobook') {
              startIdx = Math.max(0, Math.min(fetchedTracks.length - 1, savedListening.chapterIndex));
              startPos = Math.max(0, savedListening.positionSeconds || 0);
            }

            const track = fetchedTracks[startIdx];
            setTrackIndex(startIdx);
            setDuration(track.durationSeconds || 0);
            setCurrentTime(startPos);
            setIsLoading(false);

            if (audioRef.current) {
              audioRef.current.src = track.audioUrl;
              audioRef.current.playbackRate = playbackRate;
              const seekOnceReady = () => {
                if (!audioRef.current) return;
                if (startPos > 0 && startPos < (audioRef.current.duration || Infinity)) {
                  audioRef.current.currentTime = startPos;
                }
                audioRef.current.removeEventListener('loadedmetadata', seekOnceReady);
              };
              audioRef.current.addEventListener('loadedmetadata', seekOnceReady);
              void audioRef.current.play().catch((err) => {
                setError(
                  err instanceof Error
                    ? 'Tap Play to start audiobook playback.'
                    : 'Audio playback paused.',
                );
                setIsPlaying(false);
              });
            }
            return;
          }
          // No audiobook found — fall back to TTS if preferredMode wasn't strictly forced
          if (preferredMode === 'audiobook') {
            setIsLoading(false);
            setError('No LibriVox human-narrated audiobook tracks were returned for this book.');
            return;
          }
        } catch (err) {
          if (preferredMode === 'audiobook') {
            setIsLoading(false);
            setError(err instanceof Error ? err.message : 'Could not fetch LibriVox tracks.');
            return;
          }
        }
      }

      // TTS narration path
      if (!targetEdition) {
        setIsLoading(false);
        setError('No readable edition available for Text-to-Speech narration.');
        return;
      }

      try {
        const content = await libraryApi.getReaderContent(book, targetEdition.editionId);
        if (!content.readableInApp || content.chapters.length === 0) {
          setIsLoading(false);
          setMode('tts');
          setTtsChapters([]);
          setTtsSegments([]);
          setError(
            content.unavailableReason ||
              'This publisher-hosted edition cannot be parsed for in-app Text-to-Speech narration. Open the verified external edition to read.',
          );
          return;
        }

        setActiveAudiobook(chosenAudiobook);
        setMode('tts');
        setTtsChapters(content.chapters);

        let startChap = 0;
        let startSeg = 0;
        if (typeof chapterIndex === 'number') {
          startChap = Math.max(0, Math.min(content.chapters.length - 1, chapterIndex));
        } else if (savedListening && savedListening.audioMode === 'tts') {
          startChap = Math.max(0, Math.min(content.chapters.length - 1, savedListening.chapterIndex));
        }

        const segs = extractSpeechSegmentsFromHtml(content.chapters[startChap].html);
        if (typeof chapterIndex === 'number' && typeof scrollRatio === 'number' && segs.length > 1) {
          startSeg = Math.round(Math.max(0, Math.min(1, scrollRatio)) * (segs.length - 1));
        } else if (
          savedListening &&
          savedListening.audioMode === 'tts' &&
          savedListening.chapterIndex === startChap
        ) {
          startSeg = Math.max(0, Math.min(segs.length - 1, savedListening.ttsSegmentIndex));
        }

        setTtsChapterIndex(startChap);
        setTtsSegments(segs);
        setTtsSegmentIndex(startSeg);
        setIsLoading(false);

        speakSegmentAt(segs, startSeg, startChap, content.chapters, playbackRate, selectedVoiceURI);
      } catch (err) {
        setIsLoading(false);
        setError(err instanceof Error ? err.message : 'Unable to prepare book text for voice narration.');
      }
    },
    [cancelSpeech, onRecordHistory, playbackRate, selectedVoiceURI, speakSegmentAt],
  );

  const switchAudioMechanism = useCallback(
    async (nextMode: AudioModeType) => {
      if (!activeBook) return;
      await startListening({
        book: activeBook,
        edition: activeEdition || undefined,
        audiobook: activeAudiobook || undefined,
        preferredMode: nextMode,
        resumeSaved: false,
        expand: true,
      });
    },
    [activeAudiobook, activeBook, activeEdition, startListening],
  );

  const getAlignedReadingLocation = useCallback(() => {
    if (mode === 'tts') {
      const ratio = ttsSegments.length > 1 ? ttsSegmentIndex / (ttsSegments.length - 1) : 0;
      return {
        chapterIndex: ttsChapterIndex,
        scrollRatio: Math.max(0, Math.min(1, ratio)),
        edition: activeEdition,
      };
    }
    if (mode === 'audiobook' && tracks.length > 0) {
      const ratio = duration > 0 ? Math.max(0, Math.min(1, currentTime / duration)) : 0;
      return {
        chapterIndex: trackIndex,
        scrollRatio: ratio,
        edition: activeEdition,
      };
    }
    return {chapterIndex: 0, scrollRatio: 0, edition: activeEdition};
  }, [
    activeEdition,
    currentTime,
    duration,
    mode,
    trackIndex,
    tracks.length,
    ttsChapterIndex,
    ttsSegmentIndex,
    ttsSegments.length,
  ]);

  // Register Media Session API metadata & lock-screen actions where supported
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator) || !activeBook || !mode) {
      return;
    }

    const subtitle =
      mode === 'audiobook'
        ? `${tracks[trackIndex]?.title || 'Audiobook'} · LibriVox`
        : `${ttsChapters[ttsChapterIndex]?.title || 'Voice Narration'} · Browser Speech`;

    const artwork: MediaImage[] = [];
    if (activeBook.coverUrl && typeof window !== 'undefined') {
      artwork.push({
        src: new URL(activeBook.coverUrl, window.location.origin).toString(),
        sizes: '512x512',
        type: 'image/jpeg',
      });
    }

    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: activeBook.title,
        artist: activeBook.primaryAuthor,
        album: subtitle,
        artwork,
      });
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
    } catch {
      // ignore MediaMetadata errors on older browsers
    }

    const registerHandler = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // unsupported action in this browser
      }
    };

    registerHandler('play', () => {
      if (!isPlaying) togglePlayPause();
    });
    registerHandler('pause', () => {
      if (isPlaying) pause();
    });
    registerHandler('previoustrack', prevChapterOrTrack);
    registerHandler('nexttrack', nextChapterOrTrack);
    registerHandler('seekbackward', () => seekBySeconds(-15));
    registerHandler('seekforward', () => seekBySeconds(15));

    if (mode === 'audiobook' && duration > 0 && 'setPositionState' in navigator.mediaSession) {
      try {
        navigator.mediaSession.setPositionState({
          duration,
          playbackRate,
          position: Math.min(duration, currentTime),
        });
      } catch {
        // ignore
      }
    }
  }, [
    activeBook,
    currentTime,
    duration,
    isPlaying,
    mode,
    nextChapterOrTrack,
    pause,
    playbackRate,
    prevChapterOrTrack,
    seekBySeconds,
    togglePlayPause,
    trackIndex,
    tracks,
    ttsChapterIndex,
    ttsChapters,
  ]);

  const value = useMemo<AudioContextValue>(
    () => ({
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
      startListening,
      togglePlayPause,
      pause,
      stopAndClose,
      selectTrack,
      selectTtsChapter,
      seekBySeconds,
      seekToSeconds,
      stepTtsSegment,
      jumpToTtsSegment,
      nextChapterOrTrack,
      prevChapterOrTrack,
      setPlaybackRate,
      setSelectedVoiceURI,
      setSleepTimer,
      switchAudioMechanism,
      getAlignedReadingLocation,
    }),
    [
      activeAudiobook,
      activeBook,
      activeEdition,
      currentTime,
      duration,
      error,
      getAlignedReadingLocation,
      isLoading,
      isPlaying,
      jumpToTtsSegment,
      mode,
      nextChapterOrTrack,
      pause,
      playbackRate,
      playerExpanded,
      prevChapterOrTrack,
      seekBySeconds,
      seekToSeconds,
      selectTrack,
      selectTtsChapter,
      selectedVoiceURI,
      setPlaybackRate,
      setSelectedVoiceURI,
      setSleepTimer,
      sleepRemainingSeconds,
      sleepTimerMode,
      startListening,
      stepTtsSegment,
      stopAndClose,
      switchAudioMechanism,
      togglePlayPause,
      trackIndex,
      tracks,
      ttsChapterIndex,
      ttsChapters,
      ttsSegmentIndex,
      ttsSegments,
      ttsSupported,
      ttsVoicesAvailable,
      voices,
    ],
  );

  return <AudioPlayerContext.Provider value={value}>{children}</AudioPlayerContext.Provider>;
};

export function useAudioPlayer(): AudioContextValue {
  const ctx = useContext(AudioPlayerContext);
  if (!ctx) {
    throw new Error('useAudioPlayer must be used inside AudioPlayerProvider');
  }
  return ctx;
}
