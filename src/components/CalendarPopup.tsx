import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, X, Check, Clock } from 'lucide-react';
import {
  formatDateToDDMMYYYY,
  formatDateToFullReadable,
  addDaysToDateStr,
  getNextWeekendDay,
} from '../utils/dateUtils';

interface CalendarPopupProps {
  isOpen: boolean;
  onClose: () => void;
  selectedDate: string;
  onSelectDate: (dateStr: string) => void;
  currentTodayStr: string;
  allowPastDates?: boolean;
  bookingDates?: string[];
  title?: string;
  subtitle?: string;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const CalendarPopup: React.FC<CalendarPopupProps> = ({
  isOpen,
  onClose,
  selectedDate,
  onSelectDate,
  currentTodayStr,
  allowPastDates = false,
  bookingDates = [],
  title,
  subtitle,
}) => {
  const modalRef = useRef<HTMLDivElement>(null);

  // Parse view month and year from selectedDate or fallback to currentTodayStr
  const [viewYear, setViewYear] = useState<number>(() => {
    const parts = (selectedDate && selectedDate !== 'all' ? selectedDate : currentTodayStr).split('-').map(Number);
    return parts[0] || new Date().getFullYear();
  });

  const [viewMonth, setViewMonth] = useState<number>(() => {
    const parts = (selectedDate && selectedDate !== 'all' ? selectedDate : currentTodayStr).split('-').map(Number);
    return (parts[1] || 1) - 1; // 0-indexed
  });

  // Keep view in sync when opening with a new selectedDate
  useEffect(() => {
    if (isOpen && selectedDate && selectedDate !== 'all') {
      const parts = selectedDate.split('-').map(Number);
      if (parts[0] && parts[1]) {
        setViewYear(parts[0]);
        setViewMonth(parts[1] - 1);
      }
    }
  }, [isOpen, selectedDate]);

  // Handle ESC key and click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  // Real-time parsed today parts
  const todayParts = useMemo(() => {
    const [y, m, d] = currentTodayStr.split('-').map(Number);
    return { year: y, month: m - 1, day: d };
  }, [currentTodayStr]);

  // Check if we can navigate to previous month
  const canGoPrevMonth = useMemo(() => {
    if (allowPastDates) return true;
    if (viewYear > todayParts.year) return true;
    if (viewYear === todayParts.year && viewMonth > todayParts.month) return true;
    return false;
  }, [viewYear, viewMonth, todayParts, allowPastDates]);

  const handlePrevMonth = () => {
    if (!canGoPrevMonth) return;
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const handleJumpToToday = () => {
    setViewYear(todayParts.year);
    setViewMonth(todayParts.month);
    onSelectDate(currentTodayStr);
  };

  // Build calendar matrix (Sunday = 0, Monday = 1 ... Saturday = 6)
  const calendarDays = useMemo(() => {
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const startOffset = new Date(viewYear, viewMonth, 1).getDay(); // 0 = Sun, 1 = Mon ... 6 = Sat

    const cells = [];

    // Empty cells before 1st day
    for (let i = 0; i < startOffset; i++) {
      cells.push({
        dayNum: null,
        dateStr: '',
        isCurrentMonth: false,
        isPast: true,
        isToday: false,
        isSelected: false,
        hasBooking: false,
      });
    }

    // Days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      const mStr = String(viewMonth + 1).padStart(2, '0');
      const dStr = String(day).padStart(2, '0');
      const dateStr = `${viewYear}-${mStr}-${dStr}`;

      const isPast = dateStr < currentTodayStr;
      const isToday = dateStr === currentTodayStr;
      const isSelected = dateStr === selectedDate;
      const hasBooking = bookingDates.includes(dateStr);

      cells.push({
        dayNum: day,
        dateStr,
        isCurrentMonth: true,
        isPast,
        isToday,
        isSelected,
        hasBooking,
      });
    }

    return cells;
  }, [viewYear, viewMonth, currentTodayStr, selectedDate, bookingDates]);

  if (!isOpen) return null;

  const yesterdayStr = addDaysToDateStr(currentTodayStr, -1);
  const tomorrowStr = addDaysToDateStr(currentTodayStr, 1);
  const thisSatStr = getNextWeekendDay(currentTodayStr, 6);
  const thisSunStr = getNextWeekendDay(currentTodayStr, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label="Pick court reservation date"
        className="relative w-full max-w-sm sm:max-w-md rounded-2xl sm:rounded-3xl border border-[#B3A2DB]/50 bg-[#FFFFFF] p-5 sm:p-6 text-[#5E2CB2] shadow-2xl animate-in zoom-in-95 duration-150 flex flex-col gap-4"
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-[#B3A2DB]/30">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#5E2CB2] text-[#00C6FF]">
              <CalendarIcon className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-black uppercase tracking-tight text-[#5E2CB2]">
                {title || 'SELECT RESERVATION DATE'}
              </h3>
              <p className="text-[10px] sm:text-xs text-[#5E2CB2]/70">
                {subtitle || (allowPastDates ? 'Select any past or present date to view bookings' : 'Book courts up to 60 days in advance')}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-gray-400 hover:text-[#5E2CB2] hover:bg-gray-100 transition-colors cursor-pointer"
            aria-label="Close calendar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Real-time Indicator Badge */}
        <div className="flex items-center justify-between rounded-xl bg-[#5E2CB2]/5 border border-[#5E2CB2]/15 px-3 py-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#00C6FF] opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[#00C6FF]" />
            </span>
            <span className="font-bold text-[#5E2CB2] text-[11px] sm:text-xs">
              Live Real-Time Clock
            </span>
          </div>
          <span className="font-bold text-[#0088B0] text-[11px] sm:text-xs">
            Today: {formatDateToDDMMYYYY(currentTodayStr)}
          </span>
        </div>

        {/* Quick Date Presets */}
        <div className="flex flex-wrap items-center gap-1.5">
          {allowPastDates && (
            <button
              type="button"
              onClick={() => {
                onSelectDate('all');
                onClose();
              }}
              className={`rounded-lg px-2.5 py-1 text-xs font-bold transition-all cursor-pointer ${
                selectedDate === 'all' || !selectedDate
                  ? 'bg-[#5E2CB2] text-white shadow-sm'
                  : 'bg-gray-100 text-[#5E2CB2] hover:bg-[#00C6FF]/20'
              }`}
            >
              All Bookings
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              onSelectDate(currentTodayStr);
              setViewYear(todayParts.year);
              setViewMonth(todayParts.month);
            }}
            className={`rounded-lg px-2.5 py-1 text-xs font-bold transition-all cursor-pointer ${
              selectedDate === currentTodayStr
                ? 'bg-[#5E2CB2] text-white shadow-sm'
                : 'bg-gray-100 text-[#5E2CB2] hover:bg-[#00C6FF]/20'
            }`}
          >
            Today
          </button>

          {allowPastDates ? (
            <button
              type="button"
              onClick={() => {
                onSelectDate(yesterdayStr);
                const p = yesterdayStr.split('-').map(Number);
                setViewYear(p[0]);
                setViewMonth(p[1] - 1);
              }}
              className={`rounded-lg px-2.5 py-1 text-xs font-bold transition-all cursor-pointer ${
                selectedDate === yesterdayStr
                  ? 'bg-[#5E2CB2] text-white shadow-sm'
                  : 'bg-gray-100 text-[#5E2CB2] hover:bg-[#00C6FF]/20'
              }`}
            >
              Yesterday
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  onSelectDate(tomorrowStr);
                  const p = tomorrowStr.split('-').map(Number);
                  setViewYear(p[0]);
                  setViewMonth(p[1] - 1);
                }}
                className={`rounded-lg px-2.5 py-1 text-xs font-bold transition-all cursor-pointer ${
                  selectedDate === tomorrowStr
                    ? 'bg-[#5E2CB2] text-white shadow-sm'
                    : 'bg-gray-100 text-[#5E2CB2] hover:bg-[#00C6FF]/20'
                }`}
              >
                Tomorrow
              </button>

              <button
                type="button"
                onClick={() => {
                  onSelectDate(thisSatStr);
                  const p = thisSatStr.split('-').map(Number);
                  setViewYear(p[0]);
                  setViewMonth(p[1] - 1);
                }}
                className={`rounded-lg px-2.5 py-1 text-xs font-bold transition-all cursor-pointer ${
                  selectedDate === thisSatStr
                    ? 'bg-[#5E2CB2] text-white shadow-sm'
                    : 'bg-gray-100 text-[#5E2CB2] hover:bg-[#00C6FF]/20'
                }`}
              >
                This Sat
              </button>

              <button
                type="button"
                onClick={() => {
                  onSelectDate(thisSunStr);
                  const p = thisSunStr.split('-').map(Number);
                  setViewYear(p[0]);
                  setViewMonth(p[1] - 1);
                }}
                className={`rounded-lg px-2.5 py-1 text-xs font-bold transition-all cursor-pointer ${
                  selectedDate === thisSunStr
                    ? 'bg-[#5E2CB2] text-white shadow-sm'
                    : 'bg-gray-100 text-[#5E2CB2] hover:bg-[#00C6FF]/20'
                }`}
              >
                This Sun
              </button>
            </>
          )}
        </div>

        {/* Month Navigation Row */}
        <div className="flex items-center justify-between px-1">
          <button
            type="button"
            onClick={handlePrevMonth}
            disabled={!canGoPrevMonth}
            className={`rounded-xl p-2 transition-colors ${
              canGoPrevMonth
                ? 'text-[#5E2CB2] hover:bg-[#5E2CB2]/10 cursor-pointer'
                : 'text-gray-300 cursor-not-allowed'
            }`}
            aria-label="Previous Month"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>

          <div className="flex items-center gap-2">
            <span className="font-heading text-sm sm:text-base font-black tracking-wider uppercase text-[#5E2CB2]">
              {MONTH_NAMES[viewMonth]} {viewYear}
            </span>
          </div>

          <button
            type="button"
            onClick={handleNextMonth}
            className="rounded-xl p-2 text-[#5E2CB2] hover:bg-[#5E2CB2]/10 transition-colors cursor-pointer"
            aria-label="Next Month"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>

        {/* Calendar Table */}
        <div className="w-full">
          {/* Weekday headers */}
          <div className="grid grid-cols-7 gap-1 text-center mb-1">
            {WEEKDAY_NAMES.map((w) => (
              <div
                key={w}
                className="py-1 text-[11px] font-black uppercase tracking-wider text-gray-400"
              >
                {w}
              </div>
            ))}
          </div>

          {/* Days Grid */}
          <div className="grid grid-cols-7 gap-1 text-center">
            {calendarDays.map((cell, idx) => {
              if (!cell.isCurrentMonth || !cell.dayNum) {
                return <div key={`empty-${idx}`} className="h-9 w-full" />;
              }

              const isPastDisabled = !allowPastDates && cell.isPast;

              return (
                <button
                  key={cell.dateStr}
                  type="button"
                  disabled={isPastDisabled}
                  onClick={() => {
                    onSelectDate(cell.dateStr);
                    if (allowPastDates) {
                      onClose();
                    }
                  }}
                  className={`relative flex h-9 w-full flex-col items-center justify-center rounded-xl text-xs font-bold transition-all ${
                    cell.isSelected
                      ? 'bg-[#5E2CB2] text-white shadow-md shadow-[#5E2CB2]/30 scale-105 z-10'
                      : isPastDisabled
                      ? 'text-gray-300 cursor-not-allowed bg-transparent'
                      : cell.hasBooking
                      ? 'text-[#5E2CB2] font-black bg-[#00C6FF]/15 border border-[#00C6FF]/50 hover:bg-[#00C6FF]/30 cursor-pointer'
                      : 'text-[#5E2CB2] hover:bg-[#00C6FF]/25 hover:border-[#00C6FF] border border-transparent cursor-pointer'
                  }`}
                  aria-label={`${cell.dateStr}${cell.isToday ? ' (Today)' : ''}${
                    cell.hasBooking ? ' (Has court bookings)' : ''
                  }${isPastDisabled ? ' (Past date, unavailable)' : ''}`}
                >
                  <span>{cell.dayNum}</span>

                  {/* Has booking indicator */}
                  {cell.hasBooking && !cell.isSelected && (
                    <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-[#00C6FF]" title="Has court bookings" />
                  )}

                  {/* Today marker */}
                  {cell.isToday && (
                    <span
                      className={`absolute bottom-1 h-1 w-1 rounded-full ${
                        cell.isSelected ? 'bg-[#00C6FF]' : 'bg-[#5E2CB2]'
                      }`}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Footer info & confirmation */}
        <div className="flex items-center justify-between pt-3 border-t border-[#B3A2DB]/30">
          <div className="flex flex-col">
            <span className="text-[10px] font-bold uppercase text-gray-400">
              Selected Date
            </span>
            <span className="text-xs sm:text-sm font-black text-[#5E2CB2]">
              {selectedDate === 'all' || !selectedDate ? 'All Bookings' : formatDateToFullReadable(selectedDate)}
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-[#00C6FF] px-4 py-2 text-xs font-black uppercase tracking-wider text-black hover:bg-[#00C6FF]/90 transition-all cursor-pointer active:scale-95 shadow-md shadow-[#00C6FF]/20"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
