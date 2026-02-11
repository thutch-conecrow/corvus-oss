"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import type { LedgerEvent } from "@/types";

interface TimeTravelBarProps {
  events: LedgerEvent[];
  currentTimestamp: number;
  onTimestampChange: (timestamp: number) => void;
  onExit: () => void;
  onPrev: () => void;
  onNext: () => void;
}

export function TimeTravelBar({
  events,
  currentTimestamp,
  onTimestampChange,
  onExit,
  onPrev,
  onNext,
}: TimeTravelBarProps) {
  // Calculate min/max timestamps for the slider
  const { minTime, maxTime, eventCount } = useMemo(() => {
    if (events.length === 0) {
      const now = Date.now();
      return { minTime: now, maxTime: now, eventCount: 0 };
    }
    const times = events.map((e) => e.recordedAt);
    return {
      minTime: Math.min(...times),
      maxTime: Math.max(...times),
      eventCount: events.length,
    };
  }, [events]);

  // Format timestamp for display
  const formattedTime = useMemo(() => {
    const date = new Date(currentTimestamp);
    return date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }, [currentTimestamp]);

  // Calculate slider percentage
  const sliderPercent = useMemo(() => {
    if (maxTime === minTime) return 100;
    return ((currentTimestamp - minTime) / (maxTime - minTime)) * 100;
  }, [currentTimestamp, minTime, maxTime]);

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(e.target.value);
    onTimestampChange(value);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50"
    >
      <div className="bg-amber-950/95 backdrop-blur-sm border border-amber-700/50 rounded-lg shadow-lg shadow-amber-900/30 px-4 py-3 flex items-center gap-4">
        {/* History indicator */}
        <div className="flex items-center gap-2 text-amber-400">
          <ClockIcon />
          <span className="text-xs font-semibold uppercase tracking-wider">Viewing History</span>
        </div>

        {/* Divider */}
        <div className="w-px h-6 bg-amber-700/50" />

        {/* Navigation buttons */}
        <div className="flex items-center gap-1">
          <button
            onClick={onPrev}
            disabled={eventCount === 0}
            className="p-1.5 text-amber-400 hover:text-amber-300 hover:bg-amber-800/50 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Previous event"
          >
            <ChevronLeftIcon />
          </button>
          <button
            onClick={onNext}
            disabled={eventCount === 0}
            className="p-1.5 text-amber-400 hover:text-amber-300 hover:bg-amber-800/50 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Next event"
          >
            <ChevronRightIcon />
          </button>
        </div>

        {/* Slider */}
        <div className="relative w-48">
          <input
            type="range"
            min={minTime}
            max={maxTime}
            value={currentTimestamp}
            onChange={handleSliderChange}
            disabled={eventCount === 0}
            className="w-full h-2 bg-amber-900/50 rounded-full appearance-none cursor-pointer disabled:cursor-not-allowed
              [&::-webkit-slider-thumb]:appearance-none
              [&::-webkit-slider-thumb]:w-4
              [&::-webkit-slider-thumb]:h-4
              [&::-webkit-slider-thumb]:rounded-full
              [&::-webkit-slider-thumb]:bg-amber-400
              [&::-webkit-slider-thumb]:shadow-md
              [&::-webkit-slider-thumb]:cursor-pointer
              [&::-webkit-slider-thumb]:transition-transform
              [&::-webkit-slider-thumb]:hover:scale-110
              [&::-moz-range-thumb]:w-4
              [&::-moz-range-thumb]:h-4
              [&::-moz-range-thumb]:rounded-full
              [&::-moz-range-thumb]:bg-amber-400
              [&::-moz-range-thumb]:border-none
              [&::-moz-range-thumb]:shadow-md
              [&::-moz-range-thumb]:cursor-pointer"
          />
          {/* Progress fill */}
          <div
            className="absolute top-0 left-0 h-2 bg-amber-600/50 rounded-full pointer-events-none"
            style={{ width: `${sliderPercent}%` }}
          />
        </div>

        {/* Timestamp display */}
        <div className="text-sm text-amber-300 min-w-[140px] text-center font-medium">
          {formattedTime}
        </div>

        {/* Divider */}
        <div className="w-px h-6 bg-amber-700/50" />

        {/* Exit button */}
        <button
          onClick={onExit}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-amber-950 bg-amber-400 hover:bg-amber-300 rounded transition-colors"
        >
          <span>Exit</span>
        </button>
      </div>

      {/* Event count indicator */}
      <div className="text-center mt-2">
        <span className="text-xs text-amber-600/70">
          {eventCount} event{eventCount !== 1 ? "s" : ""} recorded
        </span>
      </div>
    </motion.div>
  );
}

// Clock icon for FAB and bar
export function ClockIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}
