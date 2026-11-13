import {
  supabase,
  isSupabaseConfigured,
  isTableMissingError,
  isNetworkOrConnectionError,
} from '../lib/supabase.ts';

export interface BookingInput {
  bookingReference: string;
  selectedDate: string;
  paymentMethod?: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  customerNotes?: string;
  slots: any[];
  totalAmount: number;
  paymentProofUrl?: string;
  status?: string;
  confirmedAt?: string;
  bookedAt?: string;
}

let hasWarnedTableMissing = false;

function warnTableMissingOnce() {
  if (!hasWarnedTableMissing) {
    hasWarnedTableMissing = true;
    console.warn(
      `[Database Notice] Table 'public.bookings' or 'public.court_slot_locks' is not present in database. ` +
      `The app will operate smoothly in resilient mode in the meantime.`
    );
  }
}

/**
 * Normalizes a database row from Supabase (supporting both snake_case and camelCase)
 */
export function normalizeBookingRow(row: any) {
  if (!row) return null;
  return {
    id: row.id,
    bookingReference: row.booking_reference ?? row.bookingReference ?? '',
    selectedDate: row.selected_date ?? row.selectedDate ?? '',
    paymentMethod: row.payment_method ?? row.paymentMethod ?? 'GCash (PayMongo)',
    customerName: row.customer_name ?? row.customerName ?? '',
    customerPhone: row.customer_phone ?? row.customerPhone ?? '',
    customerEmail: row.customer_email ?? row.customerEmail ?? '',
    customerNotes: row.customer_notes ?? row.customerNotes ?? '',
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
      Boolean(row.payment_proof_url ?? row.paymentProofUrl) ||
      String(row.payment_method ?? row.paymentMethod ?? '').toLowerCase().includes('instapay'),
    status: row.status || 'BOOKED',
    confirmedAt: row.confirmed_at ?? row.confirmedAt ?? '',
    bookedAt: row.booked_at ?? row.bookedAt ?? '',
    expiresAt: row.expires_at ?? row.expiresAt ?? '',
    createdAt: row.created_at ?? row.createdAt ?? '',
    updatedAt: row.updated_at ?? row.updatedAt ?? '',
  };
}

/**
 * Detects if a database query error was caused by PostgreSQL statement timeout
 */
export function isStatementTimeoutError(error: any): boolean {
  if (!error) return false;
  const msg = (error.message || error.details || error.hint || String(error)).toLowerCase();
  const code = (error.code || '').toUpperCase();
  return (
    code === '57014' ||
    msg.includes('statement timeout') ||
    msg.includes('canceling statement') ||
    msg.includes('timeout')
  );
}

// High-performance server-side in-memory cache and request coalescing (single-flight)
let cachedBookings: any[] | null = null;
let cachedBookingsTimestamp = 0;
const SERVER_CACHE_TTL_MS = 10000; // 10 seconds cache TTL (immediately invalidated on any write)
let inFlightGetAllBookingsPromise: Promise<any[]> | null = null;

const cachedBookingsByDate = new Map<string, { data: any[]; timestamp: number }>();
const inFlightByDatePromises = new Map<string, Promise<any[]>>();

export function invalidateServerBookingsCache(updatedBooking?: any, deletedRef?: string) {
  const affectedDate = updatedBooking?.selectedDate;
  if (affectedDate) {
    cachedBookingsByDate.delete(affectedDate);
  } else {
    cachedBookingsByDate.clear();
  }

  if (deletedRef && cachedBookings) {
    cachedBookings = cachedBookings.filter(
      (b: any) => b.bookingReference !== deletedRef && b.id !== deletedRef
    );
  } else if (updatedBooking && cachedBookings) {
    const existingIndex = cachedBookings.findIndex(
      (b: any) => b.bookingReference === updatedBooking.bookingReference || b.id === updatedBooking.id
    );
    if (existingIndex >= 0) {
      cachedBookings[existingIndex] = { ...cachedBookings[existingIndex], ...updatedBooking };
    } else {
      cachedBookings = [updatedBooking, ...cachedBookings];
    }
  } else {
    cachedBookingsTimestamp = 0;
  }
}

// Explicit column definitions to eliminate SELECT * and shrink egress/payload sizes
export const BOOKINGS_LOG_COLUMNS =
  'id, booking_reference, selected_date, payment_method, customer_name, customer_phone, customer_notes, slots, total_amount, status, confirmed_at, booked_at, created_at, updated_at';

export const BOOKINGS_LOG_CAMEL_COLUMNS =
  'id, bookingReference, selectedDate, paymentMethod, customerName, customerPhone, customerNotes, slots, totalAmount, status, confirmedAt, bookedAt, createdAt, updatedAt';

export const BOOKINGS_FULL_COLUMNS =
  'id, booking_reference, selected_date, payment_method, customer_name, customer_phone, customer_notes, slots, total_amount, payment_proof_url, status, confirmed_at, booked_at, created_at, updated_at';

export const BOOKINGS_FULL_CAMEL_COLUMNS =
  'id, bookingReference, selectedDate, paymentMethod, customerName, customerPhone, customerNotes, slots, totalAmount, paymentProofUrl, status, confirmedAt, bookedAt, createdAt, updatedAt';

export const BOOKINGS_DATE_CHECK_COLUMNS =
  'booking_reference, selected_date, status, slots';

export const BOOKINGS_DATE_CHECK_CAMEL_COLUMNS =
  'bookingReference, selectedDate, status, slots';

export const COURT_SLOT_LOCKS_COLUMNS =
  'lock_id, booking_reference, date, court_id, time_label, status, expires_at';

export const COURT_SLOT_LOCKS_CHECK_COLUMNS =
  'lock_id, booking_reference, status, expires_at';

export interface GetAllBookingsOptions {
  limit?: number;
  offset?: number;
  page?: number;
  columns?: string;
}

/**
 * Fetch bookings from Supabase with pagination (.range/.limit), explicit column selection, and statement timeout protection
 */
export async function getAllBookings(optionsOrLimit: number | GetAllBookingsOptions = 50) {
  if (!isSupabaseConfigured) {
    return cachedBookings || [];
  }

  const options: GetAllBookingsOptions =
    typeof optionsOrLimit === 'number'
      ? { limit: optionsOrLimit }
      : optionsOrLimit || {};

  const limitCount = Math.max(1, Math.min(options.limit ?? 50, 250));
  const page = options.page && options.page > 0 ? options.page : 1;
  const hasExplicitOffset = options.offset !== undefined && options.offset >= 0;
  const from = hasExplicitOffset ? options.offset! : (page - 1) * limitCount;
  const to = from + limitCount - 1;
  const columns = options.columns || BOOKINGS_LOG_COLUMNS;

  const now = Date.now();
  if (cachedBookings !== null && now - cachedBookingsTimestamp < SERVER_CACHE_TTL_MS && from === 0) {
    return cachedBookings.slice(0, limitCount);
  }

  // Request coalescing (single-flight): reuse active in-flight query promise across concurrent callers for page 1
  if (inFlightGetAllBookingsPromise && from === 0) {
    return inFlightGetAllBookingsPromise;
  }

  const queryPromise = (async () => {
    try {
      // Use pagination: .range(from, to) loads data in lightweight chunks (e.g., 20 or 50 items)
      // Explicit column selection avoids massive JSON payloads
      let query = supabase
        .from('bookings')
        .select(columns)
        .order('created_at', { ascending: false })
        .range(from, to);

      let { data, error } = await query;

      if (error && error.message.includes('created_at')) {
        const fallback = await supabase
          .from('bookings')
          .select(options.columns ? options.columns : BOOKINGS_LOG_CAMEL_COLUMNS)
          .range(from, to);
        data = fallback.data;
        error = fallback.error;
      }

      if (error) {
        if (isTableMissingError(error)) {
          warnTableMissingOnce();
          return cachedBookings || [];
        }
        if (isStatementTimeoutError(error)) {
          console.warn('[Supabase Notice] Query canceled due to statement timeout. Serving resilient cache fallback.');
          return cachedBookings || [];
        }
        if (isNetworkOrConnectionError(error)) {
          console.warn('[Supabase Notice] Network/connection issue fetching bookings. Serving resilient cache fallback.');
          return cachedBookings || [];
        }
        console.error('Failed to query bookings from Supabase:', error);
        return cachedBookings || [];
      }

      const normalized = (data || []).map(normalizeBookingRow);
      if (from === 0) {
        cachedBookings = normalized;
        cachedBookingsTimestamp = Date.now();
      }
      return normalized;
    } catch (error: any) {
      if (isTableMissingError(error)) {
        warnTableMissingOnce();
        return cachedBookings || [];
      }
      if (isStatementTimeoutError(error)) {
        console.warn('[Supabase Notice] Statement timeout during getAllBookings. Serving resilient cache.');
        return cachedBookings || [];
      }
      if (isNetworkOrConnectionError(error)) {
        console.warn('[Supabase Notice] Network/connection error during getAllBookings. Serving resilient cache.');
        return cachedBookings || [];
      }
      console.error('Failed to query bookings from Supabase:', error);
      if (cachedBookings !== null) {
        return cachedBookings;
      }
      return [];
    } finally {
      if (from === 0) {
        inFlightGetAllBookingsPromise = null;
      }
    }
  })();

  if (from === 0) {
    inFlightGetAllBookingsPromise = queryPromise;
  }

  return queryPromise;
}

/**
 * Fetch bookings for a specific reservation date using Supabase syntax with in-memory cache acceleration
 */
export async function getBookingsByDate(selectedDate: string) {
  if (!isSupabaseConfigured) {
    return [];
  }

  const now = Date.now();
  const dateCached = cachedBookingsByDate.get(selectedDate);
  if (dateCached && now - dateCached.timestamp < SERVER_CACHE_TTL_MS) {
    return dateCached.data;
  }

  const inFlight = inFlightByDatePromises.get(selectedDate);
  if (inFlight) {
    return inFlight;
  }

  const queryPromise = (async () => {
    try {
      let confirmedBookings: any[] = [];

      // Instant zero-latency serving if warm server-side cache is available
      if (cachedBookings !== null && Date.now() - cachedBookingsTimestamp < SERVER_CACHE_TTL_MS) {
        confirmedBookings = cachedBookings.filter((b: any) => b.selectedDate === selectedDate);
      } else {
      let { data, error } = await supabase
        .from('bookings')
        .select(BOOKINGS_DATE_CHECK_COLUMNS)
        .eq('selected_date', selectedDate)
        .limit(100);

      if (error && error.message.includes('selected_date')) {
        const fallback = await supabase
          .from('bookings')
          .select(BOOKINGS_DATE_CHECK_CAMEL_COLUMNS)
          .eq('selectedDate', selectedDate)
          .limit(100);
        data = fallback.data as any;
        error = fallback.error;
      }

      if (error) {
        if (isTableMissingError(error)) {
          warnTableMissingOnce();
        } else if (isStatementTimeoutError(error)) {
          console.warn('[Supabase Notice] Statement timeout during getBookingsByDate. Falling back to cached data.');
          if (cachedBookings) {
            confirmedBookings = cachedBookings.filter((b: any) => b.selectedDate === selectedDate);
          }
        } else {
          console.error('Failed to query bookings by date from Supabase:', error);
          if (cachedBookings) {
            confirmedBookings = cachedBookings.filter((b: any) => b.selectedDate === selectedDate);
          }
        }
      } else {
        confirmedBookings = (data || []).map(normalizeBookingRow);
      }
    }

    // Query active unexpired temporary slot holds (TTL 5 minutes)
    try {
      const nowIso = new Date().toISOString();
      const { data: activeHolds, error: holdsErr } = await supabase
        .from('court_slot_locks')
        .select(COURT_SLOT_LOCKS_COLUMNS)
        .eq('date', selectedDate)
        .eq('status', 'HELD')
        .gt('expires_at', nowIso)
        .limit(100);

      if (!holdsErr && activeHolds && activeHolds.length > 0) {
        const existingRefs = new Set(confirmedBookings.map((b: any) => b.bookingReference));
        const holdBookings = activeHolds
          .filter((h: any) => !existingRefs.has(h.booking_reference))
          .map((h: any) => ({
            id: h.id,
            bookingReference: h.booking_reference || 'HELD',
            selectedDate: h.date,
            paymentMethod: 'In Checkout Hold',
            customerName: h.customer_name || 'Player in Checkout',
            customerPhone: '',
            customerEmail: '',
            customerNotes: '',
            slots: [{
              slotId: h.lock_id,
              courtId: h.court_id,
              courtName: h.court_name,
              timeLabel: h.time_label,
              date: h.date,
              price: 0,
            }],
            totalAmount: 0,
            paymentProofUrl: '',
            status: 'HELD',
            confirmedAt: '',
            bookedAt: h.locked_at || '',
            expiresAt: h.expires_at || '',
            createdAt: h.created_at || '',
            updatedAt: h.created_at || '',
          }));

        confirmedBookings.push(...holdBookings);
      }
    } catch {}

    // Merge active in-memory holds (instant sub-millisecond propagation)
    cleanExpiredMemoryLocks();
    const existingRefs = new Set(confirmedBookings.map((b: any) => b.bookingReference));
    const nowTimestamp = Date.now();

    for (const lock of memoryLocks.values()) {
      if (
        lock.selectedDate === selectedDate &&
        lock.status === 'HELD' &&
        lock.expiresAt &&
        lock.expiresAt > nowTimestamp &&
        !existingRefs.has(lock.bookingReference)
      ) {
        confirmedBookings.push({
          id: lock.lockId,
          bookingReference: lock.bookingReference,
          selectedDate: lock.selectedDate,
          paymentMethod: 'In Checkout Hold',
          customerName: lock.customerName || 'Player in Checkout',
          customerPhone: '',
          customerEmail: '',
          customerNotes: '',
          slots: [
            {
              slotId: lock.lockId,
              courtId: lock.courtId,
              courtName: lock.courtName,
              timeLabel: lock.timeLabel,
              date: lock.selectedDate,
              price: 0,
            },
          ],
          totalAmount: 0,
          paymentProofUrl: '',
          status: 'HELD',
          confirmedAt: '',
          bookedAt: lock.lockedAt,
          expiresAt: new Date(lock.expiresAt).toISOString(),
          createdAt: lock.lockedAt,
          updatedAt: lock.lockedAt,
        });
      }
    }

    cachedBookingsByDate.set(selectedDate, { data: confirmedBookings, timestamp: Date.now() });
    return confirmedBookings;
  } catch (error: any) {
    if (isTableMissingError(error)) {
      warnTableMissingOnce();
      return [];
    }
    if (isStatementTimeoutError(error)) {
      console.warn('[Supabase Notice] Statement timeout during getBookingsByDate. Returning cached bookings fallback.');
      if (cachedBookings) {
        return cachedBookings.filter((b: any) => b.selectedDate === selectedDate);
      }
      return [];
    }
    if (isNetworkOrConnectionError(error)) {
      console.warn('[Supabase Notice] Network/connection issue during getBookingsByDate. Returning cached bookings fallback.');
      if (cachedBookings) {
        return cachedBookings.filter((b: any) => b.selectedDate === selectedDate);
      }
      return [];
    }
    console.error('Failed to query bookings by date from Supabase:', error);
    if (cachedBookings) {
      return cachedBookings.filter((b: any) => b.selectedDate === selectedDate);
    }
    return [];
  } finally {
    inFlightByDatePromises.delete(selectedDate);
  }
  })();

  inFlightByDatePromises.set(selectedDate, queryPromise);
  return queryPromise;
}

/**
 * Fetch a single booking by bookingReference using Supabase syntax
 */
export async function getBookingByReference(bookingReference: string) {
  if (!isSupabaseConfigured) {
    return null;
  }

  try {
    let { data, error } = await supabase
      .from('bookings')
      .select(BOOKINGS_LOG_COLUMNS)
      .eq('booking_reference', bookingReference)
      .maybeSingle();

    if (!data && (error?.message?.includes('booking_reference') || !error)) {
      const fallback = await supabase
        .from('bookings')
        .select(BOOKINGS_LOG_CAMEL_COLUMNS)
        .eq('bookingReference', bookingReference)
        .maybeSingle();
      if (fallback.data) {
        data = fallback.data as any;
        error = null;
      }
    }

    if (error) {
      if (isTableMissingError(error)) {
        return null;
      }
      if (isStatementTimeoutError(error)) {
        console.warn('[Supabase Notice] Statement timeout during getBookingByReference. Checking in-memory cache.');
        if (cachedBookings) {
          const found = cachedBookings.find(
            (b: any) => b.bookingReference === bookingReference || b.id === bookingReference
          );
          if (found) return found;
        }
        return null;
      }
      console.error('Failed to query booking by reference from Supabase:', error);
      if (cachedBookings) {
        const found = cachedBookings.find(
          (b: any) => b.bookingReference === bookingReference || b.id === bookingReference
        );
        if (found) return found;
      }
      return null;
    }

    return data ? normalizeBookingRow(data) : null;
  } catch (error: any) {
    if (isTableMissingError(error)) {
      return null;
    }
    if (isStatementTimeoutError(error)) {
      console.warn('[Supabase Notice] Statement timeout during getBookingByReference. Checking in-memory cache.');
      if (cachedBookings) {
        const found = cachedBookings.find(
          (b: any) => b.bookingReference === bookingReference || b.id === bookingReference
        );
        if (found) return found;
      }
      return null;
    }
    console.error('Failed to query booking by reference from Supabase:', error);
    if (cachedBookings) {
      const found = cachedBookings.find(
        (b: any) => b.bookingReference === bookingReference || b.id === bookingReference
      );
      if (found) return found;
    }
    return null;
  }
}

interface MemoryLock {
  lockId: string;
  bookingReference: string;
  customerName: string;
  selectedDate: string;
  courtId: string;
  courtName: string;
  timeLabel: string;
  status: 'HELD' | 'BOOKED';
  lockedAt: string;
  expiresAt: number | null; // epoch ms
}

const memoryLocks = new Map<string, MemoryLock>();

function cleanExpiredMemoryLocks() {
  const now = Date.now();
  for (const [key, lock] of memoryLocks.entries()) {
    if (lock.status === 'HELD' && lock.expiresAt && lock.expiresAt <= now) {
      memoryLocks.delete(key);
    }
  }
}

/**
 * Atomic Slot Lock Transaction (Mechanisms 1, 2, and 3):
 * 1. Database-Level Unique Constraint (unique_court_time_slot)
 * 2. Row-Level Transaction Locking (SELECT ... FOR UPDATE via claim_court_slots RPC)
 * 3. Short-Lived TTL Hold Support (5-minute hold for in-progress checkout)
 */
export async function claimSlotsTransaction(
  bookingReference: string,
  customerName: string,
  selectedDate: string,
  slots: any[],
  isTempHold = false,
  holdTtlSeconds = 300
) {
  cleanExpiredMemoryLocks();

  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAtMs = isTempHold ? Date.now() + holdTtlSeconds * 1000 : null;
  const expiresAtIso = expiresAtMs ? new Date(expiresAtMs).toISOString() : null;
  const status = isTempHold ? 'HELD' : 'BOOKED';

  const normalizedBookingRef = (bookingReference || '').trim().toLowerCase();

  // Step 1: Sub-millisecond Memory Lock & Race Guard
  for (const slot of slots) {
    const timeLabel = slot.timeLabel || '';
    const match = timeLabel.match(/(\d{1,2}):(\d{2})/);
    const timeKey = match ? `${match[1].padStart(2, '0')}${match[2]}` : '0800';
    const cleanCourt = (slot.courtId || 'court-1').toLowerCase().trim();
    const dateStr = (slot.date || selectedDate || '').trim();
    const lockId = `${dateStr}_${cleanCourt}_${timeKey}`;

    const existing = memoryLocks.get(lockId);
    if (existing) {
      const existingRef = (existing.bookingReference || '').trim().toLowerCase();
      // If this slot was held or reserved by the same booking reference, permit renewing hold or confirming booking
      if (existingRef === normalizedBookingRef) {
        continue;
      }

      if (existing.status === 'BOOKED') {
        throw new Error(
          `DOUBLE_BOOKING_PREVENTED: Slot "${slot.courtName || 'Court'} (${slot.timeLabel || ''})" is already booked by another player (#${existing.bookingReference}).`
        );
      }
      if (
        existing.status === 'HELD' &&
        existing.expiresAt &&
        existing.expiresAt > Date.now()
      ) {
        throw new Error(
          `SLOT_HELD_IN_PROGRESS: Slot "${slot.courtName || 'Court'} (${slot.timeLabel || ''})" is currently in checkout by another player. Please try again shortly.`
        );
      }
    }
  }

  // Step 2: Supabase Stored Procedure RPC with atomic SELECT ... FOR UPDATE (if configured)
  if (isSupabaseConfigured) {
    try {
      const { data: rpcResult, error: rpcError } = await supabase.rpc('claim_court_slots', {
        p_booking_reference: bookingReference,
        p_customer_name: customerName,
        p_selected_date: selectedDate,
        p_slots: slots,
        p_is_temp_hold: isTempHold,
        p_hold_ttl_seconds: holdTtlSeconds,
      });

      if (!rpcError && rpcResult?.success) {
        // Register into memory locks as well
        for (const slot of slots) {
          const timeLabel = slot.timeLabel || '';
          const match = timeLabel.match(/(\d{1,2}):(\d{2})/);
          const timeKey = match ? `${match[1].padStart(2, '0')}${match[2]}` : '0800';
          const cleanCourt = (slot.courtId || 'court-1').toLowerCase().trim();
          const dateStr = (slot.date || selectedDate || '').trim();
          const lockId = `${dateStr}_${cleanCourt}_${timeKey}`;

          memoryLocks.set(lockId, {
            lockId,
            bookingReference,
            customerName,
            selectedDate: dateStr,
            courtId: slot.courtId || 'court-1',
            courtName: slot.courtName || '',
            timeLabel: slot.timeLabel || '',
            status,
            lockedAt: nowIso,
            expiresAt: expiresAtMs,
          });
        }
        return rpcResult;
      }

      if (rpcError) {
        const msg = rpcError.message || '';
        if (msg.includes('DOUBLE_BOOKING_PREVENTED') || msg.includes('SLOT_HELD_IN_PROGRESS')) {
          throw new Error(msg);
        }
      }
    } catch (err: any) {
      if (
        err?.message &&
        (err.message.includes('DOUBLE_BOOKING_PREVENTED') || err.message.includes('SLOT_HELD_IN_PROGRESS'))
      ) {
        throw err;
      }
    }

    // Step 3: Resilient Fallback - Database row locks and unique constraint enforcement
    for (const slot of slots) {
      const timeLabel = slot.timeLabel || '';
      const match = timeLabel.match(/(\d{1,2}):(\d{2})/);
      const timeKey = match ? `${match[1].padStart(2, '0')}${match[2]}` : '0800';
      const cleanCourt = (slot.courtId || 'court-1').toLowerCase().trim();
      const dateStr = (slot.date || selectedDate || '').trim();
      const lockId = `${dateStr}_${cleanCourt}_${timeKey}`;

      const { data: existingLocks, error: lockCheckErr } = await supabase
        .from('court_slot_locks')
        .select(COURT_SLOT_LOCKS_CHECK_COLUMNS)
        .eq('lock_id', lockId)
        .limit(5);

      if (!lockCheckErr && existingLocks && existingLocks.length > 0) {
        const lock: any = existingLocks[0];
        const lockRef = (lock.booking_reference ?? lock.bookingReference ?? '').trim().toLowerCase();
        const lockStatus = lock.status;
        const lockExpiresAt = lock.expires_at ? new Date(lock.expires_at).getTime() : 0;

        if (lockRef !== normalizedBookingRef) {
          if (lockStatus === 'BOOKED') {
            throw new Error(
              `DOUBLE_BOOKING_PREVENTED: Slot "${slot.courtName || 'Court'} (${slot.timeLabel || ''})" is already booked by another player (#${lock.booking_reference || lockRef}).`
            );
          }

          if (lockStatus === 'HELD' && lockExpiresAt > Date.now()) {
            throw new Error(
              `SLOT_HELD_IN_PROGRESS: Slot "${slot.courtName || 'Court'} (${slot.timeLabel || ''})" is currently in checkout by another player. Please try again shortly.`
            );
          }
        }
      }

      const lockPayload: any = {
        lock_id: lockId,
        booking_reference: bookingReference,
        customer_name: customerName,
        date: dateStr,
        court_id: slot.courtId || 'court-1',
        court_name: slot.courtName || '',
        time_label: slot.timeLabel || '',
        status: status,
        locked_at: nowIso,
        expires_at: expiresAtIso,
      };

      const { error: lockUpsertErr } = await supabase
        .from('court_slot_locks')
        .upsert(lockPayload, { onConflict: 'lock_id' });

      if (lockUpsertErr) {
        if (lockUpsertErr.code === '23505' || lockUpsertErr.message.includes('unique_court_time_slot')) {
          throw new Error(
            `DOUBLE_BOOKING_PREVENTED: Slot "${slot.courtName || 'Court'} (${slot.timeLabel || ''})" was just booked by another player.`
          );
        }
        if (!isTableMissingError(lockUpsertErr)) {
          console.warn('[LOCKS] Fallback lock upsert notice:', lockUpsertErr);
        }
      }
    }
  }

  // Register in memory
  for (const slot of slots) {
    const timeLabel = slot.timeLabel || '';
    const match = timeLabel.match(/(\d{1,2}):(\d{2})/);
    const timeKey = match ? `${match[1].padStart(2, '0')}${match[2]}` : '0800';
    const cleanCourt = (slot.courtId || 'court-1').toLowerCase().trim();
    const dateStr = (slot.date || selectedDate || '').trim();
    const lockId = `${dateStr}_${cleanCourt}_${timeKey}`;

    memoryLocks.set(lockId, {
      lockId,
      bookingReference,
      customerName,
      selectedDate: dateStr,
      courtId: slot.courtId || 'court-1',
      courtName: slot.courtName || '',
      timeLabel: slot.timeLabel || '',
      status,
      lockedAt: nowIso,
      expiresAt: expiresAtMs,
    });
  }

  cachedBookingsByDate.delete(selectedDate);
  return { success: true, bookingReference, status, expiresAt: expiresAtIso };
}

/**
 * Acquire a 5-minute (300-second) temporary reservation lock (TTL Hold) when user enters checkout
 */
export async function holdSlotsWithTtl(
  bookingReference: string,
  selectedDate: string,
  slots: any[],
  customerName = '',
  ttlSeconds = 300
) {
  return claimSlotsTransaction(bookingReference, customerName, selectedDate, slots, true, ttlSeconds);
}

/**
 * Release temporary slot hold if user cancels or leaves checkout
 */
export async function releaseSlotHold(bookingReference: string) {
  if (!bookingReference) return { success: true };

  // Clear from in-memory locks
  for (const [key, lock] of memoryLocks.entries()) {
    if (lock.bookingReference === bookingReference && lock.status === 'HELD') {
      cachedBookingsByDate.delete(lock.selectedDate);
      memoryLocks.delete(key);
    }
  }

  if (isSupabaseConfigured) {
    try {
      await supabase
        .from('court_slot_locks')
        .delete()
        .eq('booking_reference', bookingReference)
        .eq('status', 'HELD');
    } catch (err) {
      console.warn('[LOCKS] Error releasing slot hold:', err);
    }
  }
  return { success: true };
}

/**
 * Create or save a confirmed booking with atomic slot locks using Supabase syntax
 */
export async function saveBookingWithLocks(bookingData: BookingInput) {
  const now = new Date();
  const nowIso = now.toISOString();

  if (!isSupabaseConfigured) {
    return normalizeBookingRow(bookingData);
  }

  try {
    // 0. Guard against booking_reference reuse/collision so an existing booking can NEVER be overwritten
    let effectiveRef = (bookingData.bookingReference || '').trim() || `MS-${Math.floor(100000 + Math.random() * 900000)}`;
    const existingWithSameRef = await getBookingByReference(effectiveRef);

    if (existingWithSameRef) {
      const existingSlotIds = new Set((existingWithSameRef.slots || []).map((s: any) => s.slotId));
      const incomingSlotIds = (bookingData.slots || []).map((s: any) => s.slotId);
      const isSameCustomer =
        (existingWithSameRef.customerName || '').trim().toLowerCase() ===
        (bookingData.customerName || '').trim().toLowerCase();
      const isSameSlots =
        incomingSlotIds.length > 0 &&
        incomingSlotIds.length === existingSlotIds.size &&
        incomingSlotIds.every((id: string) => existingSlotIds.has(id));

      // True idempotent retry of the exact same booking: return existing record safely
      if (isSameCustomer && isSameSlots && existingWithSameRef.selectedDate === bookingData.selectedDate) {
        return existingWithSameRef;
      }

      // Different customer or slots colliding on a stale/reused reference: assign a brand-new unique reference
      effectiveRef = `MS-${Math.floor(100000 + Math.random() * 900000)}`;
    }

    // 1. Atomically claim/upgrade slot locks to 'BOOKED' status (clears any temporary TTL holds)
    await claimSlotsTransaction(
      effectiveRef,
      bookingData.customerName,
      bookingData.selectedDate,
      bookingData.slots,
      false // Final confirmed booking, not temporary hold
    );

    // 2. Insert (never upsert/overwrite) the booking record in Supabase
    const bookingPayload = {
      booking_reference: effectiveRef,
      selected_date: bookingData.selectedDate,
      payment_method: bookingData.paymentMethod || 'GCash (PayMongo)',
      customer_name: bookingData.customerName,
      customer_phone: bookingData.customerPhone,
      customer_notes: bookingData.customerNotes || '',
      slots: bookingData.slots,
      total_amount: Number(bookingData.totalAmount) || 0,
      payment_proof_url: bookingData.paymentProofUrl || '',
      status: bookingData.status || 'BOOKED',
      confirmed_at: bookingData.confirmedAt || nowIso,
      booked_at: bookingData.bookedAt || nowIso,
      updated_at: nowIso,
    };

    let { data, error } = await supabase
      .from('bookings')
      .insert(bookingPayload)
      .select(BOOKINGS_LOG_COLUMNS)
      .maybeSingle();

    if (error && error.message.includes('booking_reference')) {
      // Retry with camelCase keys if table was defined with camelCase
      const camelPayload = {
        bookingReference: effectiveRef,
        selectedDate: bookingData.selectedDate,
        paymentMethod: bookingData.paymentMethod || 'GCash (PayMongo)',
        customerName: bookingData.customerName,
        customerPhone: bookingData.customerPhone,
        customerNotes: bookingData.customerNotes || '',
        slots: bookingData.slots,
        totalAmount: Number(bookingData.totalAmount) || 0,
        paymentProofUrl: bookingData.paymentProofUrl || '',
        status: bookingData.status || 'BOOKED',
        confirmedAt: bookingData.confirmedAt || nowIso,
        bookedAt: bookingData.bookedAt || nowIso,
        updatedAt: nowIso,
      };
      const fallback = await supabase
        .from('bookings')
        .insert(camelPayload)
        .select(BOOKINGS_LOG_CAMEL_COLUMNS)
        .maybeSingle();
      data = fallback.data as any;
      error = fallback.error;
    }

    if (error) {
      if (isTableMissingError(error)) {
        warnTableMissingOnce();
        return normalizeBookingRow(bookingPayload);
      }
      console.error('Failed to save booking to Supabase:', error);
      throw new Error(error.message || 'Database insert for booking failed.');
    }

    const saved = normalizeBookingRow(data || bookingPayload);
    invalidateServerBookingsCache(saved);
    return saved;
  } catch (error: any) {
    if (error?.message && error.message.includes('DOUBLE_BOOKING_PREVENTED')) {
      throw error;
    }
    if (isTableMissingError(error)) {
      warnTableMissingOnce();
      const fallback = normalizeBookingRow(bookingData);
      invalidateServerBookingsCache(fallback);
      return fallback;
    }
    console.error('Failed to save booking to Supabase:', error);
    throw new Error(error.message || 'Database operation for booking failed.', { cause: error });
  }
}

/**
 * Delete a booking and release its slot locks from Supabase
 */
export async function deleteBookingByReference(bookingReference: string) {
  if (!isSupabaseConfigured) {
    invalidateServerBookingsCache(undefined, bookingReference);
    return { bookingReference };
  }

  try {
    // 1. Release or delete slot locks
    await supabase
      .from('court_slot_locks')
      .delete()
      .eq('booking_reference', bookingReference);

    // 2. Delete the booking from Supabase
    let { data, error } = await supabase
      .from('bookings')
      .delete()
      .eq('booking_reference', bookingReference)
      .select('id, booking_reference');

    if (error && error.message.includes('booking_reference')) {
      const fallback = await supabase
        .from('bookings')
        .delete()
        .eq('bookingReference', bookingReference)
        .select('id, bookingReference');
      data = fallback.data as any;
      error = fallback.error;
    }

    if (error) {
      if (isTableMissingError(error)) {
        invalidateServerBookingsCache(undefined, bookingReference);
        return { bookingReference };
      }
      console.error('Failed to delete booking from Supabase:', error);
      throw new Error(error.message || 'Database deletion failed.');
    }

    invalidateServerBookingsCache(undefined, bookingReference);
    return data && data[0] ? normalizeBookingRow(data[0]) : { bookingReference };
  } catch (error: any) {
    if (isTableMissingError(error)) {
      return { bookingReference };
    }
    console.error('Failed to delete booking from Supabase:', error);
    throw new Error('Database deletion failed.', { cause: error });
  }
}

/**
 * Update an existing booking in Supabase
 */
export async function updateBookingFields(
  bookingReference: string,
  updates: Partial<BookingInput>
) {
  if (!isSupabaseConfigured) {
    return { bookingReference, ...updates };
  }

  try {
    const nowIso = new Date().toISOString();
    const updatePayload: Record<string, any> = {
      updated_at: nowIso,
    };

    if (updates.selectedDate !== undefined) updatePayload.selected_date = updates.selectedDate;
    if (updates.customerName !== undefined) updatePayload.customer_name = updates.customerName;
    if (updates.customerPhone !== undefined) updatePayload.customer_phone = updates.customerPhone;
    if (updates.customerNotes !== undefined) updatePayload.customer_notes = updates.customerNotes;
    if (updates.totalAmount !== undefined) updatePayload.total_amount = updates.totalAmount;
    if (updates.status !== undefined) updatePayload.status = updates.status;
    if (updates.slots !== undefined) updatePayload.slots = updates.slots;
    if (updates.paymentProofUrl !== undefined) updatePayload.payment_proof_url = updates.paymentProofUrl;

    let { data, error } = await supabase
      .from('bookings')
      .update(updatePayload)
      .eq('booking_reference', bookingReference)
      .select(BOOKINGS_LOG_COLUMNS)
      .maybeSingle();

    if (error && error.message.includes('booking_reference')) {
      const camelPayload: Record<string, any> = {
        updatedAt: nowIso,
      };
      if (updates.selectedDate !== undefined) camelPayload.selectedDate = updates.selectedDate;
      if (updates.customerName !== undefined) camelPayload.customerName = updates.customerName;
      if (updates.customerPhone !== undefined) camelPayload.customerPhone = updates.customerPhone;
      if (updates.customerNotes !== undefined) camelPayload.customerNotes = updates.customerNotes;
      if (updates.totalAmount !== undefined) camelPayload.totalAmount = updates.totalAmount;
      if (updates.status !== undefined) camelPayload.status = updates.status;
      if (updates.slots !== undefined) camelPayload.slots = updates.slots;
      if (updates.paymentProofUrl !== undefined) camelPayload.paymentProofUrl = updates.paymentProofUrl;

      const fallback = await supabase
        .from('bookings')
        .update(camelPayload)
        .eq('bookingReference', bookingReference)
        .select(BOOKINGS_LOG_CAMEL_COLUMNS)
        .maybeSingle();
      data = fallback.data as any;
      error = fallback.error;
    }

    if (error) {
      if (isTableMissingError(error)) {
        return { bookingReference, ...updates };
      }
      console.error('Failed to update booking in Supabase:', error);
      throw new Error(error.message || 'Database update failed.');
    }

    // If status is CANCELLED or REJECTED, release slot locks
    if (updates.status === 'CANCELLED' || updates.status === 'REJECTED') {
      await supabase
        .from('court_slot_locks')
        .update({ status: 'RELEASED' })
        .eq('booking_reference', bookingReference);
    }

    const updated = data ? normalizeBookingRow(data) : { bookingReference, ...updates };
    invalidateServerBookingsCache(updated);
    return updated;
  } catch (error: any) {
    if (isTableMissingError(error)) {
      return { bookingReference, ...updates };
    }
    console.error('Failed to update booking in Supabase:', error);
    throw new Error('Database update failed.', { cause: error });
  }
}

/**
 * Targeted query for single booking payment proof URL to avoid downloading heavy images during list queries
 */
export async function getBookingReceiptByReference(bookingReference: string): Promise<string | null> {
  if (!isSupabaseConfigured || !bookingReference) return null;
  try {
    const { data, error } = await supabase
      .from('bookings')
      .select('payment_proof_url')
      .eq('booking_reference', bookingReference)
      .maybeSingle();

    if (!error && data?.payment_proof_url) {
      return data.payment_proof_url;
    }

    const fallback = await supabase
      .from('bookings')
      .select('paymentProofUrl')
      .eq('bookingReference', bookingReference)
      .maybeSingle();

    return (fallback.data as any)?.paymentProofUrl || null;
  } catch {
    return null;
  }
}

