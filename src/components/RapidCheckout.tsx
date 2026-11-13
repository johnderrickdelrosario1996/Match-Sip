import React, { useState, useEffect, useRef } from 'react';
import { 
  Upload, 
  CheckCircle2, 
  AlertCircle, 
  ShieldCheck, 
  Trash2, 
  X, 
  Maximize2, 
  Download,
  Cloud,
  Loader2,
  RefreshCw,
  ChevronDown,
  Clock
} from 'lucide-react';
import { SelectedSlot, ConfirmedBooking } from '../types';
import qrCodeImg from '../assets/images/INSTAPAY QR CODE.jpg';
import paddleUpImg from '../assets/images/Paddleup.jpg';
import { uploadReceiptToFirebaseStorage, compressImageToBase64, validateReceiptFile } from '../services/storageService';
import { validateSlotsLiveAvailability, holdSlotsLive, releaseSlotsHoldLive } from '../services/bookingService';
import { getTodayDateString } from '../utils/dateUtils';

interface RapidCheckoutProps {
  selectedDate: string;
  selectedSlots: SelectedSlot[];
  onBookingComplete: (booking: ConfirmedBooking) => Promise<void> | void;
  onNavigateToMatrix: () => void;
}

const COURT_SAFETY_RULES = [
  { num: '01', text: 'Warm up and stretch before playing.' },
  { num: '02', text: 'Wear appropriate sports attire and non-marking court shoes.' },
  { num: '03', text: 'Inspect the playing area before starting; report wet surfaces, loose nets, or hazards immediately.' },
  { num: '04', text: 'Stay aware of your surroundings (partner, opponents, equipment, court boundaries).' },
  { num: '05', text: 'Avoid reckless play; do not intentionally hit the ball toward another person at close range.' },
  { num: '06', text: 'Do not enter another court while a rally is in progress.' },
  { num: '07', text: 'Retrieve loose balls carefully and signal before entering another court.' },
  { num: '08', text: 'Use equipment properly (no swinging paddles dangerously, throwing equipment, or climbing on nets).' },
  { num: '09', text: 'Stop playing immediately if you feel unwell, dizzy, experience chest pain, or have trouble breathing.' },
  { num: '10', text: 'Know your physical limits and assess your condition safely.' },
  { num: '11', text: 'Keep personal items (bags, bottles, paddles) in designated areas outside the court boundaries.' },
  { num: '12', text: 'Report all accidents and hazards immediately to court staff.' },
  { num: '13', text: 'No smoking / vaping: Smoking, vaping, or using e-cigarettes is strictly prohibited anywhere within the court premises.' },
  { num: '14', text: 'No food and drinks shall be allowed inside the court area.' },
  { num: '15', text: 'Kindly park at the designated parking area at the back of the court, it is discouraged to park in front of the shop' },
  { num: '16', text: 'Use the side entrance to enter Match & Sip.'},
];

export const RapidCheckout: React.FC<RapidCheckoutProps> = ({
  selectedDate,
  selectedSlots,
  onBookingComplete,
  onNavigateToMatrix,
}) => {
  // Restore draft inputs from sessionStorage (with fallback to localStorage)
  const [fullName, setFullName] = useState<string>(() => {
    try {
      const raw = sessionStorage.getItem('matchsip_checkout_draft') || localStorage.getItem('matchsip_checkout_draft');
      if (raw) {
        const parsed = JSON.parse(raw);
        return parsed.fullName || '';
      }
    } catch {}
    return '';
  });

  const [phoneNumber, setPhoneNumber] = useState<string>(() => {
    try {
      const raw = sessionStorage.getItem('matchsip_checkout_draft') || localStorage.getItem('matchsip_checkout_draft');
      if (raw) {
        const parsed = JSON.parse(raw);
        return parsed.phoneNumber || '';
      }
    } catch {}
    return '';
  });

  const [safetyAgreed, setSafetyAgreed] = useState<boolean>(() => {
    try {
      const raw = sessionStorage.getItem('matchsip_checkout_draft') || localStorage.getItem('matchsip_checkout_draft');
      if (raw) {
        const parsed = JSON.parse(raw);
        return Boolean(parsed.safetyAgreed);
      }
    } catch {}
    return false;
  });
  const [showSafetyModal, setShowSafetyModal] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);
  const [showReceiptPreviewModal, setShowReceiptPreviewModal] = useState(false);

  // Safety reminders scroll verification state
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);
  const rulesContainerRef = useRef<HTMLDivElement>(null);

  // Reset or detect scroll state when safety modal opens
  useEffect(() => {
    if (showSafetyModal) {
      if (safetyAgreed) {
        setHasScrolledToBottom(true);
      } else {
        setHasScrolledToBottom(false);
        // Automatically unlock if modal content fits without scrollbar on tall viewports
        const timer = setTimeout(() => {
          const el = rulesContainerRef.current;
          if (el) {
            const hasOverflow = el.scrollHeight > el.clientHeight + 15;
            if (!hasOverflow) {
              setHasScrolledToBottom(true);
            }
          }
        }, 150);
        return () => clearTimeout(timer);
      }
    }
  }, [showSafetyModal, safetyAgreed]);

  const handleRulesScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (hasScrolledToBottom) return;
    const target = e.currentTarget;
    // When within 24px of the bottom, unlock the agreement button
    const isAtBottom = target.scrollTop + target.clientHeight >= target.scrollHeight - 24;
    if (isAtBottom) {
      setHasScrolledToBottom(true);
    }
  };

  // Sync draft inputs to sessionStorage and localStorage for graceful refresh preservation
  useEffect(() => {
    try {
      const payload = JSON.stringify({ fullName, phoneNumber, safetyAgreed });
      sessionStorage.setItem('matchsip_checkout_draft', payload);
      localStorage.setItem('matchsip_checkout_draft', payload);
    } catch {}
  }, [fullName, phoneNumber, safetyAgreed]);

  const generateBookingReference = () => `MS-${Math.floor(100000 + Math.random() * 900000)}`;

  // Stable booking reference for this checkout session and 5-minute TTL slot hold (Mechanism 3)
  const [draftBookingRef, setDraftBookingRef] = useState<string>(() => {
    try {
      const stored = sessionStorage.getItem('matchsip_draft_ref');
      if (stored) return stored;
    } catch {}
    const newRef = generateBookingReference();
    try {
      sessionStorage.setItem('matchsip_draft_ref', newRef);
    } catch {}
    return newRef;
  });

  const fullNameRef = useRef(fullName);
  useEffect(() => {
    fullNameRef.current = fullName;
  }, [fullName]);

  const [holdExpiresAt, setHoldExpiresAt] = useState<number | null>(null);
  const [holdRemainingSeconds, setHoldRemainingSeconds] = useState<number>(300);
  const [isSlotHeld, setIsSlotHeld] = useState<boolean>(false);
  const [holdExtendedNotice, setHoldExtendedNotice] = useState<string | null>(null);

  // Renew or acquire slot hold with forgiving 5-minute TTL
  const renewHold = React.useCallback(
    async (seconds = 300, showNotice = false) => {
      if (selectedSlots.length === 0) {
        setIsSlotHeld(false);
        setHoldExpiresAt(null);
        return { success: false };
      }

      try {
        const res = await holdSlotsLive(draftBookingRef, selectedDate, selectedSlots, fullNameRef.current, seconds);
        if (res.success) {
          setIsSlotHeld(true);
          const expires = Date.now() + seconds * 1000;
          setHoldExpiresAt(expires);
          setHoldRemainingSeconds(seconds);
          setErrorMessage(null);
          if (showNotice) {
            setHoldExtendedNotice('+5m hold extended');
            setTimeout(() => setHoldExtendedNotice(null), 3500);
          }
          return { success: true };
        } else if (res.conflictReason) {
          setIsSlotHeld(false);
          setErrorMessage(res.conflictReason);
          return { success: false, conflictReason: res.conflictReason };
        }
      } catch (err) {
        // Non-blocking
      }
      return { success: true };
    },
    [draftBookingRef, selectedDate, selectedSlots]
  );

  // Automatically acquire 5-minute temporary slot hold when entering checkout with selected slots
  useEffect(() => {
    if (selectedSlots.length === 0) {
      setIsSlotHeld(false);
      setHoldExpiresAt(null);
      return;
    }

    let isMounted = true;
    renewHold(300).then((res) => {
      if (!isMounted) return;
      if (res && !res.success && res.conflictReason) {
        setErrorMessage(res.conflictReason);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [selectedSlots, selectedDate, renewHold]);

  // Countdown timer for TTL hold
  useEffect(() => {
    if (!holdExpiresAt) return;
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.round((holdExpiresAt - Date.now()) / 1000));
      setHoldRemainingSeconds(remaining);
      if (remaining === 0) {
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [holdExpiresAt]);

  // Payment receipt states
  const [proofImage, setProofImage] = useState<string | null>(null);
  const [proofFileName, setProofFileName] = useState<string | null>(null);
  const [storageDownloadUrl, setStorageDownloadUrl] = useState<string | null>(null);
  const [currentFile, setCurrentFile] = useState<File | null>(null);
  const [isUploadingProof, setIsUploadingProof] = useState(false);
  const [isFallbackBase64, setIsFallbackBase64] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isNetworkFailure, setIsNetworkFailure] = useState(false);

  // Listen to network online recovery
  useEffect(() => {
    const handleOnline = () => {
      setIsNetworkFailure(false);
      if (errorMessage && errorMessage.includes('offline')) {
        setErrorMessage(null);
      }
    };
    const handleOffline = () => {
      setIsNetworkFailure(true);
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [errorMessage]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const totalPrice = selectedSlots.reduce((acc, curr) => acc + curr.price, 0);
  const reservationDate = selectedSlots.length > 0 ? selectedSlots[0].date : selectedDate;

  // Validation flags for requiring fields before booking is clickable
  const isNameFilled = fullName.trim().length > 0;
  const isPhoneFilled = phoneNumber.trim().replace(/\D/g, '').length === 10;
  const isProofUploaded = Boolean((proofImage || storageDownloadUrl) && !isUploadingProof);
  const isFormValid = Boolean(
    selectedSlots.length > 0 &&
    isNameFilled &&
    isPhoneFilled &&
    isProofUploaded &&
    safetyAgreed &&
    !isSubmitting
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  /**
   * Upload the selected photo file using optimized client compression and reliable server-backed storage.
   * If any network error or stall occurs, automatically falls back to an optimized compressed
   * Base64 string and attaches it to the reservation state.
   */
  const uploadFileToStorage = async (file: File) => {
    setIsUploadingProof(true);
    setUploadProgress(0);
    setUploadError(null);
    setIsFallbackBase64(false);

    try {
      const tempRef = `MS-${Math.floor(100000 + Math.random() * 900000)}`;
      const result = await uploadReceiptToFirebaseStorage(file, tempRef, (percent) => {
        setUploadProgress(percent);
      });

      // Successfully processed and uploaded receipt
      setStorageDownloadUrl(result.downloadUrl);
      setProofImage(result.downloadUrl);
      setIsUploadingProof(false);
      setIsFallbackBase64(false);
      setUploadError(null);
      setErrorMessage(null);
    } catch (err: any) {
      console.warn('Receipt processing note, checking fallback:', err?.message);

      try {
        // Automatically compress image into optimized Base64 and attach to reservation state
        const compressedBase64 = await compressImageToBase64(file);
        setStorageDownloadUrl(compressedBase64);
        setProofImage(compressedBase64);
        setIsFallbackBase64(true);
        setIsUploadingProof(false);
        setUploadError(null);
        setErrorMessage(null);
      } catch (fallbackErr: any) {
        setIsUploadingProof(false);
        const friendlyMessage =
          fallbackErr?.message || err?.message || 'Unable to process receipt image. Please choose another screenshot.';
        setUploadError(friendlyMessage);
        setErrorMessage(friendlyMessage);
      }
    }
  };

  const processFile = (file: File) => {
    const validation = validateReceiptFile(file);
    if (!validation.isValid) {
      const errorMsg =
        validation.error || 'Please upload a valid JPG, PNG, or WebP screenshot.';
      setErrorMessage(errorMsg);
      setUploadError(errorMsg);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      return;
    }

    setCurrentFile(file);
    setProofFileName(file.name);
    setErrorMessage(null);
    setUploadError(null);

    // Create instant local thumbnail for responsive UX while uploading
    const reader = new FileReader();
    reader.onload = (e) => {
      setProofImage(e.target?.result as string);
    };
    reader.readAsDataURL(file);

    // Auto-extend slot hold so user has plenty of time while file uploads
    renewHold(300, true);

    // Process and attach payment proof
    uploadFileToStorage(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const removeProof = () => {
    setProofImage(null);
    setProofFileName(null);
    setStorageDownloadUrl(null);
    setCurrentFile(null);
    setIsUploadingProof(false);
    setIsFallbackBase64(false);
    setUploadProgress(0);
    setUploadError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (selectedSlots.length === 0) {
      setErrorMessage('Please select at least one court slot in the matrix above.');
      onNavigateToMatrix();
      return;
    }

    if (!fullName.trim()) {
      setErrorMessage('Please enter your full name.');
      return;
    }

    if (!phoneNumber.trim() || phoneNumber.trim().replace(/\D/g, '').length !== 10) {
      setErrorMessage('Please enter a valid 10-digit mobile number (e.g. 9XX XXX XXXX).');
      return;
    }

    if (isUploadingProof) {
      setErrorMessage('Please wait a moment for your receipt to finish processing...');
      return;
    }

    if (!storageDownloadUrl && !proofImage) {
      setErrorMessage('Please upload your InstaPay payment screenshot proof.');
      return;
    }

    if (!safetyAgreed) {
      setErrorMessage('Please agree to the Pickleball Court Safety Reminders.');
      return;
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setIsNetworkFailure(true);
      setErrorMessage(
        'You appear to be offline. Your selected slots and form details are safely saved on this device. Tap "Retry Reservation" once your network reconnects.'
      );
      setIsSubmitting(false);
      return;
    }

    setIsSubmitting(true);

    try {
      // 0. Ensure user's slot hold is active right before validation
      await renewHold(300);

      // 1. Live concurrency guard: verify slots have not been claimed by another player while in checkout
      // CRITICAL: Pass draftBookingRef so the current session's own active hold is NOT flagged as a conflict!
      const availabilityCheck = await validateSlotsLiveAvailability(selectedSlots, reservationDate, draftBookingRef);
      if (!availabilityCheck.isAvailable) {
        setErrorMessage(
          availabilityCheck.conflictReason ||
          'One or more of your selected court slots was just reserved by another player. Please choose an open slot.'
        );
        setIsSubmitting(false);
        return;
      }

      // Ensure we have the payment proof URL (Storage download URL or verified compressed Base64)
      let finalProofUrl = storageDownloadUrl || proofImage;
      if (!finalProofUrl && currentFile) {
        try {
          const uploadResult = await uploadReceiptToFirebaseStorage(currentFile);
          finalProofUrl = uploadResult.downloadUrl;
          setStorageDownloadUrl(finalProofUrl);
        } catch (uploadErr) {
          console.warn('Firebase Storage upload failed on submit, converting to compressed Base64 fallback:', uploadErr);
          const compressed = await compressImageToBase64(currentFile);
          finalProofUrl = compressed;
          setProofImage(compressed);
          setStorageDownloadUrl(compressed);
          setIsFallbackBase64(true);
        }
      }

      if (!finalProofUrl) {
        throw new Error('Payment receipt screenshot proof is required.');
      }

      const bookingRef = draftBookingRef || `MS-${Math.floor(100000 + Math.random() * 900000)}`;
      const nowIso = new Date().toISOString();
      const newBooking: ConfirmedBooking = {
        bookingReference: bookingRef,
        selectedDate: reservationDate,
        paymentMethod: 'InstaPay QR',
        customer: {
          fullName: fullName.trim(),
          phoneNumber: `+63 ${phoneNumber.trim()}`,
          email: `${fullName.toLowerCase().replace(/\s+/g, '')}@example.com`,
        },
        slots: selectedSlots,
        totalAmount: totalPrice,
        paymentProofUrl: finalProofUrl,
        confirmedAt: nowIso,
        createdAt: nowIso,
        bookedAt: nowIso,
        paidAt: nowIso,
        status: 'VERIFIED',
      };

      await onBookingComplete(newBooking);

      // Reset form, rotate booking reference for next reservation, & clear cached draft on success
      const nextDraftRef = generateBookingReference();
      setDraftBookingRef(nextDraftRef);
      setIsSlotHeld(false);
      setHoldExpiresAt(null);
      setFullName('');
      setPhoneNumber('');
      setSafetyAgreed(false);
      removeProof();
      setIsNetworkFailure(false);
      try {
        sessionStorage.setItem('matchsip_draft_ref', nextDraftRef);
        sessionStorage.removeItem('matchsip_checkout_draft');
        localStorage.removeItem('matchsip_checkout_draft');
      } catch {}
    } catch (err: unknown) {
      console.error('Submission error:', err);
      const isNet =
        (typeof navigator !== 'undefined' && !navigator.onLine) ||
        (err instanceof Error &&
          (err.message.includes('fetch') ||
            err.message.includes('network') ||
            err.message.includes('Network') ||
            err.message.includes('Failed to fetch')));
      if (isNet) {
        setIsNetworkFailure(true);
        setErrorMessage(
          'Connection flickered during checkout. Don’t worry! Your slots and details are saved on your phone. Tap "Retry Reservation" to confirm.'
        );
      } else {
        setIsNetworkFailure(false);
        setErrorMessage(
          err instanceof Error 
            ? err.message 
            : 'Could not complete reservation. Please try again.'
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section id="rapid-checkout" className="w-full bg-[#5E2CB2] text-[#FFFFFF] py-14 sm:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-10 items-start">
          
          {/* Left Column: Reservation Summary */}
          <div className="flex flex-col gap-6">
            {/* Paddle Photo inside a rounded container (rounded-2xl) */}
            <div className="overflow-hidden rounded-2xl border border-[#B3A2DB]/40 bg-[#5E2CB2] shadow-xl">
              {/* Paddle Photo (Lazy Loaded) */}
              <img
                src={paddleUpImg}
                alt="Paddle Up"
                loading="lazy"
                decoding="async"
                width={640}
                height={360}
                className="w-full aspect-[16/9] object-cover"
                referrerPolicy="no-referrer"
              />
            </div>

            {/* YOUR RESERVATION summary card */}
            <div className="rounded-2xl border border-white/20 bg-white/10 p-6 shadow-xl backdrop-blur-sm flex flex-col gap-4">
              <div className="flex items-center justify-between pb-3 border-b border-white/15">
                <span className="text-xs font-bold uppercase tracking-widest text-[#B3A2DB]">
                  YOUR RESERVATION
                </span>
                <div className="flex items-center gap-2">
                  {reservationDate === getTodayDateString() && (
                    <span className="inline-flex items-center gap-1 rounded bg-white/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                      TODAY
                    </span>
                  )}
                  <span className="text-xs font-mono font-bold text-[#FFFFFF]">
                    {reservationDate}
                  </span>
                </div>
              </div>

              {/* Slot list or empty alert */}
              <div className="min-h-[70px] flex flex-col justify-center">
                {selectedSlots.length === 0 ? (
                  <p className="text-xs sm:text-sm text-[#B3A2DB] leading-relaxed">
                    No slots selected for <span className="font-semibold text-white">{reservationDate === getTodayDateString() ? `Today (${reservationDate})` : reservationDate}</span>. Head back to the matrix to pick your courts and times.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {selectedSlots.map((s, idx) => (
                      <div
                        key={`${s.slotId}-${idx}`}
                        className="flex items-center justify-between text-xs sm:text-sm py-1 border-b border-white/10 last:border-0"
                      >
                        <span className="font-bold text-[#FFFFFF]">
                          {s.courtName}: {s.timeLabel.replace(/\s*-\s*/, '-')}
                        </span>
                        <span className="font-mono text-white font-bold">
                          ₱{s.price}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* TOTAL ROW */}
              <div className="pt-3 border-t border-white/15 flex items-center justify-between">
                <span className="text-sm font-black uppercase tracking-widest text-[#FFFFFF]">
                  TOTAL
                </span>
                <span className="font-heading text-3xl sm:text-4xl font-black text-white">
                  ₱{totalPrice}
                </span>
              </div>
            </div>
          </div>

          {/* Right Column: Checkout Form */}
          <div className="flex flex-col gap-6">
            {/* Section Eyebrow & Headline */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-bold tracking-widest uppercase text-[#B3A2DB]">
                  RAPID CHECKOUT
                </span>
              </div>
              <h2 className="font-heading text-4xl sm:text-6xl font-black uppercase tracking-tight text-[#FFFFFF] leading-[0.95]">
                CONFIRM<br />
                YOUR SERVE
              </h2>
            </div>

            {/* 5-minute TTL Hold Banner (Mechanism 3) */}
            {selectedSlots.length > 0 && isSlotHeld && holdRemainingSeconds > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-500/15 border border-amber-400/40 px-4 py-3 text-xs text-amber-200 shadow-sm">
                <div className="flex items-center gap-2.5">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-400"></span>
                  </span>
                  <div className="flex items-center gap-1.5 font-medium">
                    <Clock className="h-4 w-4 text-amber-300 shrink-0" />
                    <span>Courts locked exclusively for you:</span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {holdExtendedNotice && (
                    <span className="text-[11px] font-semibold text-emerald-300 animate-pulse">
                      {holdExtendedNotice}
                    </span>
                  )}
                  <span className="font-mono font-bold text-amber-300 text-sm tracking-wider">
                    {Math.floor(holdRemainingSeconds / 60)}:{(holdRemainingSeconds % 60).toString().padStart(2, '0')}
                  </span>
                  {holdRemainingSeconds < 120 && (
                    <button
                      type="button"
                      onClick={() => renewHold(300, true)}
                      className="rounded bg-amber-400/20 hover:bg-amber-400/30 text-amber-200 border border-amber-400/40 px-2 py-0.5 text-[11px] font-semibold transition"
                    >
                      + Extend
                    </button>
                  )}
                </div>
              </div>
            )}
            {selectedSlots.length > 0 && isSlotHeld && holdRemainingSeconds === 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-500/20 border border-amber-400/50 px-4 py-3 text-xs text-amber-200">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-amber-300 shrink-0" />
                  <span className="font-medium">Hold time ended. Re-lock your court slots to prevent others from taking them.</span>
                </div>
                <button
                  type="button"
                  onClick={() => renewHold(300, true)}
                  className="rounded bg-[#00C6FF] hover:bg-[#00C6FF]/90 text-[#5E2CB2] font-black uppercase tracking-wider px-3 py-1 text-xs transition shadow"
                >
                  Keep Slots & Extend (+5m)
                </button>
              </div>
            )}

            {/* Checkout Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Full Name input */}
              <div>
                <input
                  type="text"
                  id="checkout-name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Your name"
                  required
                  className={`w-full rounded-xl border px-4 py-3.5 sm:py-4 text-base sm:text-sm font-medium text-[#FFFFFF] placeholder-white/50 transition-all focus:outline-none focus:ring-1 focus:ring-white/80 min-h-[50px] ${
                    isNameFilled
                      ? 'border-white/40 bg-white/15'
                      : 'border-white/25 bg-white/10'
                  }`}
                />
              </div>

              {/* Phone number input with +63 prefix */}
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <div className="flex h-12.5 sm:h-13 items-center justify-center rounded-xl border border-white/25 bg-white/10 px-4 text-base sm:text-sm font-bold text-[#FFFFFF] min-h-[50px]">
                    +63
                  </div>
                  <div className="relative flex-1">
                    <input
                      type="tel"
                      id="checkout-phone"
                      value={phoneNumber}
                      onChange={(e) => {
                        const digits = e.target.value.replace(/\D/g, '').slice(0, 10);
                        setPhoneNumber(digits);
                      }}
                      maxLength={10}
                      inputMode="numeric"
                      pattern="[0-9]{10}"
                      placeholder="9XX XXX XXXX"
                      required
                      className={`w-full rounded-xl border px-4 py-3.5 sm:py-4 pr-14 text-base sm:text-sm font-mono font-medium tracking-wider text-[#FFFFFF] placeholder-white/50 transition-all focus:outline-none focus:ring-1 focus:ring-white/80 min-h-[50px] ${
                        isPhoneFilled
                          ? 'border-white/40 bg-white/15'
                          : 'border-white/25 bg-white/10'
                      }`}
                    />
                    <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
                      <span className={`text-[11px] font-mono font-bold transition-colors ${
                        isPhoneFilled
                          ? 'text-white'
                          : phoneNumber.length > 0
                          ? 'text-white/70'
                          : 'text-white/40'
                      }`}>
                        {phoneNumber.length}/10
                      </span>
                    </div>
                  </div>
                </div>
                {phoneNumber.length > 0 && phoneNumber.length < 10 && (
                  <p className="px-1 text-[11px] text-white/70 font-medium">
                    Please enter {10 - phoneNumber.length} more digit{10 - phoneNumber.length > 1 ? 's' : ''} (10 digits total)
                  </p>
                )}
              </div>

              {/* InstaPay QR Box with User's Uploaded QR Code */}
              <div className="rounded-2xl border border-white/20 bg-white/10 p-4 sm:p-5 flex flex-col sm:flex-row items-center gap-4 sm:gap-6 shadow-sm">
                {/* Official InstaPay QR Card */}
                <div className="group relative flex shrink-0 flex-col items-center justify-center rounded-2xl bg-[#FFFFFF] p-2.5 shadow-xl transition-all hover:shadow-2xl">
                  <div className="relative overflow-hidden rounded-xl bg-white p-1">
                    <img
                      src={qrCodeImg}
                      alt="InstaPay QR Code for DA*A MI**A T."
                      className="h-32 w-32 object-contain sm:h-36 sm:w-36"
                      referrerPolicy="no-referrer"
                    />
                    {/* Hover enlarge button */}
                    <button
                      type="button"
                      onClick={() => setShowQrModal(true)}
                      className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-xl cursor-pointer"
                      aria-label="Enlarge QR Code"
                    >
                      <span className="flex items-center gap-1 rounded-full bg-slate-900/90 px-2.5 py-1 text-[10px] font-bold uppercase text-white shadow-md">
                        <Maximize2 className="h-3 w-3" /> Zoom
                      </span>
                    </button>
                  </div>

                  {/* Merchant information below QR */}
                  <div className="mt-1.5 flex flex-col items-center text-center">
                    <span className="text-[10px] font-medium text-gray-500">
                      Transfer fees may apply.
                    </span>
                    <span className="text-xs font-black tracking-wider text-[#0B63CE] uppercase">
                      DA*A MI**A T.
                    </span>
                  </div>
                </div>

                {/* QR instructions & actions */}
                <div className="flex flex-col text-center sm:text-left flex-1">
                  <span className="text-xs sm:text-sm font-bold uppercase tracking-wider text-white">
                    SCAN TO PAY • ₱{totalPrice}
                  </span>
                  <p className="mt-1 text-xs text-[#B3A2DB] leading-relaxed">
                    Scan this InstaPay QR code using GCash, Maya, BDO, or any QR Ph banking app to transfer exactly ₱{totalPrice}.
                  </p>

                  <div className="mt-2.5 flex flex-col gap-0.5 text-xs">
                    <div className="flex items-center justify-center sm:justify-start gap-1.5">
                      <span className="text-[#B3A2DB]">Account:</span>
                      <span className="font-extrabold text-[#FFFFFF]">DA*A MI**A T.</span>
                    </div>
                    <div className="flex items-center justify-center sm:justify-start gap-1.5">
                      <span className="text-[#B3A2DB]">Network:</span>
                      <span className="font-semibold text-white/90">InstaPay / QR Ph</span>
                    </div>
                  </div>

                  <div className="mt-3.5 flex flex-wrap items-center justify-center sm:justify-start gap-2">
                    <button
                      type="button"
                      onClick={() => setShowQrModal(true)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-bold text-white hover:bg-white/20 transition-colors cursor-pointer"
                    >
                      <Maximize2 className="h-3.5 w-3.5" /> Enlarge QR
                    </button>
                    <a
                      href={qrCodeImg}
                      download="MATCH_AND_SIP_QR.jpg"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-bold text-white hover:bg-white/20 transition-colors"
                    >
                      <Download className="h-3.5 w-3.5" /> Save QR
                    </a>
                  </div>
                </div>
              </div>

              {/* Notice Box */}
              <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3.5 sm:px-5 sm:py-4 shadow-sm">
                <p className="text-xs sm:text-sm font-bold uppercase tracking-wide text-amber-300 leading-relaxed">
                  NOTE: NO PAYMENT REFUND ONCE RESERVED. ALL BOOKINGS ARE FINAL AND NON-REFUNDABLE.
                </p>
              </div>

              {/* Payment Proof Upload Area */}
              <div className="space-y-2">
                <label className="block text-[11px] sm:text-xs font-bold uppercase tracking-wider text-[#B3A2DB]">
                  PAYMENT PROOF (JPG, PNG, OR WEBP • AUTO-COMPRESSED UP TO 30MB)
                </label>

                <input
                  type="file"
                  ref={fileInputRef}
                  accept="image/png,image/jpeg,image/webp,image/heic,image/heif,image/avif"
                  onChange={handleFileChange}
                  className="hidden"
                />

                {!proofImage && !isUploadingProof ? (
                  <div className="space-y-2">
                    <div
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                      onClick={() => fileInputRef.current?.click()}
                      className={`flex items-center gap-3 w-full cursor-pointer rounded-xl border px-4 py-3.5 sm:px-5 sm:py-4 transition-all ${
                        isDragging
                          ? 'border-white bg-white/20 scale-[1.01]'
                          : uploadError
                          ? 'border-red-500/70 bg-white/10 hover:border-red-400'
                          : 'border-white/20 bg-white/10 hover:border-white/40 hover:bg-white/15'
                      }`}
                    >
                      <Upload className={`h-5 w-5 shrink-0 ${uploadError ? 'text-red-400' : 'text-white/80'}`} />
                      <span className="text-xs sm:text-sm font-medium text-[#FFFFFF]">
                        Upload payment screenshot (JPG, PNG, or WebP &bull; Auto-compressed up to 30MB)
                      </span>
                    </div>

                    {uploadError && (
                      <div className="flex items-start justify-between gap-2.5 rounded-xl bg-red-950/90 border border-red-500/70 p-3 text-xs text-red-200">
                        <div className="flex items-start gap-2">
                          <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                          <span className="leading-snug">{uploadError}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setUploadError(null);
                            if (fileInputRef.current) fileInputRef.current.value = '';
                            fileInputRef.current?.click();
                          }}
                          className="shrink-0 text-[11px] font-bold text-white underline hover:text-white/80 cursor-pointer"
                        >
                          Try Again
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col gap-2 rounded-xl border border-white/20 bg-white/10 p-3.5 sm:p-4 shadow-sm">
                    <div className="flex items-center justify-between gap-3">
                      {/* Image Thumbnail with zoom trigger */}
                      <div className="relative group shrink-0">
                        {proofImage ? (
                          <img
                            src={proofImage}
                            alt="Payment receipt proof preview"
                            className="h-12 w-12 rounded-lg object-cover border border-white/20 shadow-sm"
                          />
                        ) : (
                          <div className="h-12 w-12 rounded-lg bg-white/10 flex items-center justify-center border border-white/20">
                            <Cloud className="h-5 w-5 text-white/70" />
                          </div>
                        )}
                        {proofImage && (
                          <button
                            type="button"
                            onClick={() => setShowReceiptPreviewModal(true)}
                            className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg cursor-pointer"
                            title="View enlarged receipt"
                          >
                            <Maximize2 className="h-3 w-3 text-white" />
                          </button>
                        )}
                      </div>

                      {/* File Info & Upload Status */}
                      <div className="flex flex-col flex-1 min-w-0">
                        <span className="text-xs font-bold text-[#FFFFFF] truncate">
                          {proofFileName || 'payment_receipt.jpg'}
                        </span>
                        
                        {isUploadingProof ? (
                          <div className="mt-1 flex flex-col gap-1">
                            <span className="text-[11px] font-bold text-white/80 flex items-center gap-1.5">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              Optimizing & attaching payment receipt ({uploadProgress}%)...
                            </span>
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/15">
                              <div
                                className="h-full bg-white transition-all duration-200"
                                style={{ width: `${uploadProgress}%` }}
                              />
                            </div>
                          </div>
                        ) : uploadError ? (
                          <div className="mt-1 flex flex-col gap-1 text-[11px] font-medium text-red-300">
                            <div className="flex items-start gap-1.5">
                              <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-400 mt-0.5" />
                              <span className="leading-snug">{uploadError}</span>
                            </div>
                          </div>
                        ) : (
                          <span className="mt-1 text-[11px] font-bold text-emerald-300 flex items-center gap-1">
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                            Payment proof attached • Ready
                          </span>
                        )}
                      </div>

                      {/* Action buttons */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        {uploadError && currentFile && (
                          <button
                            type="button"
                            onClick={() => uploadFileToStorage(currentFile)}
                            className="inline-flex items-center gap-1 rounded-lg bg-white/20 px-2 py-1 text-[11px] font-bold text-white hover:bg-white/30 transition-colors cursor-pointer"
                            title="Retry upload"
                          >
                            <RefreshCw className="h-3 w-3" /> Retry
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="rounded-lg bg-white/10 hover:bg-white/20 px-2 py-1 text-[11px] font-medium text-white transition-colors cursor-pointer"
                          title="Choose a different screenshot"
                        >
                          Change
                        </button>
                        <button
                          type="button"
                          onClick={removeProof}
                          className="rounded-lg p-1.5 text-white/60 hover:bg-red-500/20 hover:text-red-300 transition-colors cursor-pointer"
                          title="Remove screenshot"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Safety Reminders Button */}
              <div className="pt-1">
                <button
                  type="button"
                  id="safety-agreement-checkbox"
                  onClick={() => setShowSafetyModal(true)}
                  className={`w-full flex items-center justify-between gap-3 rounded-xl border px-4 py-3.5 sm:px-5 sm:py-4 transition-all text-left cursor-pointer ${
                    safetyAgreed
                      ? 'border-emerald-400/50 bg-emerald-500/10 text-[#FFFFFF]'
                      : 'border-white/20 bg-white/10 hover:bg-white/15 text-[#FFFFFF]'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {safetyAgreed ? (
                      <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
                    ) : (
                      <ShieldCheck className="h-5 w-5 text-white/60 shrink-0" />
                    )}
                    <span className="text-xs sm:text-sm font-medium leading-snug text-[#FFFFFF]">
                      {safetyAgreed ? (
                        <>
                          Agreed to <span className="text-emerald-300 font-bold">Pickleball Court Safety Reminders</span>
                        </>
                      ) : (
                        <>
                          I have read and agree to the <span className="font-semibold text-white">Pickleball Court Safety Reminders</span>.
                        </>
                      )}
                    </span>
                  </div>

                  <span className="rounded-lg bg-white/15 hover:bg-white/25 border border-white/20 px-3 py-1.5 text-xs font-bold text-white transition-colors shrink-0 whitespace-nowrap">
                    View Reminders
                  </span>
                </button>
              </div>

              {/* Error notice & Offline Fallback Action */}
              {errorMessage && (
                <div className="flex flex-col gap-2.5 rounded-xl bg-red-950/80 border border-red-500/60 p-3.5 text-xs text-red-200">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                    <span className="leading-relaxed flex-1">{errorMessage}</span>
                  </div>
                  {isNetworkFailure && (
                    <button
                      type="button"
                      onClick={handleSubmit}
                      disabled={isSubmitting || !isFormValid}
                      className="mt-1 w-full rounded-xl bg-[#00C6FF] py-3 px-4 text-center text-xs font-black uppercase tracking-wider text-black shadow-md hover:bg-[#00C6FF]/90 active:scale-95 cursor-pointer flex items-center justify-center gap-2 min-h-[46px]"
                    >
                      <RefreshCw className={`h-4 w-4 ${isSubmitting ? 'animate-spin' : ''}`} />
                      <span>Retry Reservation Now</span>
                    </button>
                  )}
                </div>
              )}

              {/* Action Button: BOOK RESERVATION */}
              <div className="pt-2">
                <button
                  type="submit"
                  id="book-reservation-btn"
                  disabled={!isFormValid}
                  className={`w-full rounded-xl py-4 sm:py-4.5 text-center text-xs sm:text-sm font-black uppercase tracking-wider transition-all min-h-[52px] sm:min-h-[56px] flex items-center justify-center gap-2 ${
                    isFormValid
                      ? 'bg-[#00C6FF] text-black shadow-lg shadow-[#00C6FF]/30 hover:bg-[#00C6FF]/90 hover:scale-[1.01] active:scale-95 cursor-pointer'
                      : 'bg-[#B3A2DB]/20 text-[#FFFFFF]/40 cursor-not-allowed border border-[#B3A2DB]/20 shadow-none'
                  }`}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                      <span>CONFIRMING RESERVATION...</span>
                    </>
                  ) : (
                    <span>BOOK RESERVATION</span>
                  )}
                </button>

                <p className="mt-2 text-center text-[11px] text-[#B3A2DB]">
                  {selectedSlots.length === 0
                    ? '↑ Select a court & slots in the matrix above first'
                    : !isNameFilled
                    ? 'Required: Please enter your full name'
                    : !isPhoneFilled
                    ? 'Required: Please enter your phone number'
                    : !isProofUploaded
                    ? (isUploadingProof ? 'Optimizing & attaching payment receipt...' : 'Required: Please upload your InstaPay payment screenshot')
                    : !safetyAgreed
                    ? 'Required: Please agree to the court safety reminders'
                    : 'All requirements satisfied. Click to book!'}
                </p>
              </div>
            </form>
          </div>

        </div>
      </div>

      {/* Enlarged InstaPay QR Modal */}
      {showQrModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in">
          <div className="relative w-full max-w-sm rounded-3xl border border-[#00C6FF]/60 bg-[#FFFFFF] p-6 text-black shadow-2xl text-center">
            <button
              type="button"
              onClick={() => setShowQrModal(false)}
              className="absolute top-4 right-4 rounded-full p-2 text-gray-600 hover:text-black hover:bg-gray-100 transition-colors"
              aria-label="Close QR modal"
            >
              <X className="h-5 w-5" />
            </button>

            <span className="text-[11px] font-black tracking-widest text-[#5E2CB2] uppercase block mb-3">
              Official InstaPay QR
            </span>

            <div className="mx-auto w-64 h-64 overflow-hidden rounded-2xl bg-white p-2 border border-gray-200 shadow-inner flex items-center justify-center">
              <img
                src={qrCodeImg}
                alt="Enlarged InstaPay QR Code"
                className="w-full h-full object-contain"
                referrerPolicy="no-referrer"
              />
            </div>

            <div className="mt-3">
              <p className="text-xs text-gray-500 font-medium">Transfer fees may apply.</p>
              <p className="text-base font-black tracking-wider text-[#0B63CE] uppercase mt-0.5">
                DA*A MI**A T.
              </p>
            </div>

            <div className="mt-4 pt-3 border-t border-gray-200 flex items-center justify-between text-xs">
              <span className="font-bold text-gray-700">Amount Due:</span>
              <span className="font-mono font-black text-base text-[#5E2CB2]">₱{totalPrice}</span>
            </div>

            <div className="mt-5 flex gap-2">
              <a
                href={qrCodeImg}
                download="MATCH_AND_SIP_QR.jpg"
                className="flex-1 rounded-xl border-2 border-[#5E2CB2] bg-[#FFFFFF] py-2.5 text-xs font-black uppercase tracking-wider text-[#5E2CB2] hover:bg-[#5E2CB2]/5 transition-colors inline-flex items-center justify-center gap-1.5"
              >
                <Download className="h-4 w-4" /> Save Image
              </a>
              <button
                type="button"
                onClick={() => setShowQrModal(false)}
                className="flex-1 rounded-xl bg-[#00C6FF] py-2.5 text-xs font-black uppercase tracking-wider text-black hover:bg-[#00C6FF]/90 transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Receipt Proof Zoom Modal */}
      {showReceiptPreviewModal && proofImage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-in fade-in">
          <div className="relative max-w-md w-full rounded-2xl border border-white/20 bg-[#5E2CB2] p-5 text-white shadow-2xl">
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-white/20">
              <div className="flex items-center gap-2">
                <Cloud className="h-4 w-4 text-[#00C6FF]" />
                <span className="text-xs font-black uppercase text-[#00C6FF]">
                  Uploaded Payment Receipt
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowReceiptPreviewModal(false)}
                className="rounded-full p-1 text-white/70 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="overflow-hidden rounded-xl bg-black/40 p-2 flex items-center justify-center max-h-[65vh]">
              <img
                src={proofImage}
                alt="Enlarged payment screenshot proof"
                className="max-h-[60vh] w-auto object-contain rounded-lg"
                referrerPolicy="no-referrer"
              />
            </div>

            <div className="mt-3 flex items-center justify-between gap-2 text-xs">
              <span className="text-white/70 truncate text-[11px]">
                {proofFileName || 'payment_receipt.jpg'}
              </span>
              <button
                type="button"
                onClick={() => setShowReceiptPreviewModal(false)}
                className="rounded-lg bg-[#00C6FF] px-4 py-1.5 text-xs font-black uppercase tracking-wider text-black hover:bg-[#00C6FF]/90 transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Court Safety Reminders Modal */}
      {showSafetyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="relative w-full max-w-xl max-h-[90vh] flex flex-col rounded-3xl border border-white/20 bg-[#4A1E94] p-5 sm:p-7 text-[#FFFFFF] shadow-2xl shadow-black/60">
            {/* Header */}
            <div className="flex items-center justify-between pb-4 border-b border-white/15 shrink-0">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center shrink-0">
                  <ShieldCheck className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h3 className="font-heading text-lg sm:text-xl font-black uppercase tracking-tight text-[#FFFFFF] leading-tight">
                    Pickleball Court Safety Reminders
                  </h3>
                  <span className="text-[11px] font-bold tracking-wider uppercase text-[#B3A2DB]">
                    {COURT_SAFETY_RULES.length} Mandatory Safety Guidelines
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowSafetyModal(false)}
                className="rounded-full p-2 text-[#B3A2DB] hover:text-[#FFFFFF] hover:bg-white/10 transition-colors cursor-pointer"
                aria-label="Close safety reminders modal"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Scrollable Rules List with bottom detection */}
            <div
              ref={rulesContainerRef}
              onScroll={handleRulesScroll}
              className="overflow-y-auto max-h-[58vh] pr-1.5 sm:pr-2.5 my-4 space-y-2.5 scroll-smooth"
            >
              {COURT_SAFETY_RULES.map((rule) => (
                <div
                  key={rule.num}
                  className="group flex items-start gap-3 rounded-xl border border-white/15 bg-white/[0.06] hover:bg-white/[0.1] p-3 sm:p-3.5 transition-all"
                >
                  <span className="font-mono text-xs font-black px-2 py-0.5 rounded-md shrink-0 flex items-center justify-center min-w-[34px] mt-0.5 text-white bg-white/15 border border-white/20">
                    {rule.num}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs sm:text-sm text-[#FFFFFF]/95 leading-relaxed font-medium">
                      {rule.text}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {/* Modal Footer */}
            <div className="pt-3 border-t border-white/15 shrink-0">
              <button
                type="button"
                disabled={!hasScrolledToBottom}
                onClick={() => {
                  if (!hasScrolledToBottom) return;
                  setSafetyAgreed(true);
                  setShowSafetyModal(false);
                }}
                className={`w-full rounded-xl py-3.5 text-center text-xs sm:text-sm font-black uppercase tracking-wider transition-all duration-200 min-h-[48px] flex items-center justify-center gap-2 ${
                  hasScrolledToBottom
                    ? 'bg-[#00C6FF] text-black hover:bg-[#00C6FF]/90 shadow-lg shadow-[#00C6FF]/25 hover:scale-[1.01] active:scale-98 cursor-pointer font-bold'
                    : 'bg-[#B3A2DB]/15 text-[#FFFFFF]/35 cursor-not-allowed border border-[#B3A2DB]/20 shadow-none select-none'
                }`}
              >
                {hasScrolledToBottom ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-black stroke-[2.5] shrink-0" />
                    <span>I UNDERSTAND &amp; AGREE TO ALL RULES</span>
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-4 w-4 animate-bounce text-white/80 shrink-0" />
                    <span>SCROLL DOWN TO READ ALL REMINDERS</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
