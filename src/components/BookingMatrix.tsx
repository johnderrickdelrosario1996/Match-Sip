import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Calendar as CalendarIcon, Check, Lock, RotateCcw, ChevronLeft, ChevronRight, ArrowRight, Layers } from 'lucide-react';
import { generateSlotsForCourt } from '../data/mockData';
import { TimeSlot, SelectedSlot, ConfirmedBooking } from '../types';
import { CalendarPopup } from './CalendarPopup';
import { getTodayDateString, formatDateToDDMMYYYY, addDaysToDateStr } from '../utils/dateUtils';

interface BookingMatrixProps {
  selectedDate: string;
  onSelectDate: (date: string) => void;
  selectedSlots: SelectedSlot[];
  persistedBookings: ConfirmedBooking[];
  isLoadingBookings: boolean;
  onToggleSlot: (slot: TimeSlot, dateStr: string) => void;
  onClearSlots: () => void;
  onProceedToCheckout: () => void;
  onOpenReservationsModal?: () => void;
}

export const BookingMatrix: React.FC<BookingMatrixProps> = ({
  selectedDate,
  onSelectDate,
  selectedSlots,
  persistedBookings,
  isLoadingBookings,
  onToggleSlot,
  onClearSlots,
  onProceedToCheckout,
  onOpenReservationsModal,
}) => {
  // Real-time current date state (synchronizes every 10 seconds to update on midnight/date change)
  const [currentTodayStr, setCurrentTodayStr] = useState<string>(() => getTodayDateString());
  const [isCalendarOpen, setIsCalendarOpen] = useState<boolean>(false);
  // Mobile court tab switcher: 'all' | 'court-1' | 'court-2'
  const [mobileCourtFilter, setMobileCourtFilter] = useState<'all' | 'court-1' | 'court-2'>('all');

  useEffect(() => {
    const checkMidnight = () => {
      const liveToday = getTodayDateString();
      if (liveToday !== currentTodayStr) {
        setCurrentTodayStr(liveToday);
      }
    };
    const interval = setInterval(checkMidnight, 10000);
    return () => clearInterval(interval);
  }, [currentTodayStr]);

  // Format date for display: "20/09/2026"
  const formattedDisplayDate = useMemo(() => {
    return formatDateToDDMMYYYY(selectedDate);
  }, [selectedDate]);

  // Quick navigation dates
  const isSelectedDateToday = selectedDate === currentTodayStr;
  const tomorrowStr = useMemo(() => addDaysToDateStr(currentTodayStr, 1), [currentTodayStr]);

  const handlePrevDay = () => {
    if (isSelectedDateToday) return;
    const prevDate = addDaysToDateStr(selectedDate, -1);
    onSelectDate(prevDate);
  };

  const handleNextDay = () => {
    const nextDate = addDaysToDateStr(selectedDate, 1);
    onSelectDate(nextDate);
  };

  // Extract all booked slot IDs and time matches for the current selected date from Supabase
  const bookedSlotsMap = useMemo(() => {
    const map = new Map<string, { bookingRef: string; customerName: string; status: string }>();

    persistedBookings.forEach((b) => {
      // Ignore cancelled or rejected bookings
      if (b.status === 'CANCELLED' || b.status === 'REJECTED') return;

      // Check if booking or any of its slots match the currently viewed selectedDate
      const bookingMatchesDate = b.selectedDate === selectedDate;

      (b.slots || []).forEach((s) => {
        const slotMatchesDate = s.date ? s.date === selectedDate : bookingMatchesDate;
        if (!bookingMatchesDate && !slotMatchesDate) return;

        const info = {
          bookingRef: b.bookingReference,
          customerName: b.customer?.fullName || 'Reserved',
          status: b.status || 'VERIFIED',
        };

        // 1. Direct slotId key
        if (s.slotId) {
          map.set(s.slotId, info);
        }

        // 2. Canonical court-HHMM key (e.g. "court-1-0800")
        const match = (s.timeLabel || '').match(/(\d{1,2}):(\d{2})/);
        if (s.courtId && match) {
          const hh = match[1].padStart(2, '0');
          const mm = match[2];
          map.set(`${s.courtId}-${hh}${mm}`, info);
          map.set(`${s.courtId}-${hh}:${mm}`, info);
        }

        // 3. Court + full timeLabel key
        if (s.courtId && s.timeLabel) {
          map.set(`${s.courtId}-${s.timeLabel.trim()}`, info);
          map.set(`${s.courtId}-${s.timeLabel.replace(/\s+/g, '')}`, info);
        }
      });
    });

    return map;
  }, [persistedBookings, selectedDate]);

  // Helper to determine if a TimeSlot is booked with fast O(1) Map checks
  const isSlotBooked = useCallback((slot: TimeSlot): boolean => {
    const timeDigits = slot.startTime.replace(':', '');
    const compactRange = `${slot.startTime}-${slot.endTime}`;
    return (
      bookedSlotsMap.has(slot.id) ||
      bookedSlotsMap.has(`${slot.courtId}-${timeDigits}`) ||
      bookedSlotsMap.has(`${slot.courtId}-${slot.startTime}`) ||
      bookedSlotsMap.has(`${slot.courtId}-${slot.timeLabel}`) ||
      bookedSlotsMap.has(`${slot.courtId}-${compactRange}`)
    );
  }, [bookedSlotsMap]);

  // Helper to get booking DB info
  const getSlotDbInfo = useCallback((slot: TimeSlot) => {
    const timeDigits = slot.startTime.replace(':', '');
    const compactRange = `${slot.startTime}-${slot.endTime}`;
    return (
      bookedSlotsMap.get(slot.id) ||
      bookedSlotsMap.get(`${slot.courtId}-${timeDigits}`) ||
      bookedSlotsMap.get(`${slot.courtId}-${slot.startTime}`) ||
      bookedSlotsMap.get(`${slot.courtId}-${slot.timeLabel}`) ||
      bookedSlotsMap.get(`${slot.courtId}-${compactRange}`)
    );
  }, [bookedSlotsMap]);

  // Generate base slots and overlay database persistence
  const court1Base = useMemo(() => generateSlotsForCourt('court-1', selectedDate), [selectedDate]);
  const court2Base = useMemo(() => generateSlotsForCourt('court-2', selectedDate), [selectedDate]);

  const court1Slots = useMemo(() => {
    return court1Base.map((s) => {
      if (isSlotBooked(s)) {
        return { ...s, status: 'BOOKED' as const };
      }
      return s;
    });
  }, [court1Base, isSlotBooked]);

  const court2Slots = useMemo(() => {
    return court2Base.map((s) => {
      if (isSlotBooked(s)) {
        return { ...s, status: 'BOOKED' as const };
      }
      return s;
    });
  }, [court2Base, isSlotBooked]);

  const allSlots = useMemo(() => [...court1Slots, ...court2Slots], [court1Slots, court2Slots]);
  const totalOpenSlots = useMemo(() => allSlots.filter((s) => s.status === 'OPEN').length, [allSlots]);
  const totalSlotsCount = allSlots.length; // 32

  const court1OpenCount = useMemo(() => court1Slots.filter((s) => s.status === 'OPEN').length, [court1Slots]);
  const court2OpenCount = useMemo(() => court2Slots.filter((s) => s.status === 'OPEN').length, [court2Slots]);

  const totalPrice = useMemo(() => {
    return selectedSlots.reduce((sum, item) => sum + item.price, 0);
  }, [selectedSlots]);

  const selectedSlotIdsSet = useMemo(() => {
    const set = new Set<string>();
    for (const s of selectedSlots) {
      if (s.date === selectedDate) {
        set.add(s.slotId);
      }
    }
    return set;
  }, [selectedSlots, selectedDate]);

  const isSlotSelected = useCallback((slotId: string) => {
    return selectedSlotIdsSet.has(slotId);
  }, [selectedSlotIdsSet]);

  const renderSlotButton = useCallback((slot: TimeSlot) => {
    const selected = isSlotSelected(slot.id);
    const isBooked = isSlotBooked(slot);
    const dbInfo = getSlotDbInfo(slot);

    if (isBooked) {
      const isHeld = dbInfo?.status === 'HELD';
      return (
        <div
          key={slot.id}
          title={
            isHeld
              ? 'Slot is currently held in checkout by another player (expires in 5 min)'
              : dbInfo
              ? `Reserved by ${dbInfo.customerName} (#${dbInfo.bookingRef})`
              : 'Slot Booked'
          }
          className={`flex flex-col items-center justify-center rounded-xl px-1 sm:px-2 py-2 text-[#FFFFFF] select-none cursor-not-allowed min-h-[56px] sm:min-h-[62px] transition-all relative group text-center border ${
            isHeld
              ? 'bg-[#5E2CB2]/80 border-amber-400/40 opacity-90'
              : 'bg-[#5E2CB2] border-white/10'
          }`}
        >
          <div className="flex items-center justify-center w-full leading-none my-auto">
            <span className="whitespace-nowrap font-mono text-[11px] sm:text-xs md:text-sm font-bold tracking-tight text-center tabular-nums leading-none select-none opacity-90">
              {slot.startTime}-{slot.endTime}
            </span>
          </div>

          <span className={`text-[8.5px] sm:text-[9.5px] font-bold uppercase tracking-wider flex items-center justify-center gap-0.5 mt-0.5 leading-none shrink-0 whitespace-nowrap ${
            isHeld ? 'text-amber-300' : 'text-[#B3A2DB]'
          }`}>
            <Lock className="h-2.5 w-2.5 shrink-0" /> {isHeld ? 'IN PROGRESS' : 'BOOKED'}
          </span>
          {dbInfo && (
            <span className="absolute -top-1 -right-1 flex h-2 w-2">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${isHeld ? 'bg-amber-400' : 'bg-[#00C6FF]'} opacity-75`} />
              <span className={`relative inline-flex rounded-full h-2 w-2 ${isHeld ? 'bg-amber-400' : 'bg-[#00C6FF]'}`} />
            </span>
          )}
        </div>
      );
    }

    return (
      <button
        key={slot.id}
        type="button"
        id={`slot-${slot.id}`}
        onClick={() => onToggleSlot(slot, selectedDate)}
        className={`flex flex-col items-center justify-center rounded-xl transition-all duration-150 cursor-pointer min-h-[56px] sm:min-h-[62px] px-1 sm:px-2 py-2 text-center active:scale-95 touch-manipulation ${
          selected
            ? 'bg-[#00C6FF] border-2 border-[#00C6FF] text-black font-black shadow-md shadow-[#00C6FF]/35 scale-[1.02]'
            : 'bg-[#FFFFFF] border-2 border-[#B3A2DB]/60 text-[#5E2CB2] hover:bg-[#00C6FF]/10 hover:border-[#00C6FF] active:bg-[#00C6FF]/20 font-bold'
        }`}
      >
        <div className="flex items-center justify-center w-full leading-none my-auto">
          <span className="whitespace-nowrap font-mono text-[11px] sm:text-xs md:text-sm font-bold tracking-tight text-center tabular-nums leading-none select-none">
            {slot.startTime}-{slot.endTime}
          </span>
        </div>

        {selected ? (
          <span className="text-[9px] sm:text-[10px] font-black uppercase text-black flex items-center justify-center gap-0.5 mt-0.5 leading-none shrink-0 whitespace-nowrap">
            <Check className="h-2.5 w-2.5 stroke-[3] shrink-0" /> PICKED
          </span>
        ) : (
          <span className="text-[9.5px] sm:text-[10px] text-[#5E2CB2]/80 font-bold mt-0.5 leading-none shrink-0 whitespace-nowrap">
            ₱{slot.price}
          </span>
        )}
      </button>
    );
  }, [isSlotSelected, isSlotBooked, getSlotDbInfo, onToggleSlot, selectedDate]);

  return (
    <section
      id="court-matrix-section"
      className="w-full bg-[#FFFFFF] text-[#5E2CB2] py-6 sm:py-16 lg:py-20 relative"
    >
      <div className="mx-auto max-w-7xl px-3 min-[360px]:px-4 sm:px-6 lg:px-8">
        {/* Top Header Row */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 sm:gap-6 pb-4 sm:pb-8 border-b border-[#B3A2DB]/20">
          {/* Left Title */}
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm font-black tracking-widest uppercase text-[#5E2CB2] mb-1 sm:mb-2">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
              <span>LIVE COURT MATRIX</span>
            </div>

            <h2 className="font-heading text-3xl min-[360px]:text-4xl sm:text-5xl md:text-6xl lg:text-[68px] font-black uppercase tracking-tight text-[#5E2CB2] leading-[0.95]">
              PICK YOUR<br />
              TIME &amp; SPACE
            </h2>
          </div>

          {/* Right Stats */}
          <div className="flex flex-row md:flex-col items-center md:items-end justify-between text-left md:text-right bg-[#5E2CB2]/5 md:bg-transparent p-3 md:p-0 rounded-2xl">
            <div>
              <span className="text-[10px] sm:text-xs font-bold uppercase tracking-widest text-[#5E2CB2]/80 block">
                AVAILABLE SLOTS
              </span>
              <div className="font-heading text-2xl sm:text-4xl lg:text-5xl font-black text-[#5E2CB2] leading-none my-0.5 sm:my-1">
                {totalOpenSlots}/{totalSlotsCount}
              </div>
            </div>
            <span className="text-[10px] sm:text-xs font-semibold text-[#5E2CB2]/70 max-w-full text-right">
              08:00-24:00 • ₱150-200/HR
            </span>
          </div>
        </div>

        {/* Date Selector & Thumb-Friendly Date Stepper Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 py-4 sm:py-6">
          {/* Quick Date Chips for Thumbs */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
            <button
              type="button"
              onClick={() => onSelectDate(currentTodayStr)}
              className={`rounded-xl px-3 py-2 text-xs font-black uppercase tracking-wider transition-all cursor-pointer active:scale-95 shrink-0 min-h-[40px] flex items-center ${
                selectedDate === currentTodayStr
                  ? 'bg-[#5E2CB2] text-white shadow-sm'
                  : 'bg-[#5E2CB2]/10 text-[#5E2CB2] hover:bg-[#5E2CB2]/20'
              }`}
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => onSelectDate(tomorrowStr)}
              className={`rounded-xl px-3 py-2 text-xs font-black uppercase tracking-wider transition-all cursor-pointer active:scale-95 shrink-0 min-h-[40px] flex items-center ${
                selectedDate === tomorrowStr
                  ? 'bg-[#5E2CB2] text-white shadow-sm'
                  : 'bg-[#5E2CB2]/10 text-[#5E2CB2] hover:bg-[#5E2CB2]/20'
              }`}
            >
              Tomorrow
            </button>
          </div>

          {/* Date Picker Button with Previous / Next Day Arrows */}
          <div className="flex items-center gap-1.5 ml-auto">
            {/* Previous Day Thumb Button */}
            <button
              type="button"
              onClick={handlePrevDay}
              disabled={isSelectedDateToday}
              className={`flex h-10 w-10 items-center justify-center rounded-xl border border-[#B3A2DB] transition-all ${
                isSelectedDateToday
                  ? 'opacity-30 cursor-not-allowed bg-gray-50 text-gray-400'
                  : 'hover:border-[#5E2CB2] hover:bg-[#5E2CB2]/10 text-[#5E2CB2] active:scale-90 cursor-pointer'
              }`}
              aria-label="Previous day"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>

            {/* Date Popover Trigger */}
            <button
              type="button"
              id="open-calendar-popover-btn"
              onClick={() => setIsCalendarOpen(true)}
              className="group relative flex items-center gap-2 rounded-xl border-2 border-[#B3A2DB] bg-[#FFFFFF] px-3.5 py-2 text-xs sm:text-sm font-black text-[#5E2CB2] shadow-sm hover:border-[#5E2CB2] hover:bg-[#FAF8FF] transition-all active:scale-95 cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#00C6FF] min-h-[40px]"
              aria-label={`Selected date: ${formattedDisplayDate}. Click to open pop-up calendar`}
              aria-haspopup="dialog"
              aria-expanded={isCalendarOpen}
            >
              {selectedDate === currentTodayStr && (
                <span className="inline-flex items-center gap-1 rounded-md bg-[#5E2CB2]/10 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-[#5E2CB2]">
                  TODAY
                </span>
              )}
              <span className="font-mono">{formattedDisplayDate}</span>
              <CalendarIcon className="h-4 w-4 text-[#5E2CB2] group-hover:text-[#5E2CB2]/70 transition-colors shrink-0" />
            </button>

            {/* Next Day Thumb Button */}
            <button
              type="button"
              onClick={handleNextDay}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#B3A2DB] hover:border-[#5E2CB2] hover:bg-[#5E2CB2]/10 text-[#5E2CB2] transition-all active:scale-90 cursor-pointer"
              aria-label="Next day"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Mobile Court Filter Tab Switcher (Visible only on mobile/tablet screens for clean thumb navigation) */}
        <div className="flex sm:hidden items-center justify-between p-1 bg-[#5E2CB2]/10 rounded-2xl border border-[#B3A2DB]/40 mb-4">
          <button
            type="button"
            onClick={() => setMobileCourtFilter('all')}
            className={`flex-1 py-2 text-center text-xs font-black uppercase tracking-wider rounded-xl transition-all min-h-[38px] cursor-pointer ${
              mobileCourtFilter === 'all'
                ? 'bg-[#5E2CB2] text-white shadow-sm'
                : 'text-[#5E2CB2] hover:bg-white/40'
            }`}
          >
            All Courts
          </button>
          <button
            type="button"
            onClick={() => setMobileCourtFilter('court-1')}
            className={`flex-1 py-2 text-center text-xs font-black uppercase tracking-wider rounded-xl transition-all min-h-[38px] cursor-pointer flex items-center justify-center gap-1 ${
              mobileCourtFilter === 'court-1'
                ? 'bg-[#5E2CB2] text-white shadow-sm'
                : 'text-[#5E2CB2] hover:bg-white/40'
            }`}
          >
            <span>Court 01</span>
            <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
              mobileCourtFilter === 'court-1' ? 'bg-white/30 text-white' : 'bg-[#5E2CB2]/20 text-[#5E2CB2]'
            }`}>
              {court1OpenCount}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setMobileCourtFilter('court-2')}
            className={`flex-1 py-2 text-center text-xs font-black uppercase tracking-wider rounded-xl transition-all min-h-[38px] cursor-pointer flex items-center justify-center gap-1 ${
              mobileCourtFilter === 'court-2'
                ? 'bg-[#5E2CB2] text-white shadow-sm'
                : 'text-[#5E2CB2] hover:bg-white/40'
            }`}
          >
            <span>Court 02</span>
            <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
              mobileCourtFilter === 'court-2' ? 'bg-white/30 text-white' : 'bg-[#5E2CB2]/20 text-[#5E2CB2]'
            }`}>
              {court2OpenCount}
            </span>
          </button>
        </div>

        {/* Courts Grid Container */}
        <div className="space-y-4 sm:space-y-6">
          {/* Court 01 Card */}
          {(mobileCourtFilter === 'all' || mobileCourtFilter === 'court-1') && (
            <div className="rounded-2xl sm:rounded-3xl border-2 border-[#B3A2DB]/40 bg-[#FFFFFF] p-3.5 min-[360px]:p-4 sm:p-7 shadow-sm transition-all">
              {/* Card Header */}
              <div className="flex items-center justify-between pb-3 sm:pb-5 border-b border-[#B3A2DB]/20">
                <div className="flex items-baseline gap-1.5 sm:gap-2">
                  <span className="text-xs sm:text-sm font-black uppercase tracking-wider text-[#5E2CB2]">
                    COURT
                  </span>
                  <span className="font-heading text-2xl sm:text-3xl md:text-4xl font-black text-[#5E2CB2]">
                    01
                  </span>
                </div>
                <span className="rounded-full bg-[#B3A2DB]/25 px-2.5 py-0.5 sm:px-3 sm:py-1 text-[11px] sm:text-xs font-black uppercase tracking-wider text-[#5E2CB2]">
                  {court1OpenCount} OPEN
                </span>
              </div>

              {/* Time Slot Grid (4 cols on mobile, 8 cols on desktop) */}
              <div className="mt-3.5 sm:mt-5 grid grid-cols-4 sm:grid-cols-8 gap-2 sm:gap-2.5">
                {court1Slots.map(renderSlotButton)}
              </div>
            </div>
          )}

          {/* Court 02 Card */}
          {(mobileCourtFilter === 'all' || mobileCourtFilter === 'court-2') && (
            <div className="rounded-2xl sm:rounded-3xl border-2 border-[#B3A2DB]/40 bg-[#FFFFFF] p-3.5 min-[360px]:p-4 sm:p-7 shadow-sm transition-all">
              {/* Card Header */}
              <div className="flex items-center justify-between pb-3 sm:pb-5 border-b border-[#B3A2DB]/20">
                <div className="flex items-baseline gap-1.5 sm:gap-2">
                  <span className="text-xs sm:text-sm font-black uppercase tracking-wider text-[#5E2CB2]">
                    COURT
                  </span>
                  <span className="font-heading text-2xl sm:text-3xl md:text-4xl font-black text-[#5E2CB2]">
                    02
                  </span>
                </div>
                <span className="rounded-full bg-[#B3A2DB]/25 px-2.5 py-0.5 sm:px-3 sm:py-1 text-[11px] sm:text-xs font-black uppercase tracking-wider text-[#5E2CB2]">
                  {court2OpenCount} OPEN
                </span>
              </div>

              {/* Time Slot Grid (4 cols on mobile, 8 cols on desktop) */}
              <div className="mt-3.5 sm:mt-5 grid grid-cols-4 sm:grid-cols-8 gap-2 sm:gap-2.5">
                {court2Slots.map(renderSlotButton)}
              </div>
            </div>
          )}

          {/* Your Selection Summary Card */}
          <div className="rounded-2xl sm:rounded-3xl border-2 border-[#B3A2DB]/40 bg-[#FFFFFF] p-4 sm:p-7 shadow-sm">
            <div className="flex items-center justify-between pb-3">
              <span className="text-xs sm:text-base font-black uppercase tracking-wider text-[#5E2CB2]">
                YOUR SELECTION ({selectedSlots.length})
              </span>
              <span className="font-heading text-2xl sm:text-3xl font-black text-[#5E2CB2]">
                ₱{totalPrice}
              </span>
            </div>

            {/* Slot details or empty state message */}
            <div className="py-2 text-xs sm:text-sm text-[#5E2CB2]/80">
              {selectedSlots.length === 0 ? (
                <span>No slots selected yet. Tap open slots above to add them to your reservation.</span>
              ) : (
                <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                  {selectedSlots.map((s) => (
                    <span
                      key={`${s.courtId}-${s.slotId}-${s.date}`}
                      className="inline-flex flex-wrap items-center gap-1 rounded-lg bg-[#B3A2DB]/25 border border-[#B3A2DB]/50 px-2.5 py-1 text-xs font-bold text-[#5E2CB2] max-w-full"
                    >
                      <span>{s.courtName}</span>
                      <span className="font-mono">({s.timeLabel.replace(/\s*-\s*/, '-')})</span>
                      <span className="text-[#5E2CB2]/70 font-semibold">• ₱{s.price}</span>
                    </span>
                  ))}
                  <button
                    type="button"
                    onClick={onClearSlots}
                    className="ml-auto flex items-center gap-1 text-xs font-bold text-red-500 hover:text-red-700 cursor-pointer pt-1 sm:pt-0"
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> Clear All
                  </button>
                </div>
              )}
            </div>

            {/* Continue to Checkout / Book Reservation Button */}
            <div className="mt-4 pt-3 border-t border-[#B3A2DB]/20">
              <button
                type="button"
                id="continue-to-checkout-btn"
                onClick={onProceedToCheckout}
                disabled={selectedSlots.length === 0}
                className={`w-full rounded-xl py-4 px-6 text-center text-xs sm:text-sm font-black uppercase tracking-wider transition-all min-h-[52px] sm:min-h-[56px] flex items-center justify-center gap-2 ${
                  selectedSlots.length > 0
                    ? 'bg-[#00C6FF] text-black shadow-lg shadow-[#00C6FF]/30 hover:bg-[#00C6FF]/90 hover:scale-[1.01] active:scale-95 cursor-pointer'
                    : 'bg-[#B3A2DB]/25 text-[#5E2CB2]/40 cursor-not-allowed'
                }`}
              >
                <span>BOOK RESERVATION</span>
                {selectedSlots.length > 0 && <ArrowRight className="h-4 w-4 stroke-[3]" />}
              </button>
            </div>
          </div>
        </div>
      </div>


      {/* Pop-up Calendar */}
      <CalendarPopup
        isOpen={isCalendarOpen}
        onClose={() => setIsCalendarOpen(false)}
        selectedDate={selectedDate}
        onSelectDate={(newDate) => {
          onSelectDate(newDate);
          setIsCalendarOpen(false);
        }}
        currentTodayStr={currentTodayStr}
      />
    </section>
  );
};
