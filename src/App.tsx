/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, Suspense, lazy } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { WifiOff, Wifi, AlertTriangle } from 'lucide-react';
import { Header } from './components/Header';
import { Footer } from './components/Footer';
import { HomePage } from './pages/HomePage';
import { TimeSlot, SelectedSlot, ConfirmedBooking } from './types';
import { 
  subscribeToBookings, 
  saveBookingToFirestore, 
  getInitialCachedBookings,
  validateSlotsLiveAvailability 
} from './services/bookingService';
import { getTodayDateString } from './utils/dateUtils';
import { useNetworkStatus } from './utils/useNetworkStatus';

// Lazy-loaded routes & modals for bundle code-splitting and faster initial page load
const BookingsPage = lazy(() => import('./pages/BookingsPage').then((m) => ({ default: m.BookingsPage })));
const BookingSuccessModal = lazy(() => import('./components/BookingSuccessModal').then((m) => ({ default: m.BookingSuccessModal })));
const ReservationsModal = lazy(() => import('./components/ReservationsModal').then((m) => ({ default: m.ReservationsModal })));
import MaintenancePage from './MaintenancePage.tsx';
import { HARDCODED_MAINTENANCE_MODE } from './config/maintenanceConfig.ts';

const SELECTED_SLOTS_STORAGE_KEY = 'matchsip_selected_slots';
const SELECTED_DATE_STORAGE_KEY = 'matchsip_selected_date';

// Lightweight Route Loading Spinner
const RouteLoadingFallback = () => (
  <div className="flex-1 flex flex-col items-center justify-center min-h-[50vh] p-8 text-center text-[#B3A2DB]">
    <div className="h-10 w-10 border-3 border-[#00C6FF] border-t-transparent rounded-full animate-spin mb-3" />
    <span className="text-xs font-bold uppercase tracking-widest text-[#00C6FF]">Loading Match &amp; Sip...</span>
  </div>
);

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const isBookingsPage = location.pathname === '/bookings';

  // Code-level Maintenance Mode state driven solely by HARDCODED_MAINTENANCE_MODE
  const isMaintenanceActive = HARDCODED_MAINTENANCE_MODE;

  // Network drop tracking & offline fallbacks
  const { isOnline, wasOffline } = useNetworkStatus();

  // Always initialize selected booking date to today's current date in local time (YYYY-MM-DD) on page load/refresh
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    const today = getTodayDateString();
    // Clean up any stale date from previous sessions so refreshes always start on today
    try {
      localStorage.removeItem(SELECTED_DATE_STORAGE_KEY);
    } catch {}
    return today;
  });

  // Restore cached selected slots from sessionStorage (or localStorage fallback)
  const [selectedSlots, setSelectedSlots] = useState<SelectedSlot[]>(() => {
    try {
      const raw = sessionStorage.getItem(SELECTED_SLOTS_STORAGE_KEY) || localStorage.getItem(SELECTED_SLOTS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const today = getTodayDateString();
        if (
          parsed &&
          Array.isArray(parsed.slots) &&
          Date.now() - (parsed.savedAt || 0) < 2 * 60 * 60 * 1000
        ) {
          const validSlots = parsed.slots.filter(
            (s: SelectedSlot) => s && s.date && s.date >= today
          );
          if (validSlots.length > 0) {
            return validSlots;
          }
        }
      }
      sessionStorage.removeItem(SELECTED_SLOTS_STORAGE_KEY);
      localStorage.removeItem(SELECTED_SLOTS_STORAGE_KEY);
    } catch {}
    return [];
  });

  const [confirmedBooking, setConfirmedBooking] = useState<ConfirmedBooking | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Supabase Real-time Persistence State
  const [persistedBookings, setPersistedBookings] = useState<ConfirmedBooking[]>(() => {
    return getInitialCachedBookings();
  });
  const [isLoadingBookings, setIsLoadingBookings] = useState<boolean>(() => {
    return getInitialCachedBookings().length === 0;
  });
  const [isReservationsModalOpen, setIsReservationsModalOpen] = useState<boolean>(false);

  // Sync active draft slots to sessionStorage and localStorage for seamless refresh preservation
  useEffect(() => {
    try {
      if (selectedSlots.length > 0) {
        const payload = JSON.stringify({ slots: selectedSlots, savedAt: Date.now() });
        sessionStorage.setItem(SELECTED_SLOTS_STORAGE_KEY, payload);
        localStorage.setItem(SELECTED_SLOTS_STORAGE_KEY, payload);
      } else {
        sessionStorage.removeItem(SELECTED_SLOTS_STORAGE_KEY);
        localStorage.removeItem(SELECTED_SLOTS_STORAGE_KEY);
      }
    } catch {}
  }, [selectedSlots]);

  // Real-time date synchronization: automatically advance when midnight passes or when window regains focus
  useEffect(() => {
    let lastKnownToday = getTodayDateString();

    const syncTodayDate = () => {
      const nowToday = getTodayDateString();
      if (nowToday !== lastKnownToday) {
        setSelectedDate((prev) => (prev === lastKnownToday ? nowToday : prev));
        lastKnownToday = nowToday;
      }
    };

    const interval = setInterval(syncTodayDate, 10000);
    window.addEventListener('focus', syncTodayDate);
    document.addEventListener('visibilitychange', syncTodayDate);

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', syncTodayDate);
      document.removeEventListener('visibilitychange', syncTodayDate);
    };
  }, []);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((curr) => (curr === msg ? null : curr));
    }, 3500);
  }, []);

  // When returning online after a network drop, re-validate selected slots against live Supabase
  useEffect(() => {
    if (wasOffline && isOnline) {
      showToast('⚡ Back online! Re-validating slot availability with Supabase...');
      if (selectedSlots.length > 0) {
        const draftRef = typeof window !== 'undefined' ? sessionStorage.getItem('matchsip_draft_ref') : null;
        validateSlotsLiveAvailability(selectedSlots, selectedDate, draftRef || undefined)
          .then((check) => {
            if (!check.isAvailable) {
              showToast(`⚠️ Offline conflict: ${check.conflictReason}`);
              if (check.conflictingSlot) {
                setSelectedSlots((prev) =>
                  prev.filter((s) => s.slotId !== check.conflictingSlot?.slotId)
                );
              }
            } else {
              showToast('✓ All your selected court slots remain reserved and open!');
            }
          })
          .catch((err) => {
            console.warn('Re-validation warning:', err);
          });
      }
    }
  }, [wasOffline, isOnline, selectedDate, selectedSlots, showToast]);

  // Targeted real-time synchronization with Supabase for the selected reservation date
  useEffect(() => {
    setIsLoadingBookings(true);
    const unsubscribe = subscribeToBookings(
      (bookings) => {
        setPersistedBookings(bookings);
        setIsLoadingBookings(false);
      },
      (error) => {
        console.warn('Supabase database sync notice:', error);
        setIsLoadingBookings(false);
      },
      { date: selectedDate }
    );

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [selectedDate]);

  // Concurrency guard: if another player books a slot that is currently picked by this user, automatically release it
  useEffect(() => {
    if (selectedSlots.length === 0 || persistedBookings.length === 0) return;

    const draftRef = typeof window !== 'undefined' ? sessionStorage.getItem('matchsip_draft_ref') : null;
    const normalizedDraft = draftRef ? draftRef.trim().toLowerCase() : null;

    const bookedIdsOnSelectedDate = new Set(
      persistedBookings
        .filter((b) => {
          if (b.selectedDate !== selectedDate) return false;
          if (b.status === 'CANCELLED' || b.status === 'REJECTED') return false;
          // Ignore own draft hold reference
          if (normalizedDraft && b.bookingReference && b.bookingReference.trim().toLowerCase() === normalizedDraft) {
            return false;
          }
          return true;
        })
        .flatMap((b) =>
          (b.slots || []).flatMap((s) => {
            const match = (s.timeLabel || '').match(/(\d{1,2}):(\d{2})/);
            const timeKey = match ? `${match[1].padStart(2, '0')}${match[2]}` : '';
            return [s.slotId, `${s.courtId}-${timeKey}`].filter(Boolean);
          })
        )
    );

    const conflicted = selectedSlots.filter((s) => {
      if (s.date !== selectedDate) return false;
      const match = (s.timeLabel || '').match(/(\d{1,2}):(\d{2})/);
      const timeKey = match ? `${match[1].padStart(2, '0')}${match[2]}` : '';
      return (
        bookedIdsOnSelectedDate.has(s.slotId) ||
        (timeKey ? bookedIdsOnSelectedDate.has(`${s.courtId}-${timeKey}`) : false)
      );
    });

    if (conflicted.length > 0) {
      setSelectedSlots((prev) =>
        prev.filter((s) => !(s.date === selectedDate && bookedIdsOnSelectedDate.has(s.slotId)))
      );
      showToast(`${conflicted.length} slot(s) were just reserved by another player.`);
    }
  }, [persistedBookings, selectedDate, selectedSlots, showToast]);

  const handleToggleSlot = useCallback((slot: TimeSlot, dateStr: string) => {
    const formattedRange = `${slot.startTime}-${slot.endTime}`;
    setSelectedSlots((prev) => {
      const exists = prev.some((s) => s.slotId === slot.id && s.date === dateStr);
      if (exists) {
        showToast(`Removed ${slot.courtName} (${formattedRange})`);
        return prev.filter((s) => !(s.slotId === slot.id && s.date === dateStr));
      } else {
        showToast(`Added ${slot.courtName} (${formattedRange})`);
        return [
          ...prev,
          {
            slotId: slot.id,
            courtId: slot.courtId,
            courtName: slot.courtName,
            timeLabel: formattedRange,
            date: dateStr,
            price: slot.price,
          },
        ];
      }
    });
  }, [showToast]);

  const handleClearSlots = useCallback(() => {
    setSelectedSlots([]);
    try {
      localStorage.removeItem(SELECTED_SLOTS_STORAGE_KEY);
    } catch {}
    showToast('Cleared all selected court slots');
  }, [showToast]);

  const handlePlayTodayClick = useCallback(() => {
    navigate('/');
    setTimeout(() => {
      const el = document.getElementById('court-matrix-section');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth' });
      }
    }, 100);
  }, [navigate]);

  const handleBookingComplete = useCallback(async (booking: ConfirmedBooking) => {
    // 1. Optimistic UI update: immediately lock the slot visually in the matrix
    const optimisticBooking: ConfirmedBooking = {
      ...booking,
      status: 'VERIFIED',
    };

    setPersistedBookings((prev) => [
      optimisticBooking,
      ...prev.filter((b) => b.bookingReference !== booking.bookingReference),
    ]);

    try {
      // 2. Process backend commit in background with Supabase slot locks
      await saveBookingToFirestore(booking);

      // On confirmation: finalize confirmed state and clear drafts
      setConfirmedBooking(booking);
      setSelectedSlots([]);
      try {
        sessionStorage.removeItem(SELECTED_SLOTS_STORAGE_KEY);
        sessionStorage.removeItem('matchsip_checkout_draft');
        localStorage.removeItem(SELECTED_SLOTS_STORAGE_KEY);
        localStorage.removeItem('matchsip_checkout_draft');
      } catch {}
      showToast(`Reservation #${booking.bookingReference} confirmed!`);
    } catch (error: any) {
      console.error('Error saving to Supabase:', error);

      // Revert optimistic reservation
      setPersistedBookings((prev) => prev.filter((b) => b.bookingReference !== booking.bookingReference));

      const isConflict = error?.message && (
        error.message.includes('DOUBLE_BOOKING_PREVENTED') ||
        error.message.includes('Slot conflict') ||
        error.message.includes('already locked') ||
        error.message.includes('409')
      );

      if (isConflict) {
        // Gracefully release conflicting slots without forcing a page reload
        const conflictingSlotIds = new Set(
          (booking.slots || []).map((s) => s.slotId)
        );
        setSelectedSlots((prev) => prev.filter((s) => !conflictingSlotIds.has(s.slotId)));

        showToast('⚠️ Slot conflict: That court time was just reserved by another player moments ago. The slot has been released.');
        throw error;
      }

      // Offline fallback: keep locally if network drop
      setPersistedBookings((prev) => [
        optimisticBooking,
        ...prev.filter((b) => b.bookingReference !== booking.bookingReference),
      ]);
      setConfirmedBooking(booking);
      setSelectedSlots([]);
      showToast(`Reservation #${booking.bookingReference} saved offline!`);
    }
  }, [showToast]);

  // Instantly lock out customer sessions across all devices when maintenance mode is active
  if (isMaintenanceActive && !isBookingsPage) {
    return <MaintenancePage />;
  }

  return (
    <div className="min-h-screen bg-[#5E2CB2] text-[#FFFFFF] flex flex-col selection:bg-[#00C6FF] selection:text-black">
      {/* Offline Status Bar when connection drops */}
      {!isOnline && (
        <div className="bg-amber-500 text-black px-4 py-2.5 text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 border-b border-amber-600 shadow-md z-50 sticky top-0 animate-in slide-in-from-top duration-200">
          <WifiOff className="h-4 w-4 shrink-0" />
          <span>Offline Mode Active • Your selected slots and inputs are safely saved on this device</span>
        </div>
      )}

      {/* Top Header */}
      {!isBookingsPage && location.pathname !== '/checkout/gcash-pay' && (
        <Header
          onPlayTodayClick={handlePlayTodayClick}
          selectedSlotsCount={selectedSlots.length}
          onOpenReservationsClick={() => navigate('/bookings')}
          savedBookingsCount={persistedBookings.length}
        />
      )}

      {/* Main Routed Content with Code-Splitting Suspense */}
      <main className="flex-1 flex flex-col pb-12 lg:pb-0">
        <Suspense fallback={<RouteLoadingFallback />}>
          <Routes>
            <Route
              path="/"
              element={
                <HomePage
                  selectedDate={selectedDate}
                  onSelectDate={(newDate) => {
                    setSelectedDate(newDate);
                    setSelectedSlots([]);
                  }}
                  selectedSlots={selectedSlots}
                  persistedBookings={persistedBookings}
                  isLoadingBookings={isLoadingBookings}
                  onToggleSlot={handleToggleSlot}
                  onClearSlots={handleClearSlots}
                  onBookingComplete={handleBookingComplete}
                />
              }
            />
            <Route
              path="/bookings"
              element={
                <BookingsPage
                  persistedBookings={persistedBookings}
                  isLoadingBookings={isLoadingBookings}
                />
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </main>

      {/* Persistent Footer */}
      {!isBookingsPage && <Footer />}

      {/* Booking Confirmation Success Modal */}
      <Suspense fallback={null}>
        <BookingSuccessModal
          booking={confirmedBooking}
          onClose={() => setConfirmedBooking(null)}
        />
      </Suspense>

      {/* Persistent Reservations Modal */}
      <Suspense fallback={null}>
        <ReservationsModal
          isOpen={isReservationsModalOpen}
          onClose={() => setIsReservationsModalOpen(false)}
          bookings={persistedBookings}
          isLoading={isLoadingBookings}
        />
      </Suspense>

      {/* Floating Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-xl border border-[#00C6FF]/60 bg-[#5E2CB2] px-4 py-3 text-xs font-semibold text-[#FFFFFF] shadow-2xl shadow-[#00C6FF]/30 backdrop-blur-md animate-in fade-in slide-in-from-bottom-3 duration-200 max-w-[90vw]">
          <span className="h-2 w-2 rounded-full bg-[#00C6FF] animate-ping shrink-0" />
          <span className="leading-snug">{toastMessage}</span>
        </div>
      )}
    </div>
  );
}
