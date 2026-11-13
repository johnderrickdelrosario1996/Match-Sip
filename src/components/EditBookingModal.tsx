import React, { useState, useEffect } from 'react';
import { 
  X, 
  User, 
  Phone, 
  Calendar, 
  Clock, 
  DollarSign, 
  FileText, 
  Save, 
  RefreshCw,
  Plus,
  Trash2,
  Calculator,
  Edit3
} from 'lucide-react';
import { ConfirmedBooking, SelectedSlot, CourtId } from '../types';
import { HOURLY_RANGES, BASE_PRICE_OFFPEAK, BASE_PRICE_PRIME } from '../data/mockData';
import { formatConfirmedTimestamp } from '../utils/dateUtils';

interface EditBookingModalProps {
  booking: ConfirmedBooking | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (
    bookingId: string,
    updates: {
      fullName: string;
      phoneNumber: string;
      selectedDate: string;
      status: string;
      totalAmount: number;
      notes?: string;
      slots: SelectedSlot[];
    }
  ) => Promise<void>;
}

export function buildCanonicalSlotId(courtId: CourtId, timeLabel: string): string {
  const match = (timeLabel || '').match(/(\d{1,2}):(\d{2})/);
  const timeDigits = match ? `${match[1].padStart(2, '0')}${match[2]}` : '0800';
  return `${courtId || 'court-1'}-${timeDigits}`;
}

export const EditBookingModal: React.FC<EditBookingModalProps> = ({
  booking,
  isOpen,
  onClose,
  onSave,
}) => {
  const [fullName, setFullName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [selectedDate, setSelectedDate] = useState('');
  const [status, setStatus] = useState('CONFIRMED');
  const [totalAmount, setTotalAmount] = useState<number>(0);
  const [notes, setNotes] = useState('');
  const [slots, setSlots] = useState<SelectedSlot[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (booking) {
      setFullName(booking.customer?.fullName || '');
      setPhoneNumber(booking.customer?.phoneNumber || '');
      setSelectedDate(booking.selectedDate || '');
      setStatus(booking.status || 'CONFIRMED');
      setTotalAmount(Number(booking.totalAmount) || 0);
      setNotes(booking.customer?.notes || '');
      // Deep copy existing slots and canonicalize slotId
      const initialSlots: SelectedSlot[] = Array.isArray(booking.slots)
        ? booking.slots.map((s, idx) => {
            const courtId: CourtId = s.courtId === 'court-2' ? 'court-2' : 'court-1';
            const courtName = courtId === 'court-2' ? 'Court 02' : 'Court 01';
            const timeLabel = s.timeLabel || '08:00 - 09:00';
            const canonicalId = buildCanonicalSlotId(courtId, timeLabel);

            return {
              slotId: canonicalId,
              courtId,
              courtName,
              timeLabel,
              date: s.date || booking.selectedDate,
              price: Number(s.price) || 150,
            };
          })
        : [];
      setSlots(initialSlots);
      setErrorMessage(null);
    }
  }, [booking]);

  if (!isOpen || !booking) return null;

  // Handle slot modifications with automatic canonical slotId sync
  const handleCourtChange = (index: number, courtId: CourtId) => {
    setSlots((prev) => {
      const updated = [...prev];
      const courtName = courtId === 'court-2' ? 'Court 02' : 'Court 01';
      const timeLabel = updated[index]?.timeLabel || '08:00 - 09:00';
      updated[index] = {
        ...updated[index],
        courtId,
        courtName,
        slotId: buildCanonicalSlotId(courtId, timeLabel),
      };
      return updated;
    });
  };

  const handleTimeLabelChange = (index: number, timeLabel: string) => {
    setSlots((prev) => {
      const updated = [...prev];
      const courtId = updated[index]?.courtId || 'court-1';
      updated[index] = {
        ...updated[index],
        timeLabel,
        slotId: buildCanonicalSlotId(courtId, timeLabel),
      };
      return updated;
    });
  };

  const handleSlotPriceChange = (index: number, price: number) => {
    setSlots((prev) => {
      const updated = [...prev];
      updated[index] = {
        ...updated[index],
        price: Math.max(0, price),
      };
      return updated;
    });
  };

  const handleRemoveSlot = (index: number) => {
    if (slots.length <= 1) {
      setErrorMessage('A reservation must have at least one court slot.');
      return;
    }
    setErrorMessage(null);
    setSlots((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleAddSlot = () => {
    const courtId: CourtId = 'court-1';
    const timeLabel = '08:00 - 09:00';
    const newSlot: SelectedSlot = {
      slotId: buildCanonicalSlotId(courtId, timeLabel),
      courtId,
      courtName: 'Court 01',
      timeLabel,
      date: selectedDate || booking.selectedDate,
      price: BASE_PRICE_OFFPEAK,
    };
    setSlots((prev) => [...prev, newSlot]);
  };

  const calculateSlotsTotal = () => {
    return slots.reduce((sum, s) => sum + (Number(s.price) || 0), 0);
  };

  const handleApplyCalculatedTotal = () => {
    setTotalAmount(calculateSlotsTotal());
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) {
      setErrorMessage('Player full name is required.');
      return;
    }
    if (!phoneNumber.trim()) {
      setErrorMessage('Phone number is required.');
      return;
    }
    if (!selectedDate.trim()) {
      setErrorMessage('Reservation date is required.');
      return;
    }
    if (slots.length === 0) {
      setErrorMessage('At least one court time slot is required. Click "+ Add Slot" below.');
      return;
    }

    // Check each slot has a valid time label
    for (let i = 0; i < slots.length; i++) {
      if (!slots[i].timeLabel.trim()) {
        setErrorMessage(`Please enter a valid time for Slot ${i + 1}.`);
        return;
      }
    }

    try {
      setIsSaving(true);
      setErrorMessage(null);
      const targetId = booking.bookingReference || booking.id || '';
      if (!targetId) {
        setErrorMessage('Cannot find a valid reservation reference to update.');
        return;
      }
      
      // Ensure each slot carries canonical slotId, correct courtName, and selectedDate
      const normalizedSlots: SelectedSlot[] = slots.map((s) => {
        const courtId = s.courtId || 'court-1';
        const courtName = courtId === 'court-2' ? 'Court 02' : 'Court 01';
        const timeLabel = s.timeLabel.trim();
        const slotId = buildCanonicalSlotId(courtId, timeLabel);

        return {
          ...s,
          slotId,
          courtId,
          courtName,
          timeLabel,
          date: selectedDate.trim(),
          price: Number(s.price) || 0,
        };
      });

      await onSave(targetId, {
        fullName: fullName.trim(),
        phoneNumber: phoneNumber.trim(),
        selectedDate: selectedDate.trim(),
        status,
        totalAmount: Number(totalAmount) || 0,
        notes: notes.trim(),
        slots: normalizedSlots,
      });
      onClose();
    } catch (err: any) {
      console.error('Failed to update booking:', err);
      setErrorMessage(err?.message || 'Failed to save changes. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm animate-in fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-booking-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSaving) {
          onClose();
        }
      }}
    >
      <div className="relative w-full max-w-xl rounded-3xl border-2 border-white/20 bg-[#5E2CB2] p-6 text-white shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/15 pb-4">
          <div>
            <span className="text-[10px] font-black uppercase tracking-widest text-[#00C6FF]">
              Modify Reservation &amp; Schedule
            </span>
            <h2 id="edit-booking-title" className="font-heading text-xl font-black uppercase text-white">
              Edit #{booking.bookingReference}
            </h2>
            <span className="text-[11px] text-[#B3A2DB] block mt-0.5">
              Confirmed: <strong className="text-white">{formatConfirmedTimestamp(booking.confirmedAt || booking.createdAt)}</strong>
            </span>
          </div>
          <button
            type="button"
            disabled={isSaving}
            onClick={onClose}
            className="rounded-full p-1.5 text-white/70 hover:bg-white/10 hover:text-white transition-colors cursor-pointer disabled:opacity-40"
            aria-label="Close modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Error alert */}
        {errorMessage && (
          <div className="mt-4 rounded-xl bg-red-500/20 border border-red-400/50 p-3 text-xs text-red-200">
            {errorMessage}
          </div>
        )}

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="mt-4 space-y-4 overflow-y-auto pr-1 flex-1">
          {/* Player Name */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[#B3A2DB] mb-1">
              Player Full Name
            </label>
            <div className="relative">
              <User className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#B3A2DB]" />
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g. Juan Dela Cruz"
                className="w-full rounded-xl border border-[#B3A2DB]/40 bg-white/10 py-2 pl-10 pr-4 text-xs sm:text-sm font-semibold text-white placeholder-white/40 focus:border-[#00C6FF] focus:bg-white/15 focus:outline-none"
              />
            </div>
          </div>

          {/* Phone Number */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[#B3A2DB] mb-1">
              Contact Phone Number
            </label>
            <div className="relative">
              <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#B3A2DB]" />
              <input
                type="tel"
                required
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="e.g. 0917 123 4567"
                className="w-full rounded-xl border border-[#B3A2DB]/40 bg-white/10 py-2 pl-10 pr-4 text-xs sm:text-sm font-semibold text-white placeholder-white/40 focus:border-[#00C6FF] focus:bg-white/15 focus:outline-none"
              />
            </div>
          </div>

          {/* Date & Status */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[#B3A2DB] mb-1">
                Reservation Date
              </label>
              <div className="relative">
                <Calendar className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#B3A2DB]" />
                <input
                  type="date"
                  required
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="w-full rounded-xl border border-[#B3A2DB]/40 bg-white/10 py-2 pl-10 pr-3 text-xs sm:text-sm font-semibold text-white focus:border-[#00C6FF] focus:bg-white/15 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[#B3A2DB] mb-1">
                Verification Status
              </label>
              <div className="relative">
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="w-full rounded-xl border border-[#B3A2DB]/40 bg-[#4A1E94] py-2 px-3 text-xs sm:text-sm font-semibold text-white focus:border-[#00C6FF] focus:outline-none cursor-pointer"
                >
                  <option value="CONFIRMED">CONFIRMED</option>
                  <option value="VERIFIED">VERIFIED</option>
                  <option value="PENDING">PENDING</option>
                </select>
              </div>
            </div>
          </div>

          {/* Total Amount & Notes */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-bold uppercase tracking-wider text-[#B3A2DB]">
                  Total Amount (PHP ₱)
                </label>
                {slots.length > 0 && (
                  <button
                    type="button"
                    onClick={handleApplyCalculatedTotal}
                    className="text-[10px] font-bold text-[#00C6FF] hover:underline cursor-pointer flex items-center gap-1"
                    title="Calculate total based on slot prices"
                  >
                    <Calculator className="h-2.5 w-2.5" />
                    <span>Match slots (₱{calculateSlotsTotal()})</span>
                  </button>
                )}
              </div>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-bold text-[#00C6FF]">
                  ₱
                </span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  required
                  value={totalAmount}
                  onChange={(e) => setTotalAmount(Number(e.target.value) || 0)}
                  className="w-full rounded-xl border border-[#B3A2DB]/40 bg-white/10 py-2 pl-9 pr-4 text-xs sm:text-sm font-semibold text-white focus:border-[#00C6FF] focus:bg-white/15 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[#B3A2DB] mb-1">
                Notes / Special Requests
              </label>
              <div className="relative">
                <FileText className="absolute left-3.5 top-2.5 h-4 w-4 text-[#B3A2DB]" />
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Notes or special requests..."
                  className="w-full rounded-xl border border-[#B3A2DB]/40 bg-white/10 py-2 pl-10 pr-4 text-xs sm:text-sm font-medium text-white placeholder-white/40 focus:border-[#00C6FF] focus:bg-white/15 focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* =====================================================
              RESERVED SLOTS & MANUAL TIME EDITOR (div:nth-of-type(6))
          ====================================================== */}
          <div className="rounded-2xl border border-white/20 bg-white/5 p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <span className="text-[10px] font-black uppercase tracking-wider text-[#00C6FF] block">
                  Court Schedule &amp; Time Management
                </span>
                <p className="text-[11px] text-[#B3A2DB]">
                  Edit the court, choose a preset hour, or manually enter custom reservation times.
                </p>
              </div>

              <button
                type="button"
                onClick={handleAddSlot}
                className="inline-flex items-center gap-1 rounded-full bg-[#00C6FF]/20 border border-[#00C6FF]/40 px-3 py-1 text-xs font-bold text-[#00C6FF] hover:bg-[#00C6FF]/30 transition-all cursor-pointer"
              >
                <Plus className="h-3 w-3" />
                <span>Add Slot</span>
              </button>
            </div>

            {/* List of slots with manual time editing */}
            <div className="space-y-3">
              {slots.map((slot, index) => {
                // Check if current time matches one of the standard HOURLY_RANGES
                const cleanSlotTime = (slot.timeLabel || '').replace(/\s+/g, '');
                const isStandardPreset = HOURLY_RANGES.some(
                  (h) => `${h.start}-${h.end}` === cleanSlotTime || `${h.start} - ${h.end}` === slot.timeLabel
                );

                return (
                  <div
                    key={slot.slotId || index}
                    className="rounded-xl border border-white/15 bg-black/20 p-3 flex flex-col gap-2.5 transition-all hover:border-[#00C6FF]/50"
                  >
                    {/* Slot Top Bar: Index, Court Selector, Price & Delete */}
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span className="rounded-md bg-[#00C6FF]/20 px-2 py-0.5 text-[10px] font-black text-[#00C6FF]">
                          Slot {index + 1}
                        </span>

                        {/* Court Selector */}
                        <select
                          value={slot.courtId}
                          onChange={(e) => handleCourtChange(index, e.target.value as CourtId)}
                          className="rounded-lg border border-white/20 bg-[#4A1E94] py-1 px-2 text-xs font-bold text-white focus:border-[#00C6FF] focus:outline-none cursor-pointer"
                        >
                          <option value="court-1">Court 01</option>
                          <option value="court-2">Court 02</option>
                        </select>
                      </div>

                      <div className="flex items-center gap-2">
                        {/* Price for slot */}
                        <div className="flex items-center gap-1 text-xs">
                          <span className="text-[#B3A2DB] text-[10px] font-bold">₱</span>
                          <input
                            type="number"
                            min="0"
                            step="10"
                            value={slot.price}
                            onChange={(e) => handleSlotPriceChange(index, Number(e.target.value) || 0)}
                            className="w-16 rounded-md border border-white/20 bg-white/10 px-1.5 py-0.5 text-xs font-bold text-white text-right focus:border-[#00C6FF] focus:outline-none"
                            title="Slot price in PHP"
                          />
                        </div>

                        {/* Remove Slot */}
                        <button
                          type="button"
                          onClick={() => handleRemoveSlot(index)}
                          className="p-1 rounded-md text-red-400 hover:bg-red-500/20 hover:text-red-300 transition-colors cursor-pointer"
                          title="Remove this court slot"
                          aria-label={`Remove slot ${index + 1}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Time Editing Controls: Preset selector + Manual text editing */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t border-white/10">
                      {/* 1. Quick Hourly Preset */}
                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-[#B3A2DB] mb-1">
                          Quick Hourly Preset
                        </label>
                        <select
                          value={isStandardPreset ? slot.timeLabel : 'CUSTOM'}
                          onChange={(e) => {
                            if (e.target.value !== 'CUSTOM') {
                              handleTimeLabelChange(index, e.target.value);
                              // Also set price if prime
                              const matched = HOURLY_RANGES.find(
                                (h) => `${h.start} - ${h.end}` === e.target.value
                              );
                              if (matched) {
                                handleSlotPriceChange(
                                  index,
                                  matched.isPrime ? BASE_PRICE_PRIME : BASE_PRICE_OFFPEAK
                                );
                              }
                            }
                          }}
                          className="w-full rounded-lg border border-white/20 bg-[#4A1E94] py-1.5 px-2 text-xs font-semibold text-white focus:border-[#00C6FF] focus:outline-none cursor-pointer"
                        >
                          <optgroup label="Standard Court Hours">
                            {HOURLY_RANGES.map((range) => {
                              const label = `${range.start} - ${range.end}`;
                              return (
                                <option key={label} value={label}>
                                  {label} {range.isPrime ? '(Peak ₱200)' : '(Off-Peak ₱150)'}
                                </option>
                              );
                            })}
                          </optgroup>
                          <option value="CUSTOM">Custom / Manual Time...</option>
                        </select>
                      </div>

                      {/* 2. Manual Time Input (Directly editable!) */}
                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-[#00C6FF] mb-1 flex items-center justify-between">
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            <span>Manual Time Label</span>
                          </span>
                          <span className="text-[9px] font-medium text-white/50 lowercase">editable text</span>
                        </label>
                        <div className="relative">
                          <input
                            type="text"
                            required
                            value={slot.timeLabel}
                            onChange={(e) => handleTimeLabelChange(index, e.target.value)}
                            placeholder="e.g. 08:00 - 09:00, 14:30 - 16:00"
                            className="w-full rounded-lg border border-[#00C6FF]/60 bg-white/15 py-1.5 px-2.5 text-xs font-bold text-white placeholder-white/40 focus:border-[#00C6FF] focus:bg-white/20 focus:outline-none"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

              {slots.length === 0 && (
                <div className="rounded-xl border border-dashed border-white/20 p-4 text-center">
                  <p className="text-xs text-[#B3A2DB] mb-2">No slots assigned to this booking.</p>
                  <button
                    type="button"
                    onClick={handleAddSlot}
                    className="inline-flex items-center gap-1.5 rounded-full bg-[#00C6FF] px-4 py-1.5 text-xs font-bold text-black hover:bg-[#00C6FF]/90 cursor-pointer"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Add Court Time Slot</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="mt-5 pt-3 border-t border-white/15 flex items-center justify-end gap-3">
            <button
              type="button"
              disabled={isSaving}
              onClick={onClose}
              className="rounded-full bg-white/10 px-4 py-2 text-xs font-bold text-white hover:bg-white/20 transition-colors cursor-pointer disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#00C6FF] px-5 py-2 text-xs font-black uppercase tracking-wider text-black hover:bg-[#00C6FF]/90 transition-all shadow-md cursor-pointer disabled:opacity-50"
            >
              {isSaving ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  <span>Saving Changes...</span>
                </>
              ) : (
                <>
                  <Save className="h-3.5 w-3.5" />
                  <span>Save Reservation Changes</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
