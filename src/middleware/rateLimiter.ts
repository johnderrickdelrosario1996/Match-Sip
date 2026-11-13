import { Request, Response, NextFunction } from 'express';

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

// In-memory rate limiting stores
const readRateLimitStore = new Map<string, RateLimitRecord>();
const writeRateLimitStore = new Map<string, RateLimitRecord>();

// Duplicate submission tracking: stores hash/key -> timestamp
const recentSubmissions = new Map<string, { timestamp: number; bookingRef: string; slotsKey: string }>();

// In-flight active locks: stores slotsKey -> Promise or lock active boolean
const inFlightSubmissionLocks = new Set<string>();

// Cleanup stale records periodically every 60 seconds
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of readRateLimitStore.entries()) {
    if (record.resetAt <= now) {
      readRateLimitStore.delete(key);
    }
  }
  for (const [key, record] of writeRateLimitStore.entries()) {
    if (record.resetAt <= now) {
      writeRateLimitStore.delete(key);
    }
  }
  for (const [key, submission] of recentSubmissions.entries()) {
    if (now - submission.timestamp > 15000) {
      recentSubmissions.delete(key);
    }
  }
}, 60000);

function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return forwarded[0].trim();
  }
  return req.socket?.remoteAddress || '127.0.0.1';
}

/**
 * Rate limiter for read requests (GET /api/sql/bookings)
 * Default: 120 requests per minute per IP to accommodate real-time tab polling.
 */
export function bookingsReadLimiter(maxRequests = 120, windowMs = 60000) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = getClientIp(req);
    const now = Date.now();
    let record = readRateLimitStore.get(ip);

    if (!record || record.resetAt <= now) {
      record = { count: 1, resetAt: now + windowMs };
      readRateLimitStore.set(ip, record);
    } else {
      record.count += 1;
    }

    const remaining = Math.max(0, maxRequests - record.count);
    const resetSeconds = Math.ceil((record.resetAt - now) / 1000);

    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', resetSeconds);

    if (record.count > maxRequests) {
      res.setHeader('Retry-After', resetSeconds);
      return res.status(429).json({
        success: false,
        error: 'Too many requests. Please slow down and try again shortly.',
        retryAfter: resetSeconds,
      });
    }

    next();
  };
}

/**
 * Rate limiter for write requests (POST / PUT / DELETE /api/sql/bookings)
 * Protects against spam, script automated submissions, and double-booking attacks.
 * Default: 20 write operations per minute per IP.
 */
export function bookingsWriteLimiter(maxRequests = 20, windowMs = 60000) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = getClientIp(req);
    const now = Date.now();
    let record = writeRateLimitStore.get(ip);

    if (!record || record.resetAt <= now) {
      record = { count: 1, resetAt: now + windowMs };
      writeRateLimitStore.set(ip, record);
    } else {
      record.count += 1;
    }

    const remaining = Math.max(0, maxRequests - record.count);
    const resetSeconds = Math.ceil((record.resetAt - now) / 1000);

    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', resetSeconds);

    if (record.count > maxRequests) {
      res.setHeader('Retry-After', resetSeconds);
      return res.status(429).json({
        success: false,
        error: 'Booking submission rate limit exceeded. Please wait a moment before trying again.',
        retryAfter: resetSeconds,
      });
    }

    next();
  };
}

/**
 * Accidental duplicate submission & concurrent double-booking protection middleware.
 * Detects rapid re-submissions of identical booking references or identical slot locks within 6 seconds.
 */
export function duplicateBookingProtection(req: Request, res: Response, next: NextFunction) {
  const ip = getClientIp(req);
  const now = Date.now();
  const body = req.body || {};

  const bookingRef = (body.bookingReference || body.booking?.bookingReference || '').trim();
  const selectedDate = (body.selectedDate || body.booking?.selectedDate || '').trim();
  const rawSlots = Array.isArray(body.slots) ? body.slots : Array.isArray(body.booking?.slots) ? body.booking.slots : [];

  // Generate canonical key for slots being booked (e.g. "2026-10-12:court-1-2000,court-2-2100")
  const slotKeys = rawSlots
    .map((s: any) => {
      const c = (s.courtId || 'court-1').toLowerCase();
      const t = (s.timeLabel || '').replace(/\s+/g, '');
      return `${c}-${t}`;
    })
    .sort()
    .join('|');

  const dedupeKey = bookingRef ? `${ip}:${bookingRef}` : `${ip}:${selectedDate}:${slotKeys}`;
  const slotsLockKey = slotKeys ? `${selectedDate}:${slotKeys}` : '';

  // 1. Check if identical request is currently in-flight
  if (slotsLockKey && inFlightSubmissionLocks.has(slotsLockKey)) {
    return res.status(429).json({
      success: false,
      error: 'A booking transaction for these high-demand slots is currently processing. Please wait a few seconds.',
      isDuplicate: true,
    });
  }

  // 2. Check if identical submission occurred in the last 6 seconds (rapid double-tap on mobile)
  const previous = recentSubmissions.get(dedupeKey);
  if (previous && now - previous.timestamp < 6000) {
    return res.status(429).json({
      success: false,
      error: 'Duplicate booking submission detected. Please do not double-click.',
      isDuplicate: true,
      retryAfter: Math.ceil((6000 - (now - previous.timestamp)) / 1000),
    });
  }

  // Register in-flight and recent submission
  recentSubmissions.set(dedupeKey, { timestamp: now, bookingRef, slotsKey: slotsLockKey });
  if (slotsLockKey) {
    inFlightSubmissionLocks.add(slotsLockKey);
  }

  // Release in-flight lock on response finish/close
  const releaseLock = () => {
    if (slotsLockKey) {
      inFlightSubmissionLocks.delete(slotsLockKey);
    }
  };

  res.once('finish', releaseLock);
  res.once('close', releaseLock);

  next();
}

// -------------------------------------------------------------
// Admin PIN Brute-Force & Lockout Protection
// -------------------------------------------------------------
interface PinBruteForceRecord {
  failures: number;
  lockedUntil: number;
}
const pinBruteForceStore = new Map<string, PinBruteForceRecord>();

export function checkPinLockout(ip: string): { locked: boolean; remainingMinutes: number } {
  const record = pinBruteForceStore.get(ip);
  if (!record) return { locked: false, remainingMinutes: 0 };
  const now = Date.now();
  if (record.lockedUntil > now) {
    return { locked: true, remainingMinutes: Math.ceil((record.lockedUntil - now) / 60000) };
  }
  if (record.lockedUntil > 0 && record.lockedUntil <= now) {
    pinBruteForceStore.delete(ip);
  }
  return { locked: false, remainingMinutes: 0 };
}

export function recordPinFailure(ip: string): {
  locked: boolean;
  remainingAttempts: number;
  remainingMinutes?: number;
} {
  const now = Date.now();
  const record = pinBruteForceStore.get(ip) || { failures: 0, lockedUntil: 0 };
  record.failures += 1;
  const maxAttempts = 5;
  if (record.failures >= maxAttempts) {
    record.lockedUntil = now + 15 * 60 * 1000; // 15-minute security lockout
    pinBruteForceStore.set(ip, record);
    return { locked: true, remainingAttempts: 0, remainingMinutes: 15 };
  }
  pinBruteForceStore.set(ip, record);
  return { locked: false, remainingAttempts: maxAttempts - record.failures };
}

export function recordPinSuccess(ip: string): void {
  pinBruteForceStore.delete(ip);
}

/**
 * Custom rate limiter middleware for sensitive operations (e.g. test email, PIN verification)
 */
export function customRateLimiter(
  maxRequests = 5,
  windowMs = 60000,
  message = 'Rate limit exceeded. Please try again later.'
) {
  const store = new Map<string, RateLimitRecord>();
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = getClientIp(req);
    const now = Date.now();
    let record = store.get(ip);
    if (!record || record.resetAt <= now) {
      record = { count: 1, resetAt: now + windowMs };
      store.set(ip, record);
    } else {
      record.count += 1;
    }
    if (record.count > maxRequests) {
      const resetSeconds = Math.ceil((record.resetAt - now) / 1000);
      return res.status(429).json({
        success: false,
        error: message,
        retryAfter: resetSeconds,
      });
    }
    next();
  };
}
