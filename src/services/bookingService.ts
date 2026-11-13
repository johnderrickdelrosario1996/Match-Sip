import { ConfirmedBooking, SelectedSlot } from '../types';

const LOCAL_STORAGE_CACHE_KEY = 'matchsip_bookings_cache';

// Client-Side In-Memory Cache with TTL to prevent redundant network fetches
let inMemoryBookingsCache: ConfirmedBooking[] | null = null;
let lastCacheTimestamp = 0;
const CACHE_TTL_MS = 60 * 1000; // 60 seconds fresh cache TTL

export function getStoredAdminPin(): string {
  try {
    if (typeof window !== 'undefined') {
      const pin = sessionStorage.getItem('matchsip_admin_pin');
      if (pin && pin.trim()) return pin.trim();
    }
  } catch {}
  return '';
}

/**
 * Retrieves initial bookings synchronously from memory or persistent storage (localStorage).
 * Completely eliminates the initial loading flash and delay when mounting components!
 */
export function getInitialCachedBookings(): ConfirmedBooking[] {
  if (inMemoryBookingsCache && inMemoryBookingsCache.length > 0) {
    return inMemoryBookingsCache;
  }
  try {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(LOCAL_STORAGE_CACHE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          inMemoryBookingsCache = parsed;
          lastCacheTimestamp = Date.now();
          return parsed;
        }
      }
    }
  } catch (err) {
    console.warn('[MATCH&SIP] Persistent cache read warning:', err);
  }
  return [];
}

export function getCachedBookings(): ConfirmedBooking[] | null {
  if (inMemoryBookingsCache && (Date.now() - lastCacheTimestamp < CACHE_TTL_MS)) {
    return inMemoryBookingsCache;
  }
  const disk = getInitialCachedBookings();
  return disk.length > 0 ? disk : inMemoryBookingsCache;
}

export function clearBookingsCache(): void {
  inMemoryBookingsCache = null;
  lastCacheTimestamp = 0;
  dateBookingsCache.clear();
  try {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(LOCAL_STORAGE_CACHE_KEY);
      localStorage.removeItem('matchsip_bookings_cache');
    }
  } catch {}
}

// -------------------------------------------------------------
// Date-Level Memoization Cache (React / In-Memory Store)
// -------------------------------------------------------------
interface DateCacheEntry {
  bookings: ConfirmedBooking[];
  timestamp: number;
}

const dateBookingsCache = new Map<string, DateCacheEntry>();
const DATE_CACHE_TTL_MS = 60 * 1000; // 60 seconds memoization window
const inFlightDateFetches = new Map<string, Promise<ConfirmedBooking[]>>();

export const BOOKINGS_CHANGED_EVENT = 'matchsip_bookings_changed';

/**
 * Event-driven cache invalidator and real-time dispatcher.
 * Clears date-specific memoized results and notifies all active subscribers.
 */
export function notifyBookingsChanged(affectedDate?: string): void {
  if (affectedDate) {
    dateBookingsCache.delete(affectedDate);
  } else {
    dateBookingsCache.clear();
  }
  inMemoryBookingsCache = null;
  lastCacheTimestamp = 0;
  inMemoryUnmaskedCache = null;
  lastUnmaskedCacheTimestamp = 0;

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(BOOKINGS_CHANGED_EVENT, { detail: { date: affectedDate } })
    );
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        const channel = new BroadcastChannel('matchsip_system_sync');
        channel.postMessage({
          type: 'BOOKINGS_CHANGED',
          date: affectedDate,
          timestamp: Date.now(),
        });
        channel.close();
      }
    } catch {}
  }
}

/**
 * Targeted, memoized fetch for reservations on a specific date.
 * Reuses in-memory cached results across date switches to eliminate redundant queries.
 */
export async function fetchBookingsForDate(
  selectedDate: string,
  forceRefresh = false
): Promise<ConfirmedBooking[]> {
  const dateKey = (selectedDate || '').trim();
  if (!dateKey) return [];

  const now = Date.now();
  if (!forceRefresh) {
    const cached = dateBookingsCache.get(dateKey);
    if (cached && now - cached.timestamp < DATE_CACHE_TTL_MS) {
      return cached.bookings;
    }
  }

  // Single-flight deduplication: reuse active in-flight request if present
  const inFlight = inFlightDateFetches.get(dateKey);
  if (inFlight && !forceRefresh) {
    return inFlight;
  }

  const fetchPromise = (async () => {
    try {
      const res = await fetch(`/api/bookings?date=${encodeURIComponent(dateKey)}&_t=${Date.now()}`);
      if (!res.ok) throw new Error(`Failed to fetch bookings for date ${dateKey}`);
      const data = await res.json();
      const items: ConfirmedBooking[] = (data.bookings || []).map(mapSqlRowToBooking);
      dateBookingsCache.set(dateKey, { bookings: items, timestamp: Date.now() });
      return items;
    } catch (err) {
      console.warn(`[BOOKINGS] Notice loading bookings for ${dateKey}:`, err);
      const fallback = dateBookingsCache.get(dateKey);
      return fallback ? fallback.bookings : [];
    } finally {
      inFlightDateFetches.delete(dateKey);
    }
  })();

  inFlightDateFetches.set(dateKey, fetchPromise);
  return fetchPromise;
}

export function setCachedBookings(bookings: ConfirmedBooking[]): void {
  inMemoryBookingsCache = bookings;
  lastCacheTimestamp = Date.now();
  try {
    if (typeof window !== 'undefined') {
      // Omit data: URLs from localStorage to prevent QuotaExceededError while retaining metadata
      const safeForLocalStorage = bookings.map((b) => {
        if (b.paymentProofUrl && b.paymentProofUrl.startsWith('data:')) {
          return { ...b, paymentProofUrl: '' };
        }
        return b;
      });
      localStorage.setItem(LOCAL_STORAGE_CACHE_KEY, JSON.stringify(safeForLocalStorage));
    }
  } catch (err) {
    // Quota exceeded or private browsing
  }
}

/**
 * Send an automated immediate notification email to the admin via Resend server API.
 */
export async function sendAdminBookingNotification(
  booking: ConfirmedBooking
): Promise<{ success: boolean; message?: string }> {
  try {
    const response = await fetch('/api/notify-admin', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ booking }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      console.warn('Admin notification email returned non-OK status:', errData);
      return { success: false, message: errData.error || errData.message || 'Notification failed' };
    }

    const data = await response.json();
    return { success: true, message: data.message };
  } catch (error: any) {
    console.warn('Failed to send admin booking notification email:', error);
    return { success: false, message: error?.message || 'Network error' };
  }
}

/**
 * Builds a deterministic canonical lock document ID for a court slot on a specific date.
 * E.g. "2026-10-08_court-1_0800"
 */
export function toCanonicalSlotLockId(date: string, courtId: string, timeLabel: string): string {
  const match = (timeLabel || '').match(/(\d{1,2}):(\d{2})/);
  const timeKey = match ? `${match[1].padStart(2, '0')}${match[2]}` : '0800';
  const cleanCourt = (courtId || 'court-1').toLowerCase().trim();
  const cleanDate = (date || '').trim();
  return `${cleanDate}_${cleanCourt}_${timeKey}`;
}

/**
 * Helper to build canonical slot ID (e.g. "court-1-0800")
 */
export function toCanonicalSlotId(courtId: string, timeLabel: string): string {
  const match = (timeLabel || '').match(/(\d{1,2}):(\d{2})/);
  const timeDigits = match ? `${match[1].padStart(2, '0')}${match[2]}` : '0800';
  return `${courtId || 'court-1'}-${timeDigits}`;
}

/**
 * Convert database row (from Supabase or backend API) to frontend ConfirmedBooking interface
 */
export function mapSqlRowToBooking(row: any): ConfirmedBooking {
  const ref = row.booking_reference ?? row.bookingReference ?? String(row.id || '');
  return {
    id: ref || String(row.id),
    bookingReference: ref,
    selectedDate: row.selected_date ?? row.selectedDate ?? '',
    paymentMethod: row.payment_method ?? row.paymentMethod ?? 'GCash (PayMongo)',
    customer: {
      fullName: row.customer_name ?? row.customerName ?? (row.customer?.fullName || ''),
      phoneNumber: row.customer_phone ?? row.customerPhone ?? (row.customer?.phoneNumber || ''),
      email: row.customer_email ?? row.customerEmail ?? (row.customer?.email || ''),
      notes: row.customer_notes ?? row.customerNotes ?? (row.customer?.notes || ''),
    },
    slots: Array.isArray(row.slots)
      ? row.slots
      : typeof row.slots === 'string'
      ? (() => {
          try {
            return JSON.parse(row.slots);
          } catch {
            return [];
          }
        })()
      : [],
    totalAmount: Number(row.total_amount ?? row.totalAmount) || 0,
    paymentProofUrl: row.payment_proof_url ?? row.paymentProofUrl ?? '',
    hasPaymentProof:
      Boolean(row.hasPaymentProof) ||
      Boolean(row.payment_proof_url ?? row.paymentProofUrl) ||
      String(row.payment_method ?? row.paymentMethod ?? '').toLowerCase().includes('instapay'),
    status: row.status || 'BOOKED',
    confirmedAt: row.confirmed_at ?? row.confirmedAt ?? (row.created_at || row.createdAt ? new Date(row.created_at || row.createdAt).toISOString() : ''),
    createdAt: row.created_at || row.createdAt ? new Date(row.created_at || row.createdAt).toISOString() : (row.confirmed_at || row.confirmedAt || ''),
    bookedAt: row.booked_at ?? row.bookedAt ?? (row.created_at || row.createdAt ? new Date(row.created_at || row.createdAt).toISOString() : ''),
  };
}

/**
 * Live pre-checkout / pre-submission slot availability verification.
 * Directly checks live Supabase bookings for the target date to prevent double bookings.
 */
export async function validateSlotsLiveAvailability(
  slots: SelectedSlot[],
  dateStr: string,
  excludeBookingRef?: string
): Promise<{ isAvailable: boolean; conflictReason?: string; conflictingSlot?: SelectedSlot }> {
  if (!slots || slots.length === 0) {
    return { isAvailable: true };
  }

  try {
    const res = await fetch(`/api/bookings?date=${encodeURIComponent(dateStr)}`);
    if (!res.ok) {
      return { isAvailable: true };
    }
    const data = await res.json();
    const existingBookings = Array.isArray(data.bookings) ? data.bookings : [];

    const bookedSlotKeys = new Set<string>();
    const bookedRefMap = new Map<string, string>();
    const normalizedExcludeRef = (excludeBookingRef || '').trim().toLowerCase();

    existingBookings.forEach((b: any) => {
      const ref = (b.bookingReference || b.id || '').trim();
      // Strictly ignore user's own draft or hold booking reference
      if (normalizedExcludeRef && ref.toLowerCase() === normalizedExcludeRef) return;
      if (b.status === 'CANCELLED' || b.status === 'REJECTED') return;

      // Skip expired temporary holds so they don't block bookings
      if (b.status === 'HELD' && b.expiresAt) {
        const expTime = new Date(b.expiresAt).getTime();
        if (!isNaN(expTime) && expTime <= Date.now()) {
          return;
        }
      }

      (b.slots || []).forEach((s: any) => {
        const cId = (s.courtId || 'court-1').toLowerCase();
        const tLabel = s.timeLabel || '';
        const match = tLabel.match(/(\d{1,2}):(\d{2})/);
        const timeKey = match ? `${match[1].padStart(2, '0')}${match[2]}` : '';

        if (s.slotId) bookedSlotKeys.add(s.slotId);
        if (timeKey) bookedSlotKeys.add(`${cId}-${timeKey}`);
        if (tLabel) bookedSlotKeys.add(`${cId}-${tLabel.trim()}`);

        const canonical = toCanonicalSlotLockId(dateStr, cId, tLabel);
        bookedSlotKeys.add(canonical);
        bookedRefMap.set(canonical, ref);
      });
    });

    for (const slot of slots) {
      const cId = (slot.courtId || 'court-1').toLowerCase();
      const tLabel = slot.timeLabel || '';
      const match = tLabel.match(/(\d{1,2}):(\d{2})/);
      const timeKey = match ? `${match[1].padStart(2, '0')}${match[2]}` : '';
      const canonical = toCanonicalSlotLockId(slot.date || dateStr, cId, tLabel);

      const isConflict =
        bookedSlotKeys.has(canonical) ||
        bookedSlotKeys.has(slot.slotId) ||
        (timeKey ? bookedSlotKeys.has(`${cId}-${timeKey}`) : false);

      if (isConflict) {
        const ref = bookedRefMap.get(canonical) || bookedRefMap.get(slot.slotId) || '';
        return {
          isAvailable: false,
          conflictingSlot: slot,
          conflictReason: `Court slot "${slot.courtName} (${slot.timeLabel})" was just reserved by another player${ref ? ` (#${ref})` : ''}. Please select an open slot.`,
        };
      }
    }

    return { isAvailable: true };
  } catch (err) {
    console.warn('[MATCH&SIP] Live slot availability check warning:', err);
    return { isAvailable: true };
  }
}

/**
 * Save a new confirmed court reservation to Cloud SQL with atomic slot locks.
 */
export async function saveBookingToFirestore(booking: ConfirmedBooking): Promise<void> {
  const nowIso = new Date().toISOString();
  const confirmedAt = booking.confirmedAt || booking.createdAt || nowIso;
  const createdAt = booking.createdAt || confirmedAt;
  const bookedAt = booking.bookedAt || confirmedAt;

  const payload = {
    bookingReference: booking.bookingReference,
    selectedDate: booking.selectedDate,
    paymentMethod: booking.paymentMethod || 'GCash (PayMongo)',
    customerName: booking.customer.fullName,
    customerPhone: booking.customer.phoneNumber,
    customerEmail: booking.customer.email || '',
    customerNotes: booking.customer.notes || '',
    slots: booking.slots.map((s) => ({
      slotId: s.slotId,
      courtId: s.courtId,
      courtName: s.courtName,
      timeLabel: s.timeLabel,
      date: s.date || booking.selectedDate,
      price: s.price,
    })),
    totalAmount: Number(booking.totalAmount) || 0,
    paymentProofUrl: booking.paymentProofUrl || '',
    status: booking.status || 'BOOKED',
    confirmedAt,
    bookedAt,
  };

  const res = await fetch('/api/bookings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to save booking to database.');
  }

  // Automated immediate notification email to admin via Resend
  try {
    const notifyResult = await sendAdminBookingNotification(booking);
    if (notifyResult.success) {
      console.log(`[MATCH&SIP] Admin email notification sent for #${booking.bookingReference}`);
    } else {
      console.warn(`[MATCH&SIP] Admin email notification dispatch warning:`, notifyResult.message);
    }
  } catch (err) {
    console.warn('[MATCH&SIP] Non-blocking admin email notification failed:', err);
  }

  // Update in-memory & persistent cache immediately
  const existingCached = getInitialCachedBookings();
  const alreadyInCache = existingCached.some((b) => b.bookingReference === booking.bookingReference);
  if (!alreadyInCache) {
    setCachedBookings([booking, ...existingCached]);
  }
  notifyBookingsChanged(booking.selectedDate);
}

/**
 * Delete a booking and release its locks from database.
 */
export async function deleteBookingFromFirestore(bookingId: string, adminPin?: string): Promise<void> {
  if (!bookingId) throw new Error('Missing booking ID for deletion');
  const cleanId = bookingId.trim();
  const pin = (adminPin || getStoredAdminPin()).trim();

  const res = await fetch(`/api/bookings/${encodeURIComponent(cleanId)}`, {
    method: 'DELETE',
    headers: {
      'x-admin-pin': pin,
    },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to delete booking from database.');
  }

  // Synchronously update in-memory and persistent cache
  if (inMemoryBookingsCache) {
    const updatedCache = inMemoryBookingsCache.filter(
      (b) => b.id !== cleanId && b.bookingReference !== cleanId
    );
    setCachedBookings(updatedCache);
  }
  notifyBookingsChanged();
}

/**
 * Update an existing booking in database.
 */
export async function updateBookingInFirestore(
  bookingId: string,
  updates: {
    fullName?: string;
    phoneNumber?: string;
    selectedDate?: string;
    status?: string;
    totalAmount?: number;
    notes?: string;
    slots?: SelectedSlot[];
  },
  adminPin?: string
): Promise<void> {
  const cleanId = (bookingId || '').trim();
  if (!cleanId) throw new Error('Missing booking ID for update');
  const pin = (adminPin || getStoredAdminPin()).trim();

  const cleanSlots = updates.slots
    ? updates.slots.map((s) => {
        const courtId = s.courtId || 'court-1';
        const courtName = s.courtName || (courtId === 'court-2' ? 'Court 02' : 'Court 01');
        const timeLabel = s.timeLabel || '08:00 - 09:00';
        const canonicalSlotId = toCanonicalSlotId(courtId, timeLabel);

        return {
          slotId: canonicalSlotId,
          courtId,
          courtName,
          timeLabel,
          date: s.date || updates.selectedDate || '',
          price: Number(s.price) || 0,
        };
      })
    : undefined;

  const payload: Record<string, any> = {};
  if (updates.fullName !== undefined) payload.customerName = updates.fullName.trim();
  if (updates.phoneNumber !== undefined) payload.customerPhone = updates.phoneNumber.trim();
  if (updates.notes !== undefined) payload.customerNotes = (updates.notes || '').trim();
  if (updates.selectedDate !== undefined) payload.selectedDate = updates.selectedDate.trim();
  if (updates.status !== undefined) payload.status = updates.status;
  if (updates.totalAmount !== undefined) payload.totalAmount = Number(updates.totalAmount) || 0;
  if (cleanSlots !== undefined) payload.slots = cleanSlots;

  const res = await fetch(`/api/bookings/${encodeURIComponent(cleanId)}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-pin': pin,
    },
    body: JSON.stringify({ ...payload, adminPin: pin }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to update booking in database.');
  }

  // Update local cache
  const currentCache = getInitialCachedBookings();
  if (currentCache.length > 0) {
    const updatedCache = currentCache.map((b) => {
      if (b.id === cleanId || b.bookingReference === cleanId) {
        return {
          ...b,
          ...(updates.selectedDate ? { selectedDate: updates.selectedDate } : {}),
          ...(updates.status ? { status: updates.status } : {}),
          ...(updates.totalAmount !== undefined ? { totalAmount: Number(updates.totalAmount) } : {}),
          customer: {
            ...b.customer,
            ...(updates.fullName ? { fullName: updates.fullName } : {}),
            ...(updates.phoneNumber ? { phoneNumber: updates.phoneNumber } : {}),
            ...(updates.notes !== undefined ? { notes: updates.notes } : {}),
          },
          slots: cleanSlots || b.slots,
        };
      }
      return b;
    });
    setCachedBookings(updatedCache);
  }
  notifyBookingsChanged(updates.selectedDate);
}

/**
 * Consolidate updates across multiple bookings into database.
 */
export async function batchUpdateBookingsInFirestore(
  bookingUpdates: Array<{
    bookingId: string;
    updates: {
      fullName?: string;
      phoneNumber?: string;
      selectedDate?: string;
      status?: string;
      totalAmount?: number;
      notes?: string;
      slots?: SelectedSlot[];
    };
  }>,
  adminPin?: string
): Promise<void> {
  if (!bookingUpdates || bookingUpdates.length === 0) return;

  for (const { bookingId, updates } of bookingUpdates) {
    await updateBookingInFirestore(bookingId, updates, adminPin);
  }
  notifyBookingsChanged();
}

// Unmasked bookings client-side cache
let inMemoryUnmaskedCache: ConfirmedBooking[] | null = null;
let lastUnmaskedCacheTimestamp = 0;
const UNMASKED_CACHE_TTL_MS = 15 * 1000;

export function invalidateUnmaskedBookingsCache(): void {
  inMemoryUnmaskedCache = null;
  lastUnmaskedCacheTimestamp = 0;
}

/**
 * Explicitly fetches full unmasked booking records from /api/bookings using the Admin PIN.
 * Bypasses public customer PII masking, providing unmasked player names, phone numbers,
 * email addresses, customer notes, payment proof URLs, and actual payment totals.
 */
export async function fetchUnmaskedAdminBookings(
  adminPin?: string,
  maxLimit: number = 50,
  pageOrForceRefresh: number | boolean = 1,
  forceRefresh: boolean = false
): Promise<ConfirmedBooking[]> {
  const page = typeof pageOrForceRefresh === 'number' ? pageOrForceRefresh : 1;
  const isForced = typeof pageOrForceRefresh === 'boolean' ? pageOrForceRefresh : forceRefresh;

  if (!isForced && inMemoryUnmaskedCache && (Date.now() - lastUnmaskedCacheTimestamp < UNMASKED_CACHE_TTL_MS)) {
    return inMemoryUnmaskedCache;
  }

  const pin = (adminPin || getStoredAdminPin()).trim();
  const headers: Record<string, string> = {
    'x-admin-pin': pin,
  };

  const res = await fetch(`/api/bookings?limit=${maxLimit}&page=${page}&_t=${Date.now()}`, { headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to fetch unmasked bookings (HTTP ${res.status})`);
  }

  const data = await res.json();
  if (!data.success && data.error) {
    throw new Error(data.error);
  }

  const bookings = (data.bookings || []).map(mapSqlRowToBooking);
  inMemoryUnmaskedCache = bookings;
  lastUnmaskedCacheTimestamp = Date.now();
  return bookings;
}

/**
 * Fetches the payment proof receipt image for a booking reference or ID.
 * Directly calls the targeted receipt endpoint to avoid downloading heavy lists.
 */
export async function fetchBookingReceipt(
  bookingRefOrId: string,
  adminPin?: string
): Promise<string | null> {
  if (!bookingRefOrId) return null;
  try {
    const pin = (adminPin || getStoredAdminPin()).trim();
    const res = await fetch(`/api/bookings/${encodeURIComponent(bookingRefOrId)}/receipt`, {
      headers: { 'x-admin-pin': pin },
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.success && data.paymentProofUrl) {
        return data.paymentProofUrl;
      }
    }
  } catch (err) {
    console.warn('[RECEIPT] Error fetching booking receipt:', err);
  }
  return null;
}

export interface SubscribeBookingsOptions {
  maxLimit?: number;
  adminPin?: string;
  page?: number;
  date?: string;
}

/**
 * Purely event-driven subscription to court reservations (zero background polling).
 * Uses targeted date queries + memoization, and re-fetches only on mount,
 * explicit booking mutation events, cross-tab BroadcastChannel signals, or stale tab refocus.
 */
export function subscribeToBookings(
  onBookingsUpdated: (bookings: ConfirmedBooking[]) => void,
  onError?: (err: Error) => void,
  options?: SubscribeBookingsOptions
): () => void {
  const maxLimit = options?.maxLimit ?? 50;
  const adminPin = options?.adminPin;
  const page = options?.page ?? 1;
  const targetDate = options?.date;
  let isMounted = true;

  // 1. Immediately emit cached bookings to eliminate loading flashes
  if (targetDate) {
    const cachedForDate = dateBookingsCache.get(targetDate);
    if (cachedForDate && cachedForDate.bookings.length > 0) {
      onBookingsUpdated(cachedForDate.bookings);
    } else {
      const globalCached = getInitialCachedBookings();
      const filtered = globalCached.filter((b) => b.selectedDate === targetDate);
      if (filtered.length > 0) onBookingsUpdated(filtered);
    }
  } else if (!adminPin) {
    const cached = getInitialCachedBookings();
    if (cached.length > 0) {
      onBookingsUpdated(cached);
    }
  } else if (inMemoryUnmaskedCache && inMemoryUnmaskedCache.length > 0) {
    onBookingsUpdated(inMemoryUnmaskedCache);
  }

  let isFetching = false;
  const fetchBookings = async (force = false) => {
    if (isFetching || !isMounted) return;
    if (typeof document !== 'undefined' && document.hidden && !force) return;

    isFetching = true;
    try {
      if (targetDate) {
        const items = await fetchBookingsForDate(targetDate, force);
        if (isMounted) onBookingsUpdated(items);
      } else if (adminPin) {
        const items = await fetchUnmaskedAdminBookings(adminPin, maxLimit, page, force);
        if (isMounted) onBookingsUpdated(items);
      } else {
        if (!force && inMemoryBookingsCache && Date.now() - lastCacheTimestamp < CACHE_TTL_MS) {
          if (isMounted) onBookingsUpdated(inMemoryBookingsCache);
          return;
        }
        const res = await fetch(`/api/bookings?limit=${maxLimit}&page=${page}&_t=${Date.now()}`);
        if (!res.ok) throw new Error('Failed to fetch bookings from server');
        const data = await res.json();
        if (!isMounted) return;

        const items: ConfirmedBooking[] = (data.bookings || []).map(mapSqlRowToBooking);
        setCachedBookings(items);
        onBookingsUpdated(items);
      }
    } catch (err: any) {
      if (!isMounted) return;
      console.warn('Bookings fetch notice:', err);
      if (onError) onError(err);
    } finally {
      isFetching = false;
    }
  };

  // Initial fetch
  fetchBookings(false);

  // Event-driven triggers: re-fetch immediately on local booking changes or stale tab refocus
  const handleEventUpdate = (e: any) => {
    const affectedDate = e?.detail?.date;
    if (!targetDate || !affectedDate || affectedDate === targetDate) {
      fetchBookings(true);
    }
  };

  const handleFocus = () => {
    if (typeof document !== 'undefined' && !document.hidden) {
      fetchBookings(false);
    }
  };

  let syncChannel: BroadcastChannel | null = null;
  const handleBroadcast = (e: MessageEvent) => {
    if (e.data?.type === 'BOOKINGS_CHANGED') {
      const affectedDate = e.data?.date;
      if (!targetDate || !affectedDate || affectedDate === targetDate) {
        fetchBookings(true);
      }
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener(BOOKINGS_CHANGED_EVENT, handleEventUpdate);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('visibilitychange', handleFocus);
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        syncChannel = new BroadcastChannel('matchsip_system_sync');
        syncChannel.addEventListener('message', handleBroadcast);
      }
    } catch {}
  }

  return () => {
    isMounted = false;
    if (typeof window !== 'undefined') {
      window.removeEventListener(BOOKINGS_CHANGED_EVENT, handleEventUpdate);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('visibilitychange', handleFocus);
    }
    if (syncChannel) {
      try {
        syncChannel.removeEventListener('message', handleBroadcast);
        syncChannel.close();
      } catch {}
    }
  };
}

/**
 * Call the backend checkout creation endpoint (/api/create-checkout)
 * Integrates PayMongo Checkout Session or Source when user clicks BOOK RESERVATION.
 */
export async function createPaymongoCheckout(booking: ConfirmedBooking): Promise<{
  success: boolean;
  checkoutUrl: string;
  qrCodeUrl: string;
  bookingReference: string;
  provider: string;
  isLive: boolean;
  error?: string;
}> {
  try {
    const response = await fetch('/api/create-checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ booking }),
    });

    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.error || 'Failed to initialize payment checkout.');
    }

    return data;
  } catch (err: any) {
    console.error('Error creating payment checkout session:', err);
    throw err;
  }
}

/**
 * Simulate GCash webhook payment approval for test/sandbox mode
 */
export async function simulatePaymongoPayment(bookingReference: string): Promise<boolean> {
  try {
    const response = await fetch('/api/payment/simulate-pay', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ bookingReference }),
    });
    const data = await response.json();
    return Boolean(data.success);
  } catch (err) {
    console.error('Error simulating payment:', err);
    return false;
  }
}


/**
 * Acquire a 5-minute (300-second) temporary reservation lock (TTL Hold) when user enters checkout (Mechanism 3)
 */
export async function holdSlotsLive(
  bookingReference: string,
  selectedDate: string,
  slots: SelectedSlot[],
  customerName = '',
  ttlSeconds = 300
): Promise<{ success: boolean; conflictReason?: string }> {
  try {
    const res = await fetch('/api/slots/hold', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bookingReference,
        selectedDate,
        slots,
        customerName,
        ttlSeconds,
      }),
    });

    if (res.status === 409) {
      const err = await res.json().catch(() => ({}));
      return {
        success: false,
        conflictReason: err.error || 'One or more of your selected slots is already locked or in checkout by another player.',
      };
    }

    if (!res.ok) {
      return { success: true };
    }

    notifyBookingsChanged(selectedDate);
    return { success: true };
  } catch (err: any) {
    return { success: true };
  }
}

/**
 * Renew or extend an active slot hold during checkout
 */
export async function renewSlotHoldLive(
  bookingReference: string,
  selectedDate: string,
  slots: SelectedSlot[],
  customerName = '',
  ttlSeconds = 300
): Promise<{ success: boolean; conflictReason?: string }> {
  return holdSlotsLive(bookingReference, selectedDate, slots, customerName, ttlSeconds);
}

/**
 * Release temporary hold if user cancels or leaves checkout
 */
export async function releaseSlotsHoldLive(bookingReference: string): Promise<void> {
  if (!bookingReference) return;
  try {
    await fetch('/api/slots/release', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookingReference }),
    });
    notifyBookingsChanged();
  } catch {}
}
