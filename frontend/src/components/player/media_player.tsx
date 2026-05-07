import { useRef, useState, useEffect, useCallback } from "react";
import { formatDuration } from "@/lib/utils/index";
import type { TranscriptionSegment } from "@/types/index";
import { cn } from "@/lib/utils/index";

interface MediaPlayerProps {
  src: string;
  mimeType: string;
  segments?: TranscriptionSegment[];
  className?: string;
}

export function MediaPlayer({
  src,
  mimeType,
  segments = [],
  className,
}: MediaPlayerProps) {
  const mediaRef = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const isVideo = mimeType.startsWith("video/");
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [activeSegment, setActiveSegment] = useState<number | null>(null);

  // Sync playback state
  useEffect(() => {
    const el = mediaRef.current;
    if (!el) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTime = () => {
      setCurrent(el.currentTime);
      const idx = segments.findIndex(
        (s) => el.currentTime >= s.start && el.currentTime <= s.end,
      );
      setActiveSegment(idx >= 0 ? idx : null);
    };
    const onLoaded = () => setDuration(el.duration);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onLoaded);
    return () => {
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onLoaded);
    };
  }, [segments]);

  const togglePlay = () => {
    const el = mediaRef.current;
    if (!el) return;
    playing ? el.pause() : el.play();
  };

  /** Jump to a specific second — used by ▶ Play buttons on segments */
  const seekTo = useCallback((seconds: number) => {
    const el = mediaRef.current;
    if (!el) return;
    el.currentTime = seconds;
    el.play();
  }, []);

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = mediaRef.current;
    const bar = progressRef.current;
    if (!el || !bar || !duration) return;
    const rect = bar.getBoundingClientRect();
    el.currentTime = ((e.clientX - rect.left) / rect.width) * duration;
  };

  const progress = duration ? (current / duration) * 100 : 0;

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {/* Media element */}
      {isVideo ? (
        <video
          ref={mediaRef}
          src={src}
          className="w-full rounded-xl bg-black max-h-56 object-contain"
          preload="metadata"
        />
      ) : (
        <audio ref={mediaRef} src={src} preload="metadata" />
      )}

      {/* Controls */}
      <div className="bg-surface2 border border-border rounded-xl p-3 flex flex-col gap-2">
        {/* Progress bar */}
        <div
          ref={progressRef}
          className="relative h-2 bg-border rounded-full cursor-pointer group"
          onClick={handleProgressClick}
        >
          <div
            className="absolute inset-y-0 left-0 bg-accent rounded-full transition-all"
            style={{ width: `${progress}%` }}
          />
          {/* Segment markers */}
          {segments.map((seg, i) => (
            <div
              key={i}
              title={seg.text}
              className="absolute top-1/2 -translate-y-1/2 w-1 h-3 bg-purple/60 rounded-full hover:bg-purple cursor-pointer"
              style={{ left: `${(seg.start / (duration || 1)) * 100}%` }}
              onClick={(e) => {
                e.stopPropagation();
                seekTo(seg.start);
              }}
            />
          ))}
        </div>

        {/* Time + play/pause */}
        <div className="flex items-center gap-3">
          <button
            onClick={togglePlay}
            className="w-9 h-9 rounded-full bg-accent hover:bg-accent-hover text-white flex items-center justify-center transition-all text-base cursor-pointer"
          >
            {playing ? "⏸" : "▶"}
          </button>
          <span className="text-xs font-mono text-muted2 tabular-nums">
            {formatDuration(current)} / {formatDuration(duration)}
          </span>
        </div>
      </div>

      {/* Segments with ▶ Play buttons */}
      {segments.length > 0 && (
        <div className="flex flex-col gap-1 max-h-64 overflow-y-auto pr-1">
          <p className="text-xs text-muted uppercase tracking-wider font-semibold mb-1">
            Segments ({segments.length})
          </p>
          {segments.map((seg, i) => (
            <div
              key={i}
              className={cn(
                "flex items-start gap-3 px-3 py-2 rounded-lg transition-all cursor-pointer group",
                activeSegment === i
                  ? "bg-accent-light border border-accent/30"
                  : "hover:bg-surface3",
              )}
              onClick={() => seekTo(seg.start)}
            >
              {/* Play button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  seekTo(seg.start);
                }}
                className={cn(
                  "flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs transition-all cursor-pointer border-0",
                  activeSegment === i
                    ? "bg-accent text-white"
                    : "bg-surface3 text-muted2 group-hover:bg-accent/20 group-hover:text-accent",
                )}
                title={`Play from ${formatDuration(seg.start)}`}
              >
                ▶
              </button>
              {/* Timestamp */}
              <span className="flex-shrink-0 text-xs font-mono text-muted2 mt-0.5 w-12">
                {formatDuration(seg.start)}
              </span>
              {/* Text */}
              <span
                className={cn(
                  "text-xs leading-relaxed",
                  activeSegment === i ? "text-text" : "text-muted2",
                )}
              >
                {seg.text}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
