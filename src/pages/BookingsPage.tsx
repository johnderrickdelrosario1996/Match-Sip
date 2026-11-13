import React, { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Search,
  Calendar,
  Clock,
  CheckCircle2,
  Phone,
  User,
  Database,
  ExternalLink,
  X,
  PlusCircle,
  RefreshCw,
  Trash2,
  Pencil,
  Check,
  Lock,
  Mail,
  FileText,
  Download,
  FileSpreadsheet,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
} from 'lucide-react';
import { ConfirmedBooking } from '../types';
import { 
  deleteBookingFromFirestore, 
  updateBookingInFirestore,
  sendAdminBookingNotification,
  validateSlotsLiveAvailability,
  fetchUnmaskedAdminBookings,
  fetchBookingReceipt,
  invalidateUnmaskedBookingsCache,
  subscribeToBookings,
  getStoredAdminPin,
} from '../services/bookingService';
import { EditBookingModal } from '../components/EditBookingModal';
import { AddBookingModal } from '../components/AddBookingModal';
import { CalendarPopup } from '../components/CalendarPopup';
import { PinCodeInput } from '../components/PinCodeInput';
import { 
  getTodayDateString, 
  formatDateToDDMMYYYY, 
  formatDateToFullReadable,
  formatConfirmedTimestamp 
} from '../utils/dateUtils';
import { useDebounce } from '../utils/useDebounce';

interface BookingsPageProps {
  persistedBookings: ConfirmedBooking[];
  isLoadingBookings: boolean;
}

const AUTH_STORAGE_KEY = 'matchsip_admin_auth';
const ADMIN_PIN_STORAGE_KEY = 'matchsip_admin_pin';

export const BookingsPage: React.FC<BookingsPageProps> = ({
  persistedBookings,
  isLoadingBookings,
}) => {
  const navigate = useNavigate();

  // Authentication State with sessionStorage persistence (requires stored verified PIN)
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(AUTH_STORAGE_KEY) === 'true' && Boolean(getStoredAdminPin());
    } catch {
      return false;
    }
  });

  const [activeAdminPin, setActiveAdminPin] = useState<string>(() => {
    return getStoredAdminPin();
  });

  const [isLoadingUnmasked, setIsLoadingUnmasked] = useState<boolean>(false);
  const [isUnmaskedLoaded, setIsUnmaskedLoaded] = useState<boolean>(false);
  const [isVerifyingPin, setIsVerifyingPin] = useState<boolean>(false);

  const [pin, setPin] = useState('');
  const [isShaking, setIsShaking] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const pinInputRef = React.useRef<HTMLInputElement>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearchTerm = useDebounce(searchTerm, 250);

  // Optimistic UI state: starts with persistedBookings, and transitions to full unmasked data when unlocked
  const [localBookings, setLocalBookings] = useState<ConfirmedBooking[]>(persistedBookings);

  // Synchronize with public bookings ONLY prior to admin authentication to avoid masking unlocked data
  useEffect(() => {
    if (!isAuthenticated && !isUnmaskedLoaded) {
      setLocalBookings(persistedBookings);
    }
  }, [persistedBookings, isAuthenticated, isUnmaskedLoaded]);

  // Lazy-load payment receipt states (fetches full image binary only when admin clicks [Receipt])
  const [activeReceiptBooking, setActiveReceiptBooking] = useState<ConfirmedBooking | null>(null);
  const [receiptImageUrl, setReceiptImageUrl] = useState<string | null>(null);
  const [isLoadingReceipt, setIsLoadingReceipt] = useState<boolean>(false);
  const [receiptError, setReceiptError] = useState<string | null>(null);

  // Pagination state (24 cards per page - optimal for 1, 2, or 3 column responsive grids)
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [itemsPerPage, setItemsPerPage] = useState<number>(24);

  const [filterDate, setFilterDate] = useState<string>('all');
  const [filterCategory, setFilterCategory] = useState<'all' | 'today' | 'upcoming' | 'past'>('today');
  const [sortOrder, setSortOrder] = useState<'present-first' | 'newest-first' | 'oldest-first'>('present-first');
  const [isCalendarOpen, setIsCalendarOpen] = useState<boolean>(false);
  const [deletingBookingId, setDeletingBookingId] = useState<string | null>(null);
  const [bookingToDelete, setBookingToDelete] = useState<ConfirmedBooking | null>(null);
  const [editingBooking, setEditingBooking] = useState<ConfirmedBooking | null>(null);
  const [isAddBookingOpen, setIsAddBookingOpen] = useState<boolean>(false);
  const [toastNotification, setToastNotification] = useState<string | null>(null);
  const [sendingEmailBookingId, setSendingEmailBookingId] = useState<string | null>(null);
  const [isSendingTestEmail, setIsSendingTestEmail] = useState<boolean>(false);

  const showNotification = (msg: string) => {
    setToastNotification(msg);
    setTimeout(() => {
      setToastNotification((prev) => (prev === msg ? null : prev));
    }, 3500);
  };

  const handleSendNotificationEmail = async (booking: ConfirmedBooking) => {
    const ref = booking.bookingReference;
    setSendingEmailBookingId(ref);
    try {
      const res = await sendAdminBookingNotification(booking);
      if (res.success) {
        showNotification(`Notification email sent to admin for #${ref}! Check your inbox or Spam.`);
      } else {
        showNotification(res.message || 'Failed to dispatch email.');
      }
    } catch (err: any) {
      showNotification('Error sending email: ' + (err.message || 'Unknown'));
    } finally {
      setSendingEmailBookingId(null);
    }
  };

  const handleSendTestEmail = async () => {
    setIsSendingTestEmail(true);
    try {
      const pinToUse = (activeAdminPin || sessionStorage.getItem(ADMIN_PIN_STORAGE_KEY) || '').trim();
      const res = await fetch('/api/test-email', {
        method: 'POST',
        headers: {
          'x-admin-pin': pinToUse,
        },
      });
      const data = await res.json();
      if (data.success) {
        showNotification(data.message || `Test booking alert email sent! Check your inbox or Spam.`);
      } else {
        showNotification(data.error || 'Failed to send test email.');
      }
    } catch (err: any) {
      showNotification('Test request failed: ' + (err.message || 'Unknown network error'));
    } finally {
      setIsSendingTestEmail(false);
    }
  };

  // ---------------------------------------------------------
  // FORMAL PIN AUTHENTICATION HANDLERS (Verified Server-Side via .env ADMIN_PIN)
  // ---------------------------------------------------------
  const verifyPin = async (candidatePin: string) => {
    const cleanPin = candidatePin.trim();
    if (!cleanPin || isVerifyingPin) return;

    setIsVerifyingPin(true);
    setAuthError(null);
    try {
      const res = await fetch('/api/admin/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: cleanPin }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok && data.verified) {
        try {
          sessionStorage.setItem(AUTH_STORAGE_KEY, 'true');
          sessionStorage.setItem(ADMIN_PIN_STORAGE_KEY, cleanPin);
        } catch (err) {
          console.error('Failed to write to sessionStorage:', err);
        }
        setActiveAdminPin(cleanPin);
        setIsAuthenticated(true);
        setPin('');
        setAuthError(null);
        showNotification('Access granted. Fetching full unmasked bookings...');
      } else {
        setIsShaking(true);
        setAuthError(data.error || 'Incorrect PIN. Please try again.');
        setTimeout(() => {
          setPin('');
          setIsShaking(false);
          pinInputRef.current?.focus();
        }, 550);
      }
    } catch (err: any) {
      setIsShaking(true);
      setAuthError(err?.message || 'Unable to verify PIN. Please check your connection.');
      setTimeout(() => {
        setPin('');
        setIsShaking(false);
        pinInputRef.current?.focus();
      }, 550);
    } finally {
      setIsVerifyingPin(false);
    }
  };

  const handlePinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const numeric = e.target.value.replace(/\D/g, '').slice(0, 4);
    setPin(numeric);
    setAuthError(null);
    if (numeric.length === 4) {
      verifyPin(numeric);
    }
  };

  const handleUnlockSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    verifyPin(pin);
  };

  const handleLogout = () => {
    try {
      sessionStorage.removeItem(AUTH_STORAGE_KEY);
      sessionStorage.removeItem(ADMIN_PIN_STORAGE_KEY);
    } catch (err) {
      console.error('Failed to clear sessionStorage:', err);
    }
    setIsAuthenticated(false);
    setIsUnmaskedLoaded(false);
    setActiveAdminPin('');
    setPin('');
    setAuthError(null);
    showNotification('Session locked. Admin PIN required.');
  };

  // Fetch full unmasked bookings using the verified Admin PIN
  const loadUnmaskedBookings = async (silent = false, forceRefresh = false) => {
    if (!isAuthenticated) return;
    if (!silent) setIsLoadingUnmasked(true);
    try {
      const pinToUse = (activeAdminPin || sessionStorage.getItem(ADMIN_PIN_STORAGE_KEY) || '').trim();
      const unmasked = await fetchUnmaskedAdminBookings(pinToUse, 100, 1, forceRefresh);
      setLocalBookings(unmasked);
      setIsUnmaskedLoaded(true);
      if (!silent) {
        showNotification(`✓ ${unmasked.length} booking records loaded with unmasked details.`);
      }
    } catch (err: any) {
      console.error('Failed to load unmasked bookings:', err);
      showNotification('Failed to retrieve unmasked details: ' + (err.message || 'Unknown error'));
    } finally {
      if (!silent) setIsLoadingUnmasked(false);
    }
  };

  // Lazy-load payment receipt on-demand when the user clicks [Receipt]
  const handleOpenReceipt = async (booking: ConfirmedBooking) => {
    setActiveReceiptBooking(booking);
    setReceiptError(null);

    // If the booking already has a non-empty image URL that is not a heavy binary placeholder
    if (booking.paymentProofUrl && !booking.paymentProofUrl.startsWith('data:') && booking.paymentProofUrl.length > 5) {
      setReceiptImageUrl(booking.paymentProofUrl);
      setIsLoadingReceipt(false);
      return;
    }

    setIsLoadingReceipt(true);
    setReceiptImageUrl(null);
    try {
      const pinToUse = (activeAdminPin || sessionStorage.getItem(ADMIN_PIN_STORAGE_KEY) || '').trim();
      const idOrRef = booking.bookingReference || booking.id || '';
      const proofUrl = await fetchBookingReceipt(idOrRef, pinToUse);
      if (proofUrl) {
        setReceiptImageUrl(proofUrl);
      } else {
        setReceiptError('No receipt image was attached to this reservation.');
      }
    } catch (err: any) {
      setReceiptError(err.message || 'Failed to download receipt image.');
    } finally {
      setIsLoadingReceipt(false);
    }
  };

  const handleCloseReceipt = () => {
    setActiveReceiptBooking(null);
    setReceiptImageUrl(null);
    setIsLoadingReceipt(false);
    setReceiptError(null);
  };

  // Automatically fetch unmasked booking details once unlocked and stay event-synced with Admin PIN
  useEffect(() => {
    if (!isAuthenticated) return;

    const pinToUse = (activeAdminPin || sessionStorage.getItem(ADMIN_PIN_STORAGE_KEY) || '').trim();
    if (!pinToUse) {
      handleLogout();
      return;
    }

    setIsLoadingUnmasked(true);
    const unsubscribe = subscribeToBookings(
      (unmaskedBookings) => {
        setLocalBookings(unmaskedBookings);
        setIsUnmaskedLoaded(true);
        setIsLoadingUnmasked(false);
      },
      (err) => {
        console.warn('Event-driven unmasked bookings sync notice:', err);
        setIsLoadingUnmasked(false);
      },
      { adminPin: pinToUse, maxLimit: 100 }
    );

    return () => {
      unsubscribe();
    };
  }, [isAuthenticated, activeAdminPin]);

  useEffect(() => {
    if (!isAuthenticated) {
      pinInputRef.current?.focus();
    }
  }, [isAuthenticated]);

  // ---------------------------------------------------------
  // TODAY'S DATE REFERENCE
  // ---------------------------------------------------------
  const todayStr = getTodayDateString();

  // ---------------------------------------------------------
  // CATEGORY METRIC COUNTS
  // ---------------------------------------------------------
  const todayBookingsCount = useMemo(() => {
    return localBookings.filter((b) => b.selectedDate === todayStr).length;
  }, [localBookings, todayStr]);

  const upcomingBookingsCount = useMemo(() => {
    return localBookings.filter((b) => (b.selectedDate || '') > todayStr).length;
  }, [localBookings, todayStr]);

  const pastBookingsCount = useMemo(() => {
    return localBookings.filter((b) => (b.selectedDate || '') < todayStr).length;
  }, [localBookings, todayStr]);

  // ---------------------------------------------------------
  // FILTER AND CHRONOLOGICALLY SORT BOOKINGS
  // Places the most present schedule of booking at the top,
  // followed by upcoming, and past booking schedules at the bottom.
  // ---------------------------------------------------------
  const filteredBookings = useMemo(() => {
    // 1. Filter
    const filtered = localBookings.filter((booking) => {
      // Category filter
      if (filterCategory === 'today' && booking.selectedDate !== todayStr) {
        return false;
      }
      if (filterCategory === 'upcoming' && (booking.selectedDate || '') <= todayStr) {
        return false;
      }
      if (filterCategory === 'past' && (booking.selectedDate || '') >= todayStr) {
        return false;
      }

      // Specific Date filter
      const matchesDate =
        filterDate === 'all' || booking.selectedDate === filterDate;
      if (!matchesDate) {
        return false;
      }

      // Search query filter (debounced)
      const query = debouncedSearchTerm.toLowerCase().trim();
      if (!query) {
        return true;
      }

      return (
        (booking.bookingReference || '').toLowerCase().includes(query) ||
        (booking.customer?.fullName || '').toLowerCase().includes(query) ||
        (booking.customer?.phoneNumber || '').toLowerCase().includes(query) ||
        (booking.selectedDate || '').toLowerCase().includes(query) ||
        (booking.customer?.notes || '').toLowerCase().includes(query)
      );
    });

    // Helper: extract earliest start time from reserved slots
    const getStartTime = (b: ConfirmedBooking): string => {
      if (!b.slots || b.slots.length === 0) return '00:00';
      const times: string[] = [];
      for (const s of b.slots) {
        if (s.timeLabel) {
          const match = s.timeLabel.match(/^(\d{1,2}:\d{2})/);
          if (match) {
            const [h, m] = match[1].split(':');
            times.push(`${h.padStart(2, '0')}:${m}`);
          }
        }
      }
      if (times.length === 0) return '00:00';
      times.sort();
      return times[0];
    };

    // 2. Sort chronologically
    return [...filtered].sort((a, b) => {
      const dateA = a.selectedDate || '';
      const dateB = b.selectedDate || '';
      const timeA = getStartTime(a);
      const timeB = getStartTime(b);

      if (sortOrder === 'present-first') {
        // Primary: Most present schedule of booking is placed at the top,
        // and the past booking schedules at the bottom.
        // Rank 0: Today (the most present schedule)
        // Rank 1: Upcoming (future schedules in chronological order)
        // Rank 2: Past (past schedules in reverse chronological order)
        const getRank = (d: string) => {
          if (d === todayStr) return 0;
          if (d > todayStr) return 1;
          return 2;
        };

        const rankA = getRank(dateA);
        const rankB = getRank(dateB);

        if (rankA !== rankB) {
          return rankA - rankB;
        }

        // Within Today (rank 0): chronological by slot time (08:00 -> 24:00)
        if (rankA === 0) {
          if (timeA !== timeB) return timeA.localeCompare(timeB);
          return (b.confirmedAt || b.createdAt || b.bookingReference).localeCompare(a.confirmedAt || a.createdAt || a.bookingReference);
        }

        // Within Upcoming (rank 1): chronological by date ascending, then slot time
        if (rankA === 1) {
          if (dateA !== dateB) return dateA.localeCompare(dateB);
          if (timeA !== timeB) return timeA.localeCompare(timeB);
          return (b.confirmedAt || b.createdAt || b.bookingReference).localeCompare(a.confirmedAt || a.createdAt || a.bookingReference);
        }

        // Within Past (rank 2): most recent past day first down to older past dates
        if (dateA !== dateB) return dateB.localeCompare(dateA);
        if (timeA !== timeB) return timeA.localeCompare(timeB);
        return (b.confirmedAt || b.createdAt || b.bookingReference).localeCompare(a.confirmedAt || a.createdAt || a.bookingReference);
      }

      if (sortOrder === 'newest-first') {
        // Date descending, then time
        if (dateA !== dateB) return dateB.localeCompare(dateA);
        if (timeA !== timeB) return timeB.localeCompare(timeA);
        return (b.confirmedAt || b.createdAt || b.bookingReference).localeCompare(a.confirmedAt || a.createdAt || a.bookingReference);
      }

      // 'oldest-first'
      if (dateA !== dateB) return dateA.localeCompare(dateB);
      if (timeA !== timeB) return timeA.localeCompare(timeB);
      return (a.confirmedAt || a.createdAt || a.bookingReference).localeCompare(b.confirmedAt || b.createdAt || b.bookingReference);
    });
  }, [localBookings, filterCategory, filterDate, debouncedSearchTerm, sortOrder, todayStr]);

  // Reset pagination to first page whenever search or filter criteria change
  useEffect(() => {
    setCurrentPage(1);
  }, [filterCategory, filterDate, debouncedSearchTerm, sortOrder]);

  const totalPages = Math.max(1, Math.ceil(filteredBookings.length / itemsPerPage));
  const paginatedBookings = useMemo(() => {
    if (itemsPerPage >= 999) return filteredBookings;
    const from = (currentPage - 1) * itemsPerPage;
    return filteredBookings.slice(from, from + itemsPerPage);
  }, [filteredBookings, currentPage, itemsPerPage]);

  // ---------------------------------------------------------
  // CALCULATE METRICS
  // ---------------------------------------------------------
  const totalRevenue = localBookings.reduce(
    (sum, booking) => sum + (Number(booking.totalAmount) || 0),
    0
  );

  const totalSlotsCount = localBookings.reduce(
    (sum, booking) => sum + (booking.slots?.length || 0),
    0
  );

  // ---------------------------------------------------------
  // DISTINCT DATES (Sorted descending: most present date first)
  // ---------------------------------------------------------
  const uniqueDates = Array.from(
    new Set(
      localBookings
        .map((booking) => booking.selectedDate)
        .filter(Boolean)
    )
  ).sort((a, b) => b.localeCompare(a));

  // ---------------------------------------------------------
  // DELETE BOOKING (With Optimistic UI Update & Rollback)
  // ---------------------------------------------------------
  const handleDeleteBooking = (booking: ConfirmedBooking) => {
    setBookingToDelete(booking);
  };

  const confirmDeleteBooking = async () => {
    if (!bookingToDelete) return;
    const target = bookingToDelete;
    const bookingRef = target.bookingReference || target.id;
    if (!bookingRef) {
      showNotification('Unable to delete: booking reference is missing.');
      setBookingToDelete(null);
      return;
    }

    setBookingToDelete(null);

    // Snapshot previous state for rollback on error
    const previousState = localBookings;

    // 1. Optimistic removal: instantly vanishes from UI
    setLocalBookings((prev) => prev.filter((b) => b.bookingReference !== bookingRef && b.id !== bookingRef));
    setDeletingBookingId(bookingRef);

    try {
      // 2. Perform server delete with Admin PIN
      await deleteBookingFromFirestore(bookingRef, activeAdminPin);
      showNotification(`Reservation #${target.bookingReference} was deleted successfully.`);
    } catch (error) {
      console.error('Error deleting booking:', error);
      // 3. Rollback on network failure
      setLocalBookings(previousState);
      showNotification('Failed to delete booking. Please check your connection and try again.');
    } finally {
      setDeletingBookingId(null);
    }
  };

  // ---------------------------------------------------------
  // UPDATE / EDIT BOOKING (With Optimistic UI Update)
  // ---------------------------------------------------------
  const handleSaveEdit = async (
    bookingId: string,
    updates: {
      fullName: string;
      phoneNumber: string;
      selectedDate: string;
      status: string;
      totalAmount: number;
      notes?: string;
      slots?: ConfirmedBooking['slots'];
    }
  ) => {
    const idToUpdate = bookingId || editingBooking?.bookingReference || editingBooking?.id || '';
    if (!idToUpdate) {
      throw new Error('Missing booking reference/ID for update.');
    }

    // 0. Live verification: ensure edited slots are not occupied by another booking
    if (updates.slots && updates.slots.length > 0) {
      const check = await validateSlotsLiveAvailability(updates.slots, updates.selectedDate, idToUpdate);
      if (!check.isAvailable) {
        showNotification(`⚠️ Slot Conflict: ${check.conflictReason}`);
        throw new Error(check.conflictReason);
      }
    }

    // 1. Optimistic local update
    const previousState = localBookings;
    setLocalBookings((prev) =>
      prev.map((b) => {
        if (b.id === idToUpdate || b.bookingReference === idToUpdate) {
          return {
            ...b,
            customer: {
              ...b.customer,
              fullName: updates.fullName,
              phoneNumber: updates.phoneNumber,
              notes: updates.notes !== undefined ? updates.notes : b.customer.notes,
            },
            selectedDate: updates.selectedDate,
            status: updates.status,
            totalAmount: updates.totalAmount,
            slots: updates.slots || b.slots,
          };
        }
        return b;
      })
    );

    try {
      // 2. Persist to Firestore with Admin PIN
      await updateBookingInFirestore(idToUpdate, updates, activeAdminPin);
      showNotification(`Reservation #${editingBooking?.bookingReference || idToUpdate} updated successfully.`);
    } catch (error) {
      // Rollback on failure
      setLocalBookings(previousState);
      throw error;
    }
  };

  // ---------------------------------------------------------
  // FORMAT CURRENCY
  // ---------------------------------------------------------
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-PH', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount);
  };

  // ---------------------------------------------------------
  // EXPORT TO CSV FILE
  // ---------------------------------------------------------
  const handleExportCSV = (exportFilteredOnly: boolean = false) => {
    const listToExport = exportFilteredOnly
      ? filteredBookings
      : (localBookings.length > 0 ? localBookings : persistedBookings);

    if (!listToExport || listToExport.length === 0) {
      showNotification('⚠️ No bookings available to export.');
      return;
    }

    const headers = [
      'Booking Reference',
      'Reservation Date',
      'Status',
      'Player Name',
      'Phone Number',
      'Email',
      'Court Slots Booked',
      'Total Slots / Hours',
      'Total Amount (PHP)',
      'Payment Method',
      'Receipt URL',
      'Customer Notes',
      'Confirmed / Created At',
    ];

    const escapeCSV = (value: string | number | undefined | null): string => {
      if (value === undefined || value === null) return '""';
      const str = String(value).replace(/"/g, '""');
      return `"${str}"`;
    };

    const rows = listToExport.map((b) => {
      const slotsDesc = (b.slots || [])
        .map((s) => `${s.courtName || s.courtId} (${s.timeLabel})`)
        .join('; ');
      const totalSlots = (b.slots || []).length;

      return [
        escapeCSV(b.bookingReference || b.id),
        escapeCSV(b.selectedDate),
        escapeCSV(b.status || 'BOOKED'),
        escapeCSV(b.customer?.fullName || ''),
        escapeCSV(b.customer?.phoneNumber || ''),
        escapeCSV(b.customer?.email || ''),
        escapeCSV(slotsDesc),
        escapeCSV(totalSlots),
        escapeCSV(b.totalAmount || 0),
        escapeCSV(b.paymentMethod || 'GCash'),
        escapeCSV(b.paymentProofUrl || ''),
        escapeCSV(b.customer?.notes || ''),
        escapeCSV(b.confirmedAt || b.createdAt || b.bookedAt || ''),
      ].join(',');
    });

    // Prepend UTF-8 BOM (\uFEFF) for full Excel and Google Sheets character fidelity
    const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const nowYmd = new Date().toISOString().split('T')[0];
    const filename = `matchsip-bookings-${nowYmd}.csv`;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showNotification(`📄 Successfully exported ${listToExport.length} booking record(s) to CSV!`);
  };

  // =========================================================
  // FORMAL ADMIN PIN SCREEN (When not authenticated)
  // =========================================================
  if (!isAuthenticated) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[#5E2CB2] px-4 py-8 relative selection:bg-transparent">
        {/* Centered Formal PIN Card */}
        <div className="w-full max-w-[420px] rounded-[2.5rem] border border-white/15 bg-white/5 p-8 sm:p-10 shadow-2xl backdrop-blur-md transition-all">
          {/* Brand Logo Header: Cyan dot + MATCH&SIP */}
          <div className="flex items-center gap-3">
            <span className="h-4 w-4 rounded-full bg-[#00C6FF] shadow-sm shadow-[#00C6FF]/60" />
            <span className="font-heading text-xl sm:text-2xl font-black uppercase tracking-tight text-white">
              MATCH<span className="text-[#00C6FF]">&amp;</span>SIP
            </span>
          </div>

          {/* Eyebrow Label */}
          <div className="mt-8 mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-[0.25em] text-[#00C6FF]">
            <span>RESTRICTED</span>
            <span className="text-white/40">·</span>
            <span>ADMIN</span>
          </div>

          {/* Heading */}
          <h1 className="font-heading text-2xl sm:text-3xl font-black uppercase tracking-tight text-white leading-[1.15] mb-8">
            ENTER PIN TO VIEW<br />BOOKINGS
          </h1>

          {/* Form */}
          <form onSubmit={handleUnlockSubmit} className="space-y-6">
            {/* PIN Display Box with Circles & Dynamic Blinking Cursor */}
            <PinCodeInput
              pin={pin}
              onChange={(newPin) => {
                setPin(newPin);
                setAuthError(null);
              }}
              onSubmit={(pinToVerify) => verifyPin(pinToVerify)}
              inputRef={pinInputRef}
              isShaking={isShaking}
              autoFocus={true}
              id="admin-pin-input"
            />

            {/* Error Feedback */}
            {authError && (
              <div
                role="alert"
                className="text-center text-xs font-bold text-red-300 animate-in fade-in -mt-2"
              >
                {authError}
              </div>
            )}

            {/* Solid Electric Cyan UNLOCK Button */}
            <button
              type="submit"
              id="admin-pin-unlock-btn"
              disabled={isVerifyingPin}
              className="w-full rounded-xl bg-[#00C6FF] py-4 text-center font-heading text-base sm:text-lg font-black uppercase tracking-wider text-black shadow-lg shadow-[#00C6FF]/20 transition-all hover:bg-[#00C6FF]/90 active:scale-[0.99] cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isVerifyingPin ? 'VERIFYING...' : 'UNLOCK'}
            </button>
          </form>
        </div>

        {/* Floating Toast Notification */}
        {toastNotification && (
          <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-xl border border-[#00C6FF]/60 bg-[#4A1E94] px-4 py-3 text-xs font-bold text-white shadow-2xl shadow-[#00C6FF]/30 backdrop-blur-md animate-in fade-in slide-in-from-bottom-3">
            <span className="h-2 w-2 rounded-full bg-[#00C6FF] animate-ping" />
            <span>{toastNotification}</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col flex-1 bg-[#5E2CB2] text-[#FFFFFF]">

      {/* =====================================================
          TOP HEADER & NAVIGATION
      ====================================================== */}
      <div className="w-full border-b border-[#B3A2DB]/30 bg-[#5E2CB2] py-4">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">

          <div className="flex items-center gap-3 ml-auto justify-end flex-wrap">
            {/* TEST ALERT EMAIL BUTTON */}
            <button
              type="button"
              disabled={isSendingTestEmail}
              onClick={handleSendTestEmail}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-purple-300/40 bg-white/10 px-3.5 py-1.5 text-xs font-bold text-white transition-all hover:bg-white/20 shadow-sm disabled:opacity-50"
              title="Send a test booking notification email to admins"
            >
              <Mail className={`h-4 w-4 ${isSendingTestEmail ? 'animate-spin text-[#00C6FF]' : 'text-[#00C6FF]'}`} />
              <span>{isSendingTestEmail ? 'Sending...' : 'Test Alert Email'}</span>
            </button>

            {/* MANUAL REFRESH UNMASKED DETAILS BUTTON */}
            <button
              type="button"
              disabled={isLoadingUnmasked}
              onClick={() => {
                invalidateUnmaskedBookingsCache();
                loadUnmaskedBookings(false, true);
              }}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3.5 py-1.5 text-xs font-bold text-white transition-all hover:bg-white/20 shadow-sm disabled:opacity-50"
              title="Refresh full unmasked booking details from database"
            >
              <RefreshCw className={`h-4 w-4 ${isLoadingUnmasked ? 'animate-spin' : ''}`} />
              <span>{isLoadingUnmasked ? 'Refreshing...' : 'Refresh Details'}</span>
            </button>

            {/* LOCK / LOGOUT BUTTON */}
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-red-400/40 bg-red-500/15 px-3.5 py-1.5 text-xs font-bold text-red-200 transition-all hover:bg-red-500/25 hover:border-red-400/60"
              title="Lock and logout of booking management"
            >
              <Lock className="h-4 w-4" />
              <span>Logout</span>
            </button>

            <button
              type="button"
              onClick={() => navigate('/')}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-[#00C6FF] px-4 py-1.5 text-xs font-black uppercase tracking-wider text-black shadow-md transition-all hover:bg-[#00C6FF]/90"
            >
              <PlusCircle className="h-4 w-4" />
              <span>Book A Court</span>
            </button>
          </div>
        </div>
      </div>

      {/* =====================================================
          MAIN PAGE HEADER
      ====================================================== */}
      <div className="w-full border-b border-[#B3A2DB]/20 bg-[#5E2CB2] px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
        <div className="mx-auto max-w-7xl">

          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">

            <div>
              <h1 className="font-heading text-3xl font-black uppercase tracking-tight text-white sm:text-4xl lg:text-5xl">
                SAVED BOOKINGS
              </h1>

              <p className="mt-2 max-w-2xl text-xs text-[#B3A2DB] sm:text-sm">
                Confirmed court reservations stored securely in Cloud
                SQL. Filter by player, date, or booking reference code,
                and view InstaPay payment receipts.
              </p>

            </div>

            {/* QUICK METRICS */}
            <div className="grid grid-cols-3 gap-3 self-start md:self-auto">

              <div className="min-w-[90px] rounded-2xl border border-[#B3A2DB]/30 bg-white/5 p-3 text-center sm:p-4">
                <span className="block text-[10px] font-bold uppercase tracking-wider text-[#B3A2DB]">
                  Bookings
                </span>

                <span className="font-heading text-xl font-black text-white sm:text-2xl">
                  {localBookings.length}
                </span>
              </div>

              <div className="min-w-[90px] rounded-2xl border border-[#B3A2DB]/30 bg-white/5 p-3 text-center sm:p-4">
                <span className="block text-[10px] font-bold uppercase tracking-wider text-[#B3A2DB]">
                  Slots
                </span>

                <span className="font-heading text-xl font-black text-white sm:text-2xl">
                  {totalSlotsCount}
                </span>
              </div>

              <div className="min-w-[90px] rounded-2xl border border-[#B3A2DB]/30 bg-white/5 p-3 text-center sm:p-4">
                <span className="block text-[10px] font-bold uppercase tracking-wider text-[#B3A2DB]">
                  Total
                </span>

                <span className="font-heading text-xl font-black text-emerald-400 sm:text-2xl">
                  ₱{formatCurrency(totalRevenue)}
                </span>
              </div>

            </div>
          </div>
        </div>
      </div>

      {/* =====================================================
          CONTENT AREA
      ====================================================== */}
      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-4 py-8 sm:px-6 lg:px-8">

        {/* ===================================================
            SEARCH & FILTER BAR
        ==================================================== */}
        <div className="mb-8 space-y-4">
          <div className="flex flex-col items-stretch justify-between gap-4 lg:flex-row lg:items-center">

            {/* SEARCH */}
            <div className="relative max-w-md flex-1">
              <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#B3A2DB]" />
              <input
                type="text"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search reference #, player name, phone..."
                className="w-full rounded-full border border-[#B3A2DB]/40 bg-white/10 py-2.5 pl-10 pr-10 text-xs font-medium text-white shadow-inner transition-all placeholder:text-[#B3A2DB]/60 focus:border-[#00C6FF] focus:bg-white/15 focus:outline-none sm:text-sm"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/50 transition-colors hover:text-white"
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* SCHEDULE CATEGORY TABS & CALENDAR BUTTON */}
          <div className="flex flex-col gap-2.5 pt-1 border-t border-white/10">
            {/* Category Tabs and Calendar Button */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1 flex-wrap sm:flex-nowrap">
              {/* 1. TODAY'S SCHEDULE FIRST */}
              <button
                type="button"
                onClick={() => {
                  setFilterCategory('today');
                  setFilterDate('all');
                }}
                className={`cursor-pointer whitespace-nowrap rounded-full px-4 py-1.5 text-xs font-black uppercase tracking-wider transition-colors flex items-center gap-1.5 ${
                  filterCategory === 'today'
                    ? 'bg-white text-[#4A1E94] shadow-sm'
                    : 'bg-white/10 text-white hover:bg-white/20'
                }`}
              >
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                <span>Today's Schedule ({todayBookingsCount})</span>
              </button>

              {/* 2. ALL BOOKINGS */}
              <button
                type="button"
                onClick={() => {
                  setFilterCategory('all');
                  setFilterDate('all');
                }}
                className={`cursor-pointer whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-black uppercase tracking-wider transition-colors ${
                  filterCategory === 'all' && filterDate === 'all'
                    ? 'bg-white text-[#4A1E94] shadow-sm'
                    : 'bg-white/10 text-white hover:bg-white/20'
                }`}
              >
                All Bookings ({persistedBookings.length})
              </button>

              {/* 3. UPCOMING SCHEDULES */}
              <button
                type="button"
                onClick={() => {
                  setFilterCategory('upcoming');
                  setFilterDate('all');
                }}
                className={`cursor-pointer whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-black uppercase tracking-wider transition-colors ${
                  filterCategory === 'upcoming'
                    ? 'bg-white text-[#4A1E94] shadow-sm'
                    : 'bg-white/10 text-white hover:bg-white/20'
                }`}
              >
                Upcoming ({upcomingBookingsCount})
              </button>

              {/* CALENDAR BUTTON TO VIEW CALENDAR & NAVIGATE PAST BOOKINGS */}
              <button
                type="button"
                onClick={() => setIsCalendarOpen(true)}
                className={`cursor-pointer whitespace-nowrap rounded-full px-4 py-1.5 text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2 border shadow-sm ${
                  filterDate !== 'all'
                    ? 'bg-white text-[#4A1E94] border-white shadow-sm scale-[1.02]'
                    : 'bg-white/10 text-white border-white/20 hover:bg-white/20'
                }`}
                title="Open calendar to view and navigate past bookings by date"
                aria-label="Open Calendar"
              >
                <Calendar className={`h-3.5 w-3.5 ${filterDate !== 'all' ? 'text-[#4A1E94]' : 'text-white/80'}`} />
                <span>
                  {filterDate !== 'all' ? `Date: ${formatDateToDDMMYYYY(filterDate)}` : 'Calendar & Past Dates'}
                </span>
                {filterDate !== 'all' && (
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      setFilterDate('all');
                    }}
                    className="ml-0.5 rounded-full bg-black/10 hover:bg-black/20 p-0.5 text-[#4A1E94] cursor-pointer"
                    title="Clear date filter"
                  >
                    <X className="h-3 w-3" />
                  </span>
                )}
              </button>

              {/* EXPORT TO CSV BUTTON */}
              <button
                type="button"
                onClick={() => handleExportCSV(false)}
                className="cursor-pointer whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-black uppercase tracking-wider transition-all flex items-center gap-1.5 bg-white/10 border border-white/20 text-white hover:bg-white/20 shadow-sm ml-auto"
                title="Export all existing bookings in the App to a CSV file"
              >
                <Download className="h-3.5 w-3.5 text-white/80" />
                <span>Export CSV ({localBookings.length || persistedBookings.length})</span>
              </button>

              {/* QUICK ADD BOOKING RECORD BUTTON */}
              <button
                type="button"
                onClick={() => setIsAddBookingOpen(true)}
                className="cursor-pointer whitespace-nowrap rounded-full px-4 py-1.5 text-xs font-black uppercase tracking-wider transition-all flex items-center gap-1.5 bg-emerald-400/20 border border-emerald-400/60 text-emerald-300 hover:bg-emerald-400/35 hover:text-white shadow-sm"
                title="Add a manual booking record"
              >
                <PlusCircle className="h-3.5 w-3.5 text-emerald-400" />
                <span>Add Record</span>
              </button>
            </div>

            {/* Active Date Filter Banner */}
            {filterDate !== 'all' && (
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/20 bg-white/10 px-4 py-2 text-xs text-white">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-white/80" />
                  <span className="text-[#B3A2DB]">Viewing Bookings for:</span>
                  <strong className="text-white font-black">{formatDateToFullReadable(filterDate)}</strong>
                  <span className="text-white/80 font-semibold">
                    ({filteredBookings.length} {filteredBookings.length === 1 ? 'booking' : 'bookings'} found)
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setFilterDate('all')}
                  className="inline-flex items-center gap-1 font-bold text-xs text-white hover:underline cursor-pointer"
                >
                  <X className="h-3 w-3" />
                  <span>Show All</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ===================================================
            LOADING STATE
        ==================================================== */}
        {isLoadingBookings || (isLoadingUnmasked && localBookings.length === 0) ? (

          <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">

            <RefreshCw className="h-8 w-8 animate-spin text-[#00C6FF]" />

            <span className="text-sm font-bold text-[#B3A2DB]">
              Loading confirmed reservations with full unmasked details...
            </span>

          </div>

        ) : filteredBookings.length === 0 ? (

          /* =================================================
             EMPTY STATE
          ================================================== */
          <div className="mx-auto my-8 max-w-xl rounded-3xl border-2 border-dashed border-[#B3A2DB]/40 bg-white/5 p-12 text-center sm:p-16">

            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/10 text-[#00C6FF]">
              <Database className="h-8 w-8" />
            </div>

            <h2 className="font-heading text-xl font-black uppercase text-white sm:text-2xl">
              {filterCategory === 'today'
                ? "No Bookings for Today Yet"
                : searchTerm || filterDate !== 'all'
                ? 'No Matching Bookings'
                : 'No Saved Bookings Yet'}
            </h2>

            <p className="mx-auto mt-2 max-w-md text-xs text-[#B3A2DB] sm:text-sm">
              {filterCategory === 'today'
                ? `No court reservations scheduled for today (${formatDateToFullReadable(todayStr)}). You can switch to All Bookings or Upcoming to view other scheduled slots.`
                : searchTerm || filterDate !== 'all'
                ? 'Try adjusting your search criteria or resetting date filters.'
                : 'When players select court slots and confirm their reservations via InstaPay, they will appear here in real-time.'}
            </p>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">

              {/* DIRECT ADD RECORD BUTTON IN EMPTY STATE */}
              <button
                type="button"
                onClick={() => setIsAddBookingOpen(true)}
                className="cursor-pointer rounded-full bg-emerald-400 border border-emerald-300 px-5 py-2 text-xs font-black uppercase tracking-wider text-black shadow-lg shadow-emerald-400/25 transition-transform hover:scale-105 active:scale-95 flex items-center gap-1.5"
              >
                <PlusCircle className="h-4 w-4" />
                <span>Add A Booking Record</span>
              </button>

              {filterCategory === 'today' && persistedBookings.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setFilterCategory('all');
                    setFilterDate('all');
                  }}
                  className="cursor-pointer rounded-full bg-[#00C6FF] px-5 py-2 text-xs font-black uppercase text-black transition-transform hover:scale-105 shadow-md shadow-[#00C6FF]/30"
                >
                  View All Bookings ({persistedBookings.length})
                </button>
              )}

              {(searchTerm || filterDate !== 'all') && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchTerm('');
                    setFilterDate('all');
                  }}
                  className="cursor-pointer rounded-full bg-white/15 px-5 py-2 text-xs font-bold text-white transition-colors hover:bg-white/25"
                >
                  Clear Filters
                </button>
              )}

              <button
                type="button"
                onClick={() => navigate('/')}
                className="cursor-pointer rounded-full bg-white/10 border border-white/20 px-6 py-2 text-xs font-bold uppercase tracking-wider text-white transition-all hover:bg-white/20"
              >
                Go to Court Booking Matrix
              </button>

            </div>

          </div>

        ) : (
          <>
            {/* =================================================
               BOOKINGS GRID
            ================================================== */}
            <div className="grid grid-cols-1 gap-6 pb-12 md:grid-cols-2 lg:grid-cols-3">

            {paginatedBookings.map((booking) => {

              const bookingId = booking.id || '';
              const isDeleting = deletingBookingId === bookingId;

              return (
                <div
                  key={booking.id || booking.bookingReference}
                  className="flex flex-col justify-between rounded-3xl border border-[#B3A2DB]/40 bg-white p-6 text-[#5E2CB2] shadow-xl transition-all hover:shadow-2xl"
                >

                  {/* =========================================
                      BOOKING INFORMATION
                  ========================================== */}
                  <div>

                    {/* TOP BAR */}
                    <div className="flex items-center justify-between gap-2 border-b-2 border-[#B3A2DB]/20 pb-3">

                      <span className="min-w-0 flex-1 truncate font-mono text-xs font-black tracking-wider text-[#5E2CB2]">
                        #{booking.bookingReference}
                      </span>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase ${
                          booking.status === 'BOOKED' || booking.status === 'CONFIRMED' || booking.status === 'VERIFIED'
                            ? 'border-emerald-300 bg-emerald-100 text-emerald-800'
                            : 'border-amber-300 bg-amber-100 text-amber-800'
                        }`}>
                          <CheckCircle2 className="h-3 w-3" />
                          <span>{booking.status || 'BOOKED'}</span>
                        </span>

                        {/* RESEND EMAIL NOTIFICATION BUTTON */}
                        <button
                          type="button"
                          disabled={sendingEmailBookingId === booking.bookingReference}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSendNotificationEmail(booking);
                          }}
                          className="p-1.5 rounded-lg text-[#5E2CB2] hover:bg-[#5E2CB2]/10 transition-colors cursor-pointer disabled:opacity-40"
                          title="Send Email Notification to Admin"
                          aria-label="Send Email Notification"
                        >
                          {sendingEmailBookingId === booking.bookingReference ? (
                            <RefreshCw className="w-4 h-4 animate-spin text-[#00C6FF]" />
                          ) : (
                            <Mail className="w-4 h-4" />
                          )}
                        </button>

                        {/* EDIT BUTTON */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingBooking(booking);
                          }}
                          className="p-1.5 rounded-lg text-[#5E2CB2] hover:bg-[#5E2CB2]/10 transition-colors cursor-pointer"
                          title="Edit Booking"
                          aria-label="Edit Booking"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>

                        {/* DELETE BUTTON */}
                        <button
                          type="button"
                          id={`delete-booking-${booking.bookingReference}`}
                          disabled={isDeleting}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteBooking(booking);
                          }}
                          className="p-1.5 sm:p-2 rounded-xl text-red-500 hover:text-white bg-red-500/10 hover:bg-red-500 border border-red-500/20 hover:border-red-500/40 transition-all duration-150 active:scale-95 cursor-pointer disabled:opacity-40 shadow-sm flex items-center justify-center shrink-0"
                          title="Delete Reservation"
                          aria-label="Delete Reservation"
                        >
                          {isDeleting ? (
                            <RefreshCw className="w-4 h-4 animate-spin text-red-500" />
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
                        </button>
                      </div>

                    </div>

                    {/* PLAYER & CONTACT */}
                    <div className="space-y-1.5 pb-3 pt-4">

                      <div className="flex items-center gap-2">

                        <User className="h-4 w-4 shrink-0 text-[#5E2CB2]" />

                        <span className="truncate font-heading text-base font-black text-[#5E2CB2]">
                          {booking.customer?.fullName || 'Unknown Player'}
                        </span>

                      </div>

                      <div className="flex items-center gap-2 text-xs font-medium text-[#5E2CB2]/80">

                        <Phone className="h-3.5 w-3.5 shrink-0 text-[#5E2CB2]/70" />

                        <span>
                          {booking.customer?.phoneNumber || 'No phone number'}
                        </span>

                      </div>

                      {/* CONFIRMED TIMESTAMP */}
                      <div className="flex items-center gap-2 text-[11px] font-semibold text-[#5E2CB2]/75 pt-0.5">

                        <Clock className="h-3.5 w-3.5 shrink-0 text-[#5E2CB2]/60" />

                        <span>Confirmed:</span>

                        <span className="font-mono text-[#5E2CB2] font-bold">
                          {formatConfirmedTimestamp(booking.confirmedAt || booking.createdAt)}
                        </span>

                      </div>

                    </div>

                    {/* DATE & RESERVED SLOTS */}
                    <div className="mt-2 border-t border-[#B3A2DB]/20 pt-3">

                      <div className="mb-2 flex items-center justify-between text-xs font-bold text-[#5E2CB2]/80 gap-2 flex-wrap">

                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="flex items-center gap-1.5 font-bold text-[#5E2CB2]">
                            <Calendar className="h-3.5 w-3.5 text-[#5E2CB2]" />
                            <span>
                              {booking.selectedDate || 'No date'}
                            </span>
                          </span>

                          {/* Present / Upcoming / Past Schedule Badge */}
                          {booking.selectedDate === todayStr ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-800">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                              Today's Schedule
                            </span>
                          ) : (booking.selectedDate || '') > todayStr ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-[#5E2CB2]/10 border border-[#5E2CB2]/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#5E2CB2]">
                              Upcoming
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 border border-slate-200 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                              Past Schedule
                            </span>
                          )}
                        </div>

                        <span className="rounded-full bg-[#5E2CB2]/10 px-2 py-0.5 text-[10px] font-black">
                          {booking.slots?.length || 0}{' '}
                          {(booking.slots?.length || 0) === 1
                            ? 'Slot'
                            : 'Slots'}
                        </span>

                      </div>

                      <div className="flex flex-wrap gap-1.5">

                        {booking.slots?.length ? (
                          booking.slots.map((slot, index) => (
                            <div
                              key={`${slot.slotId}-${index}`}
                              className="inline-flex items-center gap-1 rounded-lg bg-[#5E2CB2]/10 px-2.5 py-1 text-[11px] font-bold text-[#5E2CB2]"
                            >
                              <Clock className="h-3 w-3 text-[#5E2CB2]/70" />

                              <span>
                                {slot.courtName}: {slot.timeLabel.replace(/\s*-\s*/, '-')}
                              </span>
                            </div>
                          ))
                        ) : (
                          <span className="text-xs italic text-[#5E2CB2]/60">
                            No reserved slots
                          </span>
                        )}

                      </div>

                    </div>

                    {/* NOTE / SPECIAL REQUESTS */}
                    <div className="mt-3 border-t border-[#B3A2DB]/20 pt-2.5">
                      {booking.customer?.notes && booking.customer.notes.trim() ? (
                        <div
                          onClick={() => setEditingBooking(booking)}
                          title="Click to edit special requests in Modify Reservation"
                          className="group/note cursor-pointer rounded-xl bg-amber-500/10 hover:bg-amber-500/15 border border-amber-500/30 hover:border-amber-500/50 p-2.5 text-xs transition-all"
                        >
                          <div className="flex items-center justify-between gap-1.5 mb-1">
                            <div className="flex items-center gap-1.5 font-bold text-amber-800 text-[11px] uppercase tracking-wider">
                              <FileText className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                              <span>Notes / Special Requests</span>
                            </div>
                            <span className="text-[10px] text-amber-700/80 group-hover/note:text-amber-800 font-semibold opacity-0 group-hover/note:opacity-100 transition-opacity flex items-center gap-0.5">
                              <Pencil className="h-2.5 w-2.5" /> Edit
                            </span>
                          </div>
                          <p className="text-xs text-[#5E2CB2] font-semibold leading-relaxed break-words whitespace-pre-wrap pl-5">
                            {booking.customer.notes.trim()}
                          </p>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setEditingBooking(booking)}
                          title="Click to add note in Modify Reservation"
                          className="group/note flex items-center gap-1.5 text-[11px] text-[#5E2CB2]/65 hover:text-[#5E2CB2] px-1 py-0.5 transition-colors cursor-pointer text-left w-full rounded-md hover:bg-[#5E2CB2]/5"
                        >
                          <FileText className="h-3.5 w-3.5 text-[#5E2CB2]/40 group-hover/note:text-[#00C6FF] shrink-0" />
                          <span className="font-semibold text-[#5E2CB2]/75">Notes / Special Requests:</span>
                          <span className="italic text-[#5E2CB2]/50">None</span>
                          <span className="ml-auto text-[10px] font-bold text-[#0088B0] opacity-0 group-hover/note:opacity-100 transition-opacity flex items-center gap-0.5">
                            + Add note
                          </span>
                        </button>
                      )}
                    </div>

                  </div>

                  {/* =========================================
                      BOTTOM BAR
                  ========================================== */}
                  <div className="mt-5 flex items-center justify-between border-t-2 border-[#B3A2DB]/20 pt-3">

                    <div>

                      <span className="block text-[10px] font-black uppercase tracking-wider text-[#5E2CB2]/60">
                        Total Paid
                      </span>

                      <span className="font-heading text-xl font-black text-[#5E2CB2]">
                        ₱{formatCurrency(Number(booking.totalAmount) || 0)}
                      </span>

                    </div>

                    {booking.hasPaymentProof || booking.paymentProofUrl ? (

                      <button
                        type="button"
                        onClick={() => handleOpenReceipt(booking)}
                        className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-[#5E2CB2] px-3.5 py-1.5 text-xs font-bold text-white transition-all hover:bg-[#5E2CB2]/90 shadow-sm"
                        title="View InstaPay payment proof (lazy-loaded on-demand)"
                      >
                        <ExternalLink className="h-3 w-3" />
                        <span>Receipt</span>
                      </button>

                    ) : (

                      <span className="inline-flex items-center gap-1 rounded-full bg-[#007DFE]/15 text-[#007DFE] px-2.5 py-1 text-[10px] font-black uppercase">
                        {booking.paymentMethod || 'GCash (PayMongo)'}
                      </span>

                    )}

                  </div>

                </div>
              );
            })}

          </div>

          {/* =================================================
             PAGINATION CONTROLS
          ================================================== */}
          {filteredBookings.length > itemsPerPage && (
            <div className="mb-12 flex flex-col sm:flex-row items-center justify-between gap-4 rounded-3xl border border-white/20 bg-white/5 p-4 sm:p-5 text-xs text-white backdrop-blur-sm">
              <div className="text-[#B3A2DB] text-xs">
                Showing{' '}
                <strong className="text-white font-bold">
                  {(currentPage - 1) * itemsPerPage + 1}
                </strong>
                –
                <strong className="text-white font-bold">
                  {Math.min(currentPage * itemsPerPage, filteredBookings.length)}
                </strong>{' '}
                of <strong className="text-white font-bold">{filteredBookings.length}</strong> bookings
              </div>

              {/* Prev / Page / Next */}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  className="inline-flex items-center gap-1 rounded-xl border border-white/20 bg-white/10 px-3 py-1.5 font-bold text-white transition-all hover:bg-white/20 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  aria-label="Previous Page"
                >
                  <ChevronLeft className="h-4 w-4" />
                  <span className="hidden sm:inline">Prev</span>
                </button>

                <div className="flex items-center gap-1">
                  {Array.from({ length: totalPages }, (_, idx) => idx + 1)
                    .filter((p) => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
                    .map((p, i, arr) => {
                      const prev = arr[i - 1];
                      return (
                        <React.Fragment key={p}>
                          {prev && p - prev > 1 && <span className="px-1 text-white/40">…</span>}
                          <button
                            type="button"
                            onClick={() => setCurrentPage(p)}
                            className={`h-8 w-8 rounded-xl font-black text-xs transition-all cursor-pointer ${
                              currentPage === p
                                ? 'bg-[#00C6FF] text-black shadow-md shadow-[#00C6FF]/30 scale-105'
                                : 'bg-white/10 text-white hover:bg-white/20'
                            }`}
                          >
                            {p}
                          </button>
                        </React.Fragment>
                      );
                    })}
                </div>

                <button
                  type="button"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  className="inline-flex items-center gap-1 rounded-xl border border-white/20 bg-white/10 px-3 py-1.5 font-bold text-white transition-all hover:bg-white/20 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  aria-label="Next Page"
                >
                  <span className="hidden sm:inline">Next</span>
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>

              {/* Page size toggle */}
              <div className="flex items-center gap-1.5 text-[11px] text-[#B3A2DB]">
                <span>Show:</span>
                {[24, 48].map((size) => (
                  <button
                    key={size}
                    type="button"
                    onClick={() => {
                      setItemsPerPage(size);
                      setCurrentPage(1);
                    }}
                    className={`px-2.5 py-1 rounded-lg font-bold cursor-pointer transition-colors ${
                      itemsPerPage === size
                        ? 'bg-white text-[#4A1E94] shadow-sm'
                        : 'bg-white/10 text-white hover:bg-white/20'
                    }`}
                  >
                    {size}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    setItemsPerPage(9999);
                    setCurrentPage(1);
                  }}
                  className={`px-2.5 py-1 rounded-lg font-bold cursor-pointer transition-colors ${
                    itemsPerPage >= 9999
                      ? 'bg-white text-[#4A1E94] shadow-sm'
                      : 'bg-white/10 text-white hover:bg-white/20'
                  }`}
                >
                  All
                </button>
              </div>
            </div>
          )}
        </>
      )}

      </div>

      {/* =====================================================
          PAYMENT RECEIPT MODAL (Lazy-loaded on-demand)
      ====================================================== */}
      {activeReceiptBooking && (

        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-md animate-in fade-in"
          role="dialog"
          aria-modal="true"
          aria-label="Payment Proof Receipt"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              handleCloseReceipt();
            }
          }}
        >

          <div className="relative w-full max-w-lg rounded-3xl border border-white/20 bg-[#4A1E94] p-5 sm:p-6 text-white shadow-2xl animate-in zoom-in-95">

            {/* MODAL HEADER */}
            <div className="mb-4 flex items-center justify-between border-b border-white/15 pb-3">

              <div className="flex items-center gap-2">

                <CheckCircle2 className="h-4 w-4 text-[#00C6FF]" />

                <span className="text-xs font-black uppercase tracking-wider text-[#00C6FF]">
                  Payment Receipt · #{activeReceiptBooking.bookingReference}
                </span>

              </div>

              <button
                type="button"
                onClick={handleCloseReceipt}
                className="rounded-full p-1.5 text-white/70 transition-colors hover:bg-white/10 hover:text-white cursor-pointer"
                aria-label="Close receipt"
              >
                <X className="h-5 w-5" />
              </button>

            </div>

            {/* PLAYER & BOOKING SUMMARY BAR */}
            <div className="mb-4 rounded-2xl bg-white/5 border border-white/10 p-3 text-xs flex items-center justify-between gap-3 flex-wrap">
              <div>
                <span className="text-[#B3A2DB] block text-[10px] uppercase font-bold">Player Name</span>
                <span className="font-bold text-white text-sm">{activeReceiptBooking.customer?.fullName || 'Reserved Player'}</span>
              </div>
              <div>
                <span className="text-[#B3A2DB] block text-[10px] uppercase font-bold">Reservation Date</span>
                <span className="font-mono text-white text-xs">{activeReceiptBooking.selectedDate}</span>
              </div>
              <div>
                <span className="text-[#B3A2DB] block text-[10px] uppercase font-bold">Total Amount</span>
                <span className="font-bold text-emerald-400 text-sm">₱{formatCurrency(Number(activeReceiptBooking.totalAmount) || 0)}</span>
              </div>
            </div>

            {/* RECEIPT CONTENT CONTAINER */}
            <div className="flex min-h-[220px] max-h-[60vh] items-center justify-center overflow-hidden rounded-2xl bg-black/50 p-2 sm:p-3 border border-white/10">

              {isLoadingReceipt ? (
                <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
                  <RefreshCw className="h-8 w-8 animate-spin text-[#00C6FF]" />
                  <span className="text-xs font-bold text-white/90">
                    Downloading high-resolution receipt on-demand...
                  </span>
                  <span className="text-[11px] text-[#B3A2DB]">
                    Lazy-loaded to preserve bandwidth and accelerate page load
                  </span>
                </div>
              ) : receiptError ? (
                <div className="flex flex-col items-center justify-center gap-3 py-10 text-center px-4">
                  <div className="h-10 w-10 rounded-full bg-red-500/20 text-red-300 flex items-center justify-center border border-red-500/30">
                    <AlertCircle className="h-6 w-6 text-red-400" />
                  </div>
                  <span className="text-xs font-bold text-red-200">{receiptError}</span>
                  <button
                    type="button"
                    onClick={() => handleOpenReceipt(activeReceiptBooking)}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-white/20 hover:bg-white/30 px-4 py-1.5 text-xs font-bold text-white transition-colors cursor-pointer"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    <span>Retry Download</span>
                  </button>
                </div>
              ) : receiptImageUrl ? (
                <img
                  src={receiptImageUrl}
                  alt={`Payment Receipt for #${activeReceiptBooking.bookingReference}`}
                  className="max-h-[55vh] w-auto rounded-xl object-contain shadow-lg"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="text-center py-10 text-xs text-[#B3A2DB]">
                  No receipt screenshot found for this booking.
                </div>
              )}

            </div>

            {/* MODAL FOOTER */}
            <div className="mt-4 flex items-center justify-between gap-3 pt-2">
              {receiptImageUrl && (
                <a
                  href={receiptImageUrl}
                  download={`matchsip-receipt-${activeReceiptBooking.bookingReference}.jpg`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-[#00C6FF] hover:underline"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Download / Full Screen</span>
                </a>
              )}

              <button
                type="button"
                onClick={handleCloseReceipt}
                className="cursor-pointer ml-auto rounded-full bg-white/20 px-5 py-1.5 text-xs font-bold text-white transition-colors hover:bg-white/30"
              >
                Close Receipt
              </button>
            </div>

          </div>

        </div>

      )}

      {/* =====================================================
          ADD BOOKING RECORD MODAL
      ====================================================== */}
      <AddBookingModal
        isOpen={isAddBookingOpen}
        onClose={() => setIsAddBookingOpen(false)}
        onSuccess={(newBooking) => {
          setLocalBookings((prev) => [
            newBooking,
            ...prev.filter((b) => b.bookingReference !== newBooking.bookingReference && b.id !== newBooking.id),
          ]);
          showNotification(
            `Reservation #${newBooking.bookingReference} for ${newBooking.customer.fullName} added successfully!`
          );
        }}
        persistedBookings={localBookings}
        initialDate={filterDate !== 'all' ? filterDate : todayStr}
      />

      {/* =====================================================
          EDIT BOOKING MODAL
      ====================================================== */}
      <EditBookingModal
        isOpen={!!editingBooking}
        booking={editingBooking}
        onClose={() => setEditingBooking(null)}
        onSave={handleSaveEdit}
      />

      {/* =====================================================
          CALENDAR POPUP (NAVIGATE PAST BOOKINGS BY DATE)
      ====================================================== */}
      <CalendarPopup
        isOpen={isCalendarOpen}
        onClose={() => setIsCalendarOpen(false)}
        selectedDate={filterDate !== 'all' ? filterDate : todayStr}
        onSelectDate={(dateStr) => {
          setFilterDate(dateStr);
          setFilterCategory('all');
          setIsCalendarOpen(false);
        }}
        currentTodayStr={todayStr}
        allowPastDates={true}
        bookingDates={uniqueDates}
        title="CALENDAR & PAST BOOKINGS"
        subtitle="Select any past or present date to navigate and view its court bookings"
      />

      {/* =====================================================
          DELETE CONFIRMATION MODAL (In-app, iframe-safe)
      ====================================================== */}
      {bookingToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-md rounded-3xl border border-red-500/30 bg-[#4A1E94] p-6 sm:p-8 text-white shadow-2xl animate-in zoom-in-95">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-500/20 text-red-400 border border-red-500/30">
              <Trash2 className="h-7 w-7" />
            </div>

            <h3 className="text-center font-heading text-xl sm:text-2xl font-black uppercase text-white">
              Delete Reservation?
            </h3>

            <p className="mt-3 text-center text-xs sm:text-sm text-[#B3A2DB] leading-relaxed">
              Are you sure you want to permanently delete reservation{' '}
              <strong className="text-white font-mono">#{bookingToDelete.bookingReference}</strong> for{' '}
              <strong className="text-white">{bookingToDelete.customer?.fullName || 'this player'}</strong>?
            </p>

            <div className="mt-4 rounded-xl bg-white/5 border border-white/10 p-3 text-center text-[11px] text-[#00C6FF]">
              ⚠️ This will release the court slot locks ({bookingToDelete.slots?.length || 0} slot(s)) and make them available for other players.
            </div>

            <div className="mt-6 flex items-center gap-3">
              <button
                type="button"
                id="cancel-delete-modal-btn"
                onClick={() => setBookingToDelete(null)}
                className="flex-1 cursor-pointer rounded-xl border border-white/20 bg-white/10 py-3 text-xs sm:text-sm font-bold text-white hover:bg-white/20 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                id="confirm-delete-modal-btn"
                onClick={confirmDeleteBooking}
                className="flex-1 cursor-pointer rounded-xl bg-red-500 hover:bg-red-600 py-3 text-xs sm:text-sm font-black uppercase tracking-wider text-white shadow-lg shadow-red-500/30 transition-all hover:scale-[1.02] active:scale-98"
              >
                Delete Reservation
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================
          TOAST FEEDBACK
      ====================================================== */}
      {toastNotification && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-xl border border-[#00C6FF]/60 bg-[#4A1E94] px-4 py-3 text-xs font-bold text-white shadow-2xl shadow-[#00C6FF]/30 backdrop-blur-md animate-in fade-in slide-in-from-bottom-3">
          <span className="h-2 w-2 rounded-full bg-[#00C6FF] animate-ping" />
          <span>{toastNotification}</span>
        </div>
      )}

    </div>
  );
};