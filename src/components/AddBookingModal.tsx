import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  User,
  Phone,
  Calendar,
  Clock,
  DollarSign,
  FileText,
  Upload,
  Image as ImageIcon,
  Trash2,
  Plus,
  AlertCircle,
  CheckCircle,
  Calculator,
  CreditCard,
  ShieldCheck,
  RefreshCw,
  Eye,
  Camera
} from 'lucide-react';
import { ConfirmedBooking, SelectedSlot, CourtId, PaymentVerificationStatus } from '../types';
import { HOURLY_RANGES, BASE_PRICE_OFFPEAK, BASE_PRICE_PRIME } from '../data/mockData';
import { buildCanonicalSlotId } from './EditBookingModal';
import { uploadReceiptToFirebaseStorage, compressImageToBase64, fileToDataUrl, validateReceiptFile } from '../services/storageService';
import { saveBookingToFirestore, validateSlotsLiveAvailability } from '../services/bookingService';
import { getTodayDateString, formatDateToFullReadable } from '../utils/dateUtils';

interface AddBookingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (newBooking: ConfirmedBooking) => void;
  persistedBookings: ConfirmedBooking[];
  initialDate?: string;
}

export const AddBookingModal: React.FC<AddBookingModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  persistedBookings,
  initialDate,
}) => {
  const todayStr = getTodayDateString();
  const [fullName, setFullName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [selectedDate, setSelectedDate] = useState(initialDate || todayStr);
  const [paymentMethod, setPaymentMethod] = useState<'InstaPay QR' | 'GCash' | 'Cash (Counter)' | 'Bank Transfer' | 'Walk-in'>('InstaPay QR');
  const [status, setStatus] = useState<PaymentVerificationStatus>('VERIFIED');
  const [notes, setNotes] = useState('');
  const [totalAmount, setTotalAmount] = useState<number>(BASE_PRICE_OFFPEAK);
  const [isCustomTotal, setIsCustomTotal] = useState(false);

  // Slots state
  const [slots, setSlots] = useState<SelectedSlot[]>([
    {
      slotId: 'court-1-0800',
      courtId: 'court-1',
      courtName: 'Court 01',
      timeLabel: '08:00 - 09:00',
      date: initialDate || todayStr,
      price: BASE_PRICE_OFFPEAK,
    },
  ]);

  // Payment image upload state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Synchronize initial date when opened
  useEffect(() => {
    if (isOpen) {
      const activeDate = initialDate || todayStr;
      setSelectedDate(activeDate);
      setFullName('');
      setPhoneNumber('');
      setNotes('');
      setPaymentMethod('InstaPay QR');
      setStatus('VERIFIED');
      setSelectedFile(null);
      setImagePreviewUrl(null);
      setUploadProgress(null);
      setErrorMessage(null);
      setIsCustomTotal(false);
      
      // Default initial slot
      const initialSlot: SelectedSlot = {
        slotId: buildCanonicalSlotId('court-1', '08:00 - 09:00'),
        courtId: 'court-1',
        courtName: 'Court 01',
        timeLabel: '08:00 - 09:00',
        date: activeDate,
        price: BASE_PRICE_OFFPEAK,
      };
      setSlots([initialSlot]);
      setTotalAmount(BASE_PRICE_OFFPEAK);
    }
  }, [isOpen, initialDate, todayStr]);

  // Auto update slot dates when selectedDate changes
  const handleDateChange = (newDate: string) => {
    setSelectedDate(newDate);
    setSlots((prev) =>
      prev.map((s) => ({
        ...s,
        date: newDate,
      }))
    );
  };

  // Recalculate total from slots if not explicitly overridden by admin
  useEffect(() => {
    if (!isCustomTotal) {
      const calculated = slots.reduce((sum, s) => sum + (Number(s.price) || 0), 0);
      setTotalAmount(calculated);
    }
  }, [slots, isCustomTotal]);

  // Slot handlers
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
      const cleanLabel = timeLabel.replace(/\s+/g, '');
      const matched = HOURLY_RANGES.find((h) => `${h.start}-${h.end}` === cleanLabel || `${h.start} - ${h.end}` === timeLabel);
      const price = matched ? (matched.isPrime ? BASE_PRICE_PRIME : BASE_PRICE_OFFPEAK) : updated[index]?.price || BASE_PRICE_OFFPEAK;

      updated[index] = {
        ...updated[index],
        timeLabel,
        price,
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

  const handleAddSlot = () => {
    // Find next available standard hour if possible
    let nextCourt: CourtId = 'court-1';
    let nextTimeLabel = '08:00 - 09:00';
    let nextPrice = BASE_PRICE_OFFPEAK;

    if (slots.length > 0) {
      const lastSlot = slots[slots.length - 1];
      nextCourt = lastSlot.courtId;
      const cleanLast = lastSlot.timeLabel.replace(/\s+/g, '');
      const lastRangeIdx = HOURLY_RANGES.findIndex(
        (h) => `${h.start}-${h.end}` === cleanLast || `${h.start} - ${h.end}` === lastSlot.timeLabel
      );
      if (lastRangeIdx >= 0 && lastRangeIdx + 1 < HOURLY_RANGES.length) {
        const nextRange = HOURLY_RANGES[lastRangeIdx + 1];
        nextTimeLabel = `${nextRange.start} - ${nextRange.end}`;
        nextPrice = nextRange.isPrime ? BASE_PRICE_PRIME : BASE_PRICE_OFFPEAK;
      }
    }

    const newSlot: SelectedSlot = {
      slotId: buildCanonicalSlotId(nextCourt, nextTimeLabel),
      courtId: nextCourt,
      courtName: nextCourt === 'court-2' ? 'Court 02' : 'Court 01',
      timeLabel: nextTimeLabel,
      date: selectedDate,
      price: nextPrice,
    };
    setSlots((prev) => [...prev, newSlot]);
  };

  const handleRemoveSlot = (index: number) => {
    if (slots.length <= 1) {
      setErrorMessage('A booking record requires at least one court schedule slot.');
      return;
    }
    setSlots((prev) => prev.filter((_, idx) => idx !== index));
    setErrorMessage(null);
  };

  // Conflict Detection
  const checkSlotConflict = (slot: SelectedSlot) => {
    const canonicalId = buildCanonicalSlotId(slot.courtId, slot.timeLabel);
    const existing = persistedBookings.find((b) => {
      if (b.selectedDate !== selectedDate) return false;
      return (b.slots || []).some((s) => {
        const otherCanonical = buildCanonicalSlotId(s.courtId, s.timeLabel);
        return otherCanonical === canonicalId || s.slotId === canonicalId;
      });
    });

    if (existing) {
      return {
        hasConflict: true,
        customerName: existing.customer?.fullName || 'Another Player',
        bookingRef: existing.bookingReference,
      };
    }
    return { hasConflict: false };
  };

  // Image File Handling with Strict 5MB and MIME validation
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validation = validateReceiptFile(file);
    if (!validation.isValid) {
      setErrorMessage(validation.error || 'Please select a valid image (JPG, PNG, WEBP) under 5MB.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setSelectedFile(file);
    setErrorMessage(null);

    try {
      const dataUrl = await fileToDataUrl(file);
      setImagePreviewUrl(dataUrl);
    } catch (err) {
      console.warn('Error reading preview Data URL:', err);
    }
  };

  const handleRemoveFile = () => {
    setSelectedFile(null);
    setImagePreviewUrl(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Submit Handler
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const cleanName = fullName.trim();
    const cleanPhone = phoneNumber.trim();

    if (!cleanName) {
      setErrorMessage('Player full name is required.');
      return;
    }

    if (!cleanPhone) {
      setErrorMessage('Contact phone number is required.');
      return;
    }

    if (!selectedDate) {
      setErrorMessage('Reservation date is required.');
      return;
    }

    if (slots.length === 0) {
      setErrorMessage('Please add at least one court schedule slot.');
      return;
    }

    // Ensure all slots have valid non-empty times
    for (let i = 0; i < slots.length; i++) {
      if (!slots[i].timeLabel.trim()) {
        setErrorMessage(`Please enter a valid time for Slot ${i + 1}.`);
        return;
      }
    }

    try {
      setIsUploading(true);

      // 1. Generate unique booking reference code
      const bookingRef = `MS-${Math.floor(100000 + Math.random() * 900000)}`;

      // 2. Handle Payment Proof Upload (if file attached)
      let finalProofUrl = '';
      if (selectedFile) {
        try {
          setUploadProgress(15);
          const uploadRes = await uploadReceiptToFirebaseStorage(
            selectedFile,
            bookingRef,
            (pct) => setUploadProgress(Math.round(pct))
          );
          finalProofUrl = uploadRes.downloadUrl;
        } catch (storageErr) {
          console.warn('Direct Firebase Storage upload encountered issue, applying compressed Base64 fallback:', storageErr);
          const compressed = await compressImageToBase64(selectedFile);
          finalProofUrl = compressed;
        }
      }

      // 3. Prepare normalized slots
      const normalizedSlots: SelectedSlot[] = slots.map((s) => {
        const courtId = s.courtId || 'court-1';
        const courtName = courtId === 'court-2' ? 'Court 02' : 'Court 01';
        const timeLabel = s.timeLabel.trim();
        const slotId = buildCanonicalSlotId(courtId, timeLabel);
        return {
          slotId,
          courtId,
          courtName,
          timeLabel,
          date: selectedDate.trim(),
          price: Number(s.price) || 0,
        };
      });

      // 4. Construct ConfirmedBooking object
      const nowIso = new Date().toISOString();
      const newBookingRecord: ConfirmedBooking = {
        bookingReference: bookingRef,
        selectedDate: selectedDate.trim(),
        paymentMethod,
        customer: {
          fullName: cleanName,
          phoneNumber: cleanPhone.startsWith('+63') ? cleanPhone : cleanPhone.startsWith('09') ? `+63 ${cleanPhone.slice(1)}` : cleanPhone,
          email: `${cleanName.toLowerCase().replace(/[^a-z0-9]/g, '')}@matchsip.local`,
          notes: notes.trim(),
        },
        slots: normalizedSlots,
        totalAmount: Number(totalAmount) || 0,
        paymentProofUrl: finalProofUrl,
        status,
        confirmedAt: nowIso,
        createdAt: nowIso,
        bookedAt: nowIso,
      };

      // 5. Pre-save Live Validation: verify slots are not already reserved
      const availabilityCheck = await validateSlotsLiveAvailability(normalizedSlots, selectedDate.trim());
      if (!availabilityCheck.isAvailable) {
        setErrorMessage(
          availabilityCheck.conflictReason ||
          'One or more of the selected slots is already booked. Please pick open slots.'
        );
        setIsUploading(false);
        return;
      }

      // 6. Persist to Cloud Firestore via atomic transaction
      await saveBookingToFirestore(newBookingRecord);

      onSuccess(newBookingRecord);
      onClose();
    } catch (err: any) {
      console.error('Failed to create manual booking record:', err);
      setErrorMessage(err?.message || 'Failed to save booking record. Please check your connection.');
    } finally {
      setIsUploading(false);
      setUploadProgress(null);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-4 backdrop-blur-sm animate-in fade-in"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-booking-title"
        onClick={(e) => {
          if (e.target === e.currentTarget && !isUploading) {
            onClose();
          }
        }}
      >
        <div className="relative w-full max-w-2xl rounded-[2rem] border-2 border-[#00C6FF]/40 bg-[#5E2CB2] p-5 sm:p-7 text-white shadow-2xl overflow-hidden max-h-[94vh] flex flex-col">
          
          {/* Header */}
          <div className="flex items-center justify-between border-b border-white/15 pb-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-2xl bg-[#00C6FF]/20 border border-[#00C6FF]/50 flex items-center justify-center text-[#00C6FF]">
                <Plus className="h-5 w-5 stroke-[2.5]" />
              </div>
              <div>
                <span className="text-[10px] font-black uppercase tracking-widest text-[#00C6FF] block">
                  Admin Manual Entry
                </span>
                <h3 id="add-booking-title" className="font-heading text-lg sm:text-xl font-black uppercase tracking-tight text-white">
                  Add A Booking Record
                </h3>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              disabled={isUploading}
              className="rounded-full p-2 text-white/70 hover:bg-white/15 hover:text-white transition-colors cursor-pointer disabled:opacity-50"
              aria-label="Close modal"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Error Banner */}
          {errorMessage && (
            <div className="mt-4 flex items-center gap-2 rounded-xl border border-red-400/50 bg-red-500/20 px-4 py-2.5 text-xs font-semibold text-red-200 animate-in fade-in">
              <AlertCircle className="h-4 w-4 shrink-0 text-red-300" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Form Content */}
          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto pr-1 py-4 space-y-5 custom-scrollbar">
            
            {/* 1. Date Selection & Fast Pickers */}
            <div className="rounded-2xl border border-white/15 bg-white/5 p-4 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <label className="text-xs font-bold uppercase tracking-wider text-[#00C6FF] flex items-center gap-1.5">
                  <Calendar className="h-4 w-4" />
                  <span>1. Schedule Date</span>
                </label>

                {/* Quick Date Chips */}
                <div className="flex items-center gap-1.5 text-xs">
                  <button
                    type="button"
                    onClick={() => handleDateChange(todayStr)}
                    className={`rounded-lg px-2.5 py-1 text-[11px] font-bold transition-all cursor-pointer ${
                      selectedDate === todayStr
                        ? 'bg-[#00C6FF] text-black shadow-sm'
                        : 'bg-white/10 text-white hover:bg-white/20'
                    }`}
                  >
                    Today
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      const tomorrow = new Date();
                      tomorrow.setDate(tomorrow.getDate() + 1);
                      const tStr = tomorrow.toISOString().slice(0, 10);
                      handleDateChange(tStr);
                    }}
                    className="rounded-lg bg-white/10 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-white/20 transition-all cursor-pointer"
                  >
                    Tomorrow
                  </button>
                </div>
              </div>

              <div className="relative">
                <input
                  type="date"
                  required
                  value={selectedDate}
                  onChange={(e) => handleDateChange(e.target.value)}
                  className="w-full rounded-xl border border-[#B3A2DB]/40 bg-white/10 py-2.5 px-3.5 text-xs sm:text-sm font-semibold text-white focus:border-[#00C6FF] focus:bg-white/15 focus:outline-none cursor-pointer"
                />
              </div>

              <p className="text-[11px] text-[#B3A2DB] flex items-center gap-1">
                <span>Selected:</span>
                <strong className="text-white">{formatDateToFullReadable(selectedDate)}</strong>
              </p>
            </div>

            {/* 2. Court Slots & Times */}
            <div className="rounded-2xl border border-white/15 bg-white/5 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-[#00C6FF] flex items-center gap-1.5">
                    <Clock className="h-4 w-4" />
                    <span>2. Court &amp; Time Slots ({slots.length})</span>
                  </label>
                  <p className="text-[11px] text-[#B3A2DB]">
                    Add one or multiple hours for this reservation.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleAddSlot}
                  className="inline-flex items-center gap-1.5 rounded-full bg-[#00C6FF]/20 border border-[#00C6FF]/50 px-3 py-1.5 text-xs font-bold text-[#00C6FF] hover:bg-[#00C6FF]/30 transition-all cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Add Another Hour</span>
                </button>
              </div>

              {/* Slots List */}
              <div className="space-y-3 pt-1">
                {slots.map((slot, index) => {
                  const conflict = checkSlotConflict(slot);
                  const cleanSlotTime = (slot.timeLabel || '').replace(/\s+/g, '');
                  const isStandardPreset = HOURLY_RANGES.some(
                    (h) => `${h.start}-${h.end}` === cleanSlotTime || `${h.start} - ${h.end}` === slot.timeLabel
                  );

                  return (
                    <div
                      key={index}
                      className={`rounded-xl border p-3 flex flex-col gap-2.5 transition-all ${
                        conflict.hasConflict
                          ? 'border-amber-400/80 bg-amber-950/30'
                          : 'border-white/15 bg-black/25 hover:border-[#00C6FF]/40'
                      }`}
                    >
                      {/* Slot Header: Index, Court & Price */}
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2">
                          <span className="rounded-md bg-[#00C6FF]/20 px-2 py-0.5 text-[10px] font-black text-[#00C6FF]">
                            Slot {index + 1}
                          </span>

                          {/* Court Select */}
                          <select
                            value={slot.courtId}
                            onChange={(e) => handleCourtChange(index, e.target.value as CourtId)}
                            className="rounded-lg border border-white/20 bg-[#4A1E94] py-1 px-2.5 text-xs font-bold text-white focus:border-[#00C6FF] focus:outline-none cursor-pointer"
                          >
                            <option value="court-1">Court 01</option>
                            <option value="court-2">Court 02</option>
                          </select>
                        </div>

                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-1 text-xs">
                            <span className="text-[#B3A2DB] text-[11px] font-bold">₱</span>
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

                          {slots.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleRemoveSlot(index)}
                              className="p-1 rounded-md text-red-400 hover:bg-red-500/20 hover:text-red-300 transition-colors cursor-pointer"
                              title="Remove slot"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Time Controls: Preset & Manual edit */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t border-white/10">
                        <div>
                          <label className="block text-[10px] font-bold uppercase tracking-wider text-[#B3A2DB] mb-1">
                            Hourly Preset
                          </label>
                          <select
                            value={isStandardPreset ? slot.timeLabel : 'CUSTOM'}
                            onChange={(e) => {
                              if (e.target.value !== 'CUSTOM') {
                                handleTimeLabelChange(index, e.target.value);
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

                        <div>
                          <label className="block text-[10px] font-bold uppercase tracking-wider text-[#00C6FF] mb-1">
                            Time Label
                          </label>
                          <input
                            type="text"
                            required
                            value={slot.timeLabel}
                            onChange={(e) => handleTimeLabelChange(index, e.target.value)}
                            placeholder="08:00 - 09:00"
                            className="w-full rounded-lg border border-[#00C6FF]/60 bg-white/15 py-1.5 px-2.5 text-xs font-bold text-white placeholder-white/40 focus:border-[#00C6FF] focus:bg-white/20 focus:outline-none"
                          />
                        </div>
                      </div>

                      {/* Conflict Warning Badge */}
                      {conflict.hasConflict && (
                        <div className="flex items-center gap-1.5 rounded-lg bg-amber-500/20 border border-amber-400/40 p-2 text-[11px] text-amber-200">
                          <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-300" />
                          <span>
                            <strong>Notice:</strong> Already booked by {conflict.customerName} (#{conflict.bookingRef}). Overriding will claim this slot for this record.
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 3. Player Information (Name & Phone) */}
            <div className="rounded-2xl border border-white/15 bg-white/5 p-4 space-y-3">
              <label className="text-xs font-bold uppercase tracking-wider text-[#00C6FF] flex items-center gap-1.5">
                <User className="h-4 w-4" />
                <span>3. Player Particulars</span>
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Full Name */}
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-[#B3A2DB] mb-1">
                    Player Full Name <span className="text-red-400">*</span>
                  </label>
                  <div className="relative">
                    <User className="absolute left-3.5 top-2.5 h-4 w-4 text-[#B3A2DB]" />
                    <input
                      type="text"
                      required
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="e.g. Juan Dela Cruz"
                      className="w-full rounded-xl border border-[#B3A2DB]/40 bg-white/10 py-2 pl-10 pr-3 text-xs sm:text-sm font-semibold text-white placeholder-white/40 focus:border-[#00C6FF] focus:bg-white/15 focus:outline-none"
                    />
                  </div>
                </div>

                {/* Phone Number */}
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-[#B3A2DB] mb-1">
                    Phone / Contact Number <span className="text-red-400">*</span>
                  </label>
                  <div className="relative">
                    <Phone className="absolute left-3.5 top-2.5 h-4 w-4 text-[#B3A2DB]" />
                    <input
                      type="tel"
                      required
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value)}
                      placeholder="e.g. 0917 123 4567"
                      className="w-full rounded-xl border border-[#B3A2DB]/40 bg-white/10 py-2 pl-10 pr-3 text-xs sm:text-sm font-semibold text-white placeholder-white/40 focus:border-[#00C6FF] focus:bg-white/15 focus:outline-none"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* 4. Payment Receipt Upload & Payment Details */}
            <div className="rounded-2xl border border-white/15 bg-white/5 p-4 space-y-4">
              <label className="text-xs font-bold uppercase tracking-wider text-[#00C6FF] flex items-center gap-1.5">
                <CreditCard className="h-4 w-4" />
                <span>4. Payment &amp; Receipt Upload</span>
              </label>

              {/* Upload Image Section */}
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-[#B3A2DB] mb-1.5">
                  Payment Receipt Image / Screenshot
                </label>

                <input
                  type="file"
                  ref={fileInputRef}
                  accept="image/png,image/jpeg,image/jpg,image/webp"
                  onChange={handleFileSelect}
                  className="hidden"
                  id="admin-receipt-upload-input"
                />

                {!imagePreviewUrl ? (
                  <label
                    htmlFor="admin-receipt-upload-input"
                    className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-[#00C6FF]/40 bg-white/[0.04] p-5 text-center transition-all hover:border-[#00C6FF] hover:bg-white/[0.08] cursor-pointer group"
                  >
                    <div className="h-12 w-12 rounded-full bg-[#00C6FF]/15 border border-[#00C6FF]/30 flex items-center justify-center text-[#00C6FF] mb-2 group-hover:scale-110 transition-transform">
                      <Upload className="h-6 w-6" />
                    </div>
                    <span className="text-xs sm:text-sm font-bold text-white block">
                      Click to Browse or Upload Payment Receipt
                    </span>
                    <span className="text-[11px] text-[#B3A2DB] mt-0.5">
                      JPG, PNG, or WEBP screenshot from GCash, InstaPay, or bank transfer (Max 5MB)
                    </span>
                  </label>
                ) : (
                  <div className="relative rounded-2xl border-2 border-[#00C6FF]/60 bg-black/40 p-3 flex items-center justify-between gap-3 overflow-hidden">
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        onClick={() => setIsPreviewModalOpen(true)}
                        className="relative h-16 w-16 shrink-0 rounded-xl overflow-hidden border border-white/20 bg-black cursor-pointer group"
                        title="Click to zoom preview"
                      >
                        <img
                          src={imagePreviewUrl}
                          alt="Payment Receipt Preview"
                          className="h-full w-full object-cover transition-transform group-hover:scale-110"
                        />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                          <Eye className="h-4 w-4 text-white" />
                        </div>
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full bg-[#00C6FF] animate-pulse" />
                          <span className="text-xs font-bold text-white truncate block">
                            {selectedFile?.name || 'Attached Receipt Screenshot'}
                          </span>
                        </div>
                        <span className="text-[10px] text-[#00C6FF] font-medium block">
                          {selectedFile ? `${(selectedFile.size / 1024).toFixed(1)} KB • Ready to upload` : 'Receipt attached'}
                        </span>
                        <button
                          type="button"
                          onClick={() => setIsPreviewModalOpen(true)}
                          className="text-[11px] text-[#B3A2DB] underline hover:text-white mt-0.5 cursor-pointer"
                        >
                          View Full Preview
                        </button>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleRemoveFile}
                      className="p-2 rounded-xl bg-red-500/20 text-red-300 hover:bg-red-500/30 hover:text-red-200 transition-colors cursor-pointer shrink-0"
                      title="Remove receipt"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>

              {/* Payment Method, Status & Total Amount Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                {/* Payment Method */}
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-[#B3A2DB] mb-1">
                    Payment Method
                  </label>
                  <select
                    value={paymentMethod}
                    onChange={(e: any) => setPaymentMethod(e.target.value)}
                    className="w-full rounded-xl border border-white/20 bg-[#4A1E94] py-2 px-2.5 text-xs font-bold text-white focus:border-[#00C6FF] focus:outline-none cursor-pointer"
                  >
                    <option value="InstaPay QR">InstaPay QR</option>
                    <option value="GCash">GCash</option>
                    <option value="Cash (Counter)">Cash (Counter)</option>
                    <option value="Bank Transfer">Bank Transfer</option>
                    <option value="Walk-in">Walk-in Player</option>
                  </select>
                </div>

                {/* Status */}
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-[#B3A2DB] mb-1">
                    Booking Status
                  </label>
                  <select
                    value={status}
                    onChange={(e: any) => setStatus(e.target.value)}
                    className="w-full rounded-xl border border-white/20 bg-[#4A1E94] py-2 px-2.5 text-xs font-bold text-white focus:border-[#00C6FF] focus:outline-none cursor-pointer"
                  >
                    <option value="VERIFIED">VERIFIED (Confirmed)</option>
                    <option value="CONFIRMED">CONFIRMED</option>
                    <option value="BOOKED">BOOKED</option>
                    <option value="PENDING">PENDING</option>
                  </select>
                </div>

                {/* Total Amount (PHP) */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-[#B3A2DB]">
                      Total (PHP ₱)
                    </label>
                    {isCustomTotal && (
                      <button
                        type="button"
                        onClick={() => {
                          setIsCustomTotal(false);
                          const calculated = slots.reduce((sum, s) => sum + (Number(s.price) || 0), 0);
                          setTotalAmount(calculated);
                        }}
                        className="text-[9px] font-bold text-[#00C6FF] hover:underline cursor-pointer flex items-center gap-0.5"
                      >
                        <RefreshCw className="h-2.5 w-2.5" />
                        <span>Auto</span>
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-[#00C6FF]">
                      ₱
                    </span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      required
                      value={totalAmount}
                      onChange={(e) => {
                        setIsCustomTotal(true);
                        setTotalAmount(Number(e.target.value) || 0);
                      }}
                      className="w-full rounded-xl border border-[#B3A2DB]/40 bg-white/10 py-2 pl-7 pr-3 text-xs sm:text-sm font-bold text-white focus:border-[#00C6FF] focus:bg-white/15 focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* Notes / Special Remarks */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-[#B3A2DB] mb-1">
                  Admin Notes / Remarks (Optional)
                </label>
                <div className="relative">
                  <FileText className="absolute left-3.5 top-2.5 h-4 w-4 text-[#B3A2DB]" />
                  <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="e.g. Paid cash at counter, tournament match, VIP guest..."
                    className="w-full rounded-xl border border-[#B3A2DB]/40 bg-white/10 py-2 pl-10 pr-3 text-xs sm:text-sm font-medium text-white placeholder-white/40 focus:border-[#00C6FF] focus:bg-white/15 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Upload Progress Bar if active */}
            {isUploading && (
              <div className="rounded-xl border border-[#00C6FF]/40 bg-[#1A0B2E] p-3 text-xs">
                <div className="flex items-center justify-between mb-1.5 font-bold">
                  <span className="text-[#00C6FF] flex items-center gap-1.5">
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    <span>Saving reservation &amp; uploading receipt proof...</span>
                  </span>
                  <span className="text-white">{uploadProgress !== null ? `${uploadProgress}%` : 'Processing'}</span>
                </div>
                <div className="w-full bg-white/10 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-[#00C6FF] h-2 rounded-full transition-all duration-300"
                    style={{ width: `${uploadProgress !== null ? uploadProgress : 60}%` }}
                  />
                </div>
              </div>
            )}

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-white/15">
              <button
                type="button"
                onClick={onClose}
                disabled={isUploading}
                className="rounded-full bg-white/10 px-5 py-2.5 text-xs font-bold text-white hover:bg-white/20 transition-colors cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>

              <button
                type="submit"
                disabled={isUploading}
                className="inline-flex items-center gap-2 rounded-full bg-[#00C6FF] px-7 py-2.5 text-xs font-black uppercase tracking-wider text-black shadow-lg shadow-[#00C6FF]/30 hover:bg-[#00C6FF]/90 hover:scale-[1.02] active:scale-98 transition-all cursor-pointer disabled:opacity-50"
              >
                {isUploading ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    <span>Saving Record...</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="h-4 w-4" />
                    <span>Save Booking Record</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Enlarged Receipt Preview Modal */}
      {isPreviewModalOpen && imagePreviewUrl && (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center bg-black/90 p-4 backdrop-blur-md animate-in fade-in"
          onClick={() => setIsPreviewModalOpen(false)}
        >
          <div
            className="relative max-w-lg max-h-[85vh] rounded-3xl overflow-hidden border-2 border-[#00C6FF]/50 bg-[#1A0B2E] p-3 text-white shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-white/15">
              <span className="text-xs font-bold uppercase tracking-wider text-[#00C6FF]">
                Payment Receipt Preview
              </span>
              <button
                type="button"
                onClick={() => setIsPreviewModalOpen(false)}
                className="p-1 rounded-full text-white/70 hover:bg-white/20 hover:text-white transition-colors cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-auto flex items-center justify-center bg-black/60 rounded-xl p-2">
              <img
                src={imagePreviewUrl}
                alt="Receipt Full Preview"
                className="max-h-[70vh] w-auto object-contain rounded-lg shadow-lg"
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
};
