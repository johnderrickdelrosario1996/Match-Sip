import './src/lib/loadEnv.ts';
import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import { getMaintenanceStatus } from './src/db/settings.ts';
import {
  getAllBookings,
  getBookingsByDate,
  getBookingByReference,
  saveBookingWithLocks,
  deleteBookingByReference,
  updateBookingFields,
  holdSlotsWithTtl,
  releaseSlotHold,
  getBookingReceiptByReference,
} from './src/db/bookings.ts';

import {
  duplicateBookingProtection,
  bookingsReadLimiter,
  bookingsWriteLimiter,
  checkPinLockout,
  recordPinFailure,
  recordPinSuccess,
  customRateLimiter,
} from './src/middleware/rateLimiter.ts';

import {
  ADMIN_NOTIFICATION_EMAILS,
} from './src/config/emailConfig.ts';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const ADMIN_PIN = (process.env.ADMIN_PIN || '').trim();

// Security middleware: Require valid Admin PIN header or query/body
function requireAdminPin(req: Request, res: Response, next: NextFunction) {
  if (!ADMIN_PIN) {
    return res.status(500).json({
      success: false,
      error: 'Server configuration error: ADMIN_PIN is not configured in .env.',
    });
  }
  const headerPin = req.headers['x-admin-pin'] as string;
  const queryPin = (req.query.admin_pin as string) || (req.query.adminPin as string);
  const bodyPin = req.body?.adminPin || req.body?.pin;
  const candidate = (headerPin || queryPin || bodyPin || '').trim();

  if (!candidate || candidate !== ADMIN_PIN) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Valid Admin PIN required for this administrative operation.',
    });
  }
  next();
}

// Ensure public upload directories exist for local receipt storage
const UPLOADS_DIR = path.join(process.cwd(), 'public', 'uploads', 'receipts');
try {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
} catch (err) {
  console.warn('[SERVER] Could not initialize uploads directory:', err);
}

// Parse admin recipient emails from config and environment
const envAdminEmails = (process.env.ADMIN_EMAIL || process.env.ADMIN_NOTIFICATION_EMAIL || '')
  .split(',')
  .map((e) => e.trim())
  .filter(Boolean);

const ADMIN_EMAILS: string[] = Array.from(
  new Set(
    [
      ...ADMIN_NOTIFICATION_EMAILS.map((e) => e.toLowerCase().trim()),
      ...envAdminEmails.map((e) => e.toLowerCase().trim()),
    ].filter(Boolean)
  )
);

if (ADMIN_EMAILS.length === 0) {
  ADMIN_EMAILS.push('danamieratan@gmail.com');
}

const BUILD_TIME = Date.now();

// Resend Email Client: loaded strictly from server-side .env (RESEND_API_KEY)
function getResendApiKey(): string | null {
  const apiKey = (process.env.RESEND_API_KEY || '').trim();
  return apiKey || null;
}

// Global Middleware
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
app.use('/uploads', express.static(path.join(process.cwd(), 'public', 'uploads')));

// Trust reverse proxy (Cloud Run, load balancers)
app.set('trust proxy', 1);

// -------------------------------------------------------------
// ADMIN SECURITY & VERIFICATION
// -------------------------------------------------------------

/**
 * Admin PIN Verification Endpoint with Brute-Force Rate Limiting & Lockout
 */
app.post('/api/admin/verify', async (req: Request, res: Response) => {
  const ip =
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    req.socket.remoteAddress ||
    '127.0.0.1';

  // 1. Check if IP is currently locked out
  const lockout = checkPinLockout(ip);
  if (lockout.locked) {
    return res.status(429).json({
      success: false,
      error: `Security Lockout: Too many incorrect PIN attempts. Please wait ${lockout.remainingMinutes} minute(s) before trying again.`,
      locked: true,
      remainingMinutes: lockout.remainingMinutes,
    });
  }

  if (!ADMIN_PIN) {
    return res.status(500).json({
      success: false,
      error: 'Server configuration error: ADMIN_PIN is not configured in .env.',
    });
  }

  const { pin } = req.body || {};
  const cleanPin = (pin || '').trim();

  if (!cleanPin || cleanPin !== ADMIN_PIN) {
    const failure = recordPinFailure(ip);
    if (failure.locked) {
      return res.status(429).json({
        success: false,
        error: 'Too many incorrect PIN attempts. Security lockout active for 15 minutes.',
        locked: true,
        remainingMinutes: failure.remainingMinutes,
      });
    }
    return res.status(401).json({
      success: false,
      error: `Incorrect PIN. ${failure.remainingAttempts} attempt(s) remaining before security lockout.`,
      remainingAttempts: failure.remainingAttempts,
    });
  }

  // Success: Clear any prior failure count
  recordPinSuccess(ip);
  return res.json({ success: true, verified: true });
});

// -------------------------------------------------------------
// 1. SYSTEM STATUS & MAINTENANCE API (Dual-Layer Server-Side Guard)
// -------------------------------------------------------------

/**
 * Public lightweight status endpoint.
 * Returns current maintenance mode state and message.
 */
app.get('/api/status', async (_req: Request, res: Response) => {
  try {
    const status = await getMaintenanceStatus();
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    return res.json({
      success: true,
      maintenanceMode: status.enabled,
      message: status.message,
      updatedAt: status.updatedAt,
      timestamp: Date.now(),
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      maintenanceMode: false,
      error: err.message || 'Failed to query system status',
    });
  }
});

// Middleware to strictly reject any booking / hold actions when maintenance mode is active
const enforceMaintenanceBlock = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const status = await getMaintenanceStatus();
    if (status.enabled) {
      return res.status(503).json({
        success: false,
        maintenanceMode: true,
        error:
          status.message ||
          'MATCH & SIP is currently under maintenance. Online court reservations are temporarily paused.',
      });
    }
    next();
  } catch {
    next();
  }
};

// -------------------------------------------------------------
// 2. BOOKINGS & SLOT LOCKS API
// -------------------------------------------------------------

/**
 * Fetch bookings (sanitizes PII for public requests; full details for admin)
 */
app.get('/api/bookings', bookingsReadLimiter(180, 60000), async (req: Request, res: Response) => {
  try {
    const candidatePin = (
      (req.headers['x-admin-pin'] as string) ||
      (req.query.admin_pin as string) ||
      (req.query.adminPin as string) ||
      ''
    ).trim();
    const isAdmin = Boolean(ADMIN_PIN) && candidatePin === ADMIN_PIN;

    const { date, limit, page, offset } = req.query;
    const limitNum = typeof limit === 'string' ? Math.min(Math.max(1, parseInt(limit, 10) || 50), 100) : 50;
    const pageNum = typeof page === 'string' ? Math.max(1, parseInt(page, 10) || 1) : 1;
    const offsetNum = typeof offset === 'string' ? Math.max(0, parseInt(offset, 10) || 0) : undefined;

    let rawBookings: any[] = [];
    if (typeof date === 'string' && date.trim()) {
      rawBookings = await getBookingsByDate(date.trim());
    } else {
      rawBookings = await getAllBookings({
        limit: limitNum,
        page: pageNum,
        offset: offsetNum,
      });
    }

    const paginationMeta = {
      page: pageNum,
      limit: limitNum,
      count: rawBookings.length,
      hasMore: rawBookings.length >= limitNum,
    };

    if (isAdmin) {
      return res.json({ success: true, bookings: rawBookings, pagination: paginationMeta });
    }

    // Sanitize customer PII for public requests to protect player privacy
    const sanitizedBookings = (rawBookings || []).map((b: any) => ({
      id: b.id,
      bookingReference: b.bookingReference,
      selectedDate: b.selectedDate,
      status: b.status,
      slots: b.slots,
      customerName: 'Reserved Player',
      customerPhone: '',
      customerEmail: '',
      customerNotes: '',
      paymentProofUrl: '',
      paymentMethod: '',
      totalAmount: 0,
      createdAt: b.createdAt,
      confirmedAt: b.confirmedAt,
    }));

    return res.json({ success: true, bookings: sanitizedBookings, pagination: paginationMeta });
  } catch (err: any) {
    console.warn('[API] Warning fetching bookings, serving resilient fallback:', err?.message || err);
    try {
      const limitNum = typeof req.query.limit === 'string' ? Math.min(Math.max(1, parseInt(req.query.limit, 10) || 50), 100) : 50;
      const fallback = await getAllBookings({ limit: limitNum });
      const isCandidateAdmin = Boolean(ADMIN_PIN) && (
        (req.headers['x-admin-pin'] as string) ||
        (req.query.admin_pin as string) ||
        (req.query.adminPin as string) ||
        ''
      ).trim() === ADMIN_PIN;

      if (isCandidateAdmin) {
        return res.json({ success: true, bookings: fallback, isFallback: true });
      }

      const sanitized = (fallback || []).map((b: any) => ({
        id: b.id,
        bookingReference: b.bookingReference,
        selectedDate: b.selectedDate,
        status: b.status,
        slots: b.slots,
        customerName: 'Reserved Player',
        customerPhone: '',
        customerEmail: '',
        customerNotes: '',
        paymentProofUrl: '',
        paymentMethod: '',
        totalAmount: 0,
        createdAt: b.createdAt,
        confirmedAt: b.confirmedAt,
      }));
      return res.json({ success: true, bookings: sanitized, isFallback: true });
    } catch {
      return res.json({ success: true, bookings: [], isFallback: true });
    }
  }
});

/**
 * Save new confirmed booking with database-level concurrency locks
 */
app.post(
  '/api/bookings',
  enforceMaintenanceBlock,
  duplicateBookingProtection,
  bookingsWriteLimiter(30, 60000),
  async (req: Request, res: Response) => {
    try {
      const bookingData = req.body;
      if (!bookingData || !bookingData.bookingReference) {
        return res.status(400).json({
          success: false,
          error: 'Missing required booking data or booking reference.',
        });
      }

      const saved = await saveBookingWithLocks(bookingData);
      return res.json({
        success: true,
        booking: saved,
      });
    } catch (err: any) {
      const msg = err.message || '';
      if (
        msg.includes('DOUBLE_BOOKING_PREVENTED') ||
        msg.includes('SLOT_HELD_IN_PROGRESS') ||
        msg.includes('Slot conflict')
      ) {
        return res.status(409).json({
          success: false,
          error: msg,
        });
      }

      console.error('[API] Error saving booking:', err);
      return res.status(500).json({
        success: false,
        error: msg || 'Failed to save booking to database.',
      });
    }
  }
);

/**
 * Update an existing booking (Protected: Requires Admin PIN)
 */
app.put('/api/bookings/:id', requireAdminPin, bookingsWriteLimiter(40, 60000), async (req: Request, res: Response) => {
  try {
    const bookingRef = req.params.id;
    const updates = req.body;
    const updated = await updateBookingFields(bookingRef, updates);
    return res.json({ success: true, booking: updated });
  } catch (err: any) {
    console.error('[API] Error updating booking:', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to update booking',
    });
  }
});

/**
 * Delete a booking and release its slot locks (Protected: Requires Admin PIN)
 */
app.delete('/api/bookings/:id', requireAdminPin, bookingsWriteLimiter(40, 60000), async (req: Request, res: Response) => {
  try {
    const bookingRef = req.params.id;
    const deleted = await deleteBookingByReference(bookingRef);
    return res.json({ success: true, booking: deleted });
  } catch (err: any) {
    console.error('[API] Error deleting booking:', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to delete booking',
    });
  }
});

/**
 * Fetch only the payment proof receipt image for a single booking (Targeted, minimal egress)
 */
app.get('/api/bookings/:id/receipt', requireAdminPin, async (req: Request, res: Response) => {
  try {
    const bookingRef = req.params.id;
    const proofUrl = await getBookingReceiptByReference(bookingRef);
    return res.json({ success: true, paymentProofUrl: proofUrl || '' });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to fetch receipt image',
    });
  }
});

/**
 * Hold court slots with TTL (5-minute hold during checkout)
 */
app.post('/api/slots/hold', enforceMaintenanceBlock, async (req: Request, res: Response) => {
  try {
    const { bookingReference, selectedDate, slots, customerName, ttlSeconds } = req.body || {};
    if (!bookingReference || !selectedDate || !Array.isArray(slots) || slots.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters for slot hold.',
      });
    }

    const holdResult = await holdSlotsWithTtl(
      bookingReference,
      selectedDate,
      slots,
      customerName || '',
      ttlSeconds || 300
    );

    return res.json({ success: true, ...holdResult });
  } catch (err: any) {
    const msg = err.message || '';
    if (msg.includes('DOUBLE_BOOKING_PREVENTED') || msg.includes('SLOT_HELD_IN_PROGRESS')) {
      return res.status(409).json({
        success: false,
        error: msg,
      });
    }

    return res.status(500).json({
      success: false,
      error: msg || 'Failed to acquire slot lock',
    });
  }
});

/**
 * Release temporary slot hold
 */
app.post('/api/slots/release', async (req: Request, res: Response) => {
  try {
    const { bookingReference } = req.body || {};
    if (bookingReference) {
      await releaseSlotHold(bookingReference);
    }
    return res.json({ success: true });
  } catch (err: any) {
    return res.json({ success: true, warning: err.message });
  }
});

// -------------------------------------------------------------
// 3. CHECKOUT & PAYMENT INTEGRATIONS
// -------------------------------------------------------------

app.post('/api/create-checkout', enforceMaintenanceBlock, async (req: Request, res: Response) => {
  try {
    const { booking } = req.body || {};
    if (!booking || !booking.bookingReference) {
      return res.status(400).json({
        success: false,
        error: 'Missing booking details for checkout initialization.',
      });
    }

    // Default to InstaPay QR checkout for MATCH&SIP
    return res.json({
      success: true,
      checkoutUrl: '',
      qrCodeUrl: '/assets/images/INSTAPAY QR CODE.jpg',
      bookingReference: booking.bookingReference,
      provider: 'INSTAPAY_QR',
      isLive: true,
    });
  } catch (err: any) {
    console.error('[CHECKOUT] Error creating checkout:', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to create payment checkout.',
    });
  }
});

/**
 * Server-side receipt upload endpoint.
 * Saves compressed receipts locally to /public/uploads/receipts and serves at /uploads/receipts/
 * completely eliminating client CORS errors and 0% upload stalls.
 */
app.post('/api/upload-receipt', async (req: Request, res: Response) => {
  try {
    const { image, fileName, bookingReference } = req.body || {};
    if (!image || typeof image !== 'string') {
      return res.status(400).json({ success: false, error: 'Missing image data for receipt upload.' });
    }

    const match = image.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
    if (match) {
      const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
      const buffer = Buffer.from(match[2], 'base64');
      const cleanRef = (bookingReference || 'MS-RECEIPT').replace(/[^a-zA-Z0-9_-]/g, '');
      const safeFileName = `${cleanRef}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${ext}`;
      const filePath = path.join(UPLOADS_DIR, safeFileName);
      await fs.promises.writeFile(filePath, buffer);

      const downloadUrl = `/uploads/receipts/${safeFileName}`;
      return res.json({
        success: true,
        downloadUrl,
        fileName: safeFileName,
        sizeBytes: buffer.length,
      });
    }

    return res.json({
      success: true,
      downloadUrl: image,
      fileName: fileName || 'receipt.jpg',
      sizeBytes: image.length,
    });
  } catch (err: any) {
    console.warn('[UPLOAD] Error saving receipt to disk, falling back to data URL:', err?.message);
    return res.json({
      success: true,
      downloadUrl: req.body?.image,
    });
  }
});

app.post('/api/payment/simulate-pay', async (req: Request, res: Response) => {
  try {
    const { bookingReference } = req.body || {};
    if (!bookingReference) {
      return res.status(400).json({ success: false, error: 'Missing bookingReference' });
    }

    await updateBookingFields(bookingReference, { status: 'BOOKED' });
    return res.json({ success: true, bookingReference });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/payment/status/:ref', async (req: Request, res: Response) => {
  try {
    const booking = await getBookingByReference(req.params.ref);
    if (!booking) {
      return res.status(404).json({ success: false, error: 'Booking not found' });
    }
    return res.json({
      success: true,
      bookingReference: booking.bookingReference,
      status: booking.status,
      isBooked: booking.status === 'BOOKED' || booking.status === 'CONFIRMED',
      selectedDate: booking.selectedDate,
      customer: {
        fullName: booking.customerName,
        phoneNumber: booking.customerPhone,
        email: booking.customerEmail,
        notes: booking.customerNotes,
      },
      slots: booking.slots,
      totalAmount: booking.totalAmount,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// 4. EMAIL NOTIFICATIONS (Resend)
// -------------------------------------------------------------

/**
 * Resilient email dispatch helper:
 * 1. Attempts bulk dispatch.
 * 2. If rejected due to Resend sandbox restrictions (onboarding@resend.dev),
 *    automatically falls back to sending individually so permitted recipients
 *    (e.g. johnderrickdelrosario1996@gmail.com) receive the alert without failure.
 */
let cachedSandboxOwnerEmail: string | null = null;

async function postResendEmail(
  apiKey: string,
  payload: { from: string; to: string | string[]; subject: string; html: string; text?: string }
): Promise<{ ok: boolean; id?: string; errorMessage?: string; errorName?: string }> {
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data: any = await response.json().catch(() => ({}));
    if (response.ok && data?.id) {
      return { ok: true, id: data.id };
    }

    return {
      ok: false,
      errorName: data?.name || 'resend_error',
      errorMessage: data?.message || `Resend HTTP ${response.status}`,
    };
  } catch (err: any) {
    return {
      ok: false,
      errorName: 'network_error',
      errorMessage: err?.message || 'Network error contacting Resend API',
    };
  }
}

/**
 * Resilient email dispatch helper:
 * 1. When using a verified custom domain (not onboarding@resend.dev), attempts bulk dispatch first.
 * 2. In Resend free sandbox mode (onboarding@resend.dev), avoids multi-recipient validation_error
 *    by delivering directly to the permitted Resend account owner if known or discovered.
 */
async function dispatchNotificationEmail(
  apiKey: string,
  fromEmail: string,
  recipients: string[],
  subject: string,
  html: string,
  text?: string
): Promise<{ success: boolean; delivered: string[]; failed: { email: string; reason: string }[]; error?: string }> {
  const delivered: string[] = [];
  const failed: { email: string; reason: string }[] = [];

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const uniqueRecipients = Array.from(
    new Set(recipients.map((e) => e.toLowerCase().trim()).filter((e) => emailRegex.test(e)))
  );
  if (uniqueRecipients.length === 0) {
    return { success: false, delivered: [], failed: [], error: 'No valid recipient email addresses provided.' };
  }

  const cleanFrom = (fromEmail || 'MATCH and SIP <onboarding@resend.dev>').trim();
  const isSandboxSender = cleanFrom.toLowerCase().includes('onboarding@resend.dev');

  // 1. Only attempt bulk send when NOT using the single-recipient sandbox sender (or when there's 1 recipient)
  if (!isSandboxSender && uniqueRecipients.length > 1) {
    const bulkResult = await postResendEmail(apiKey, {
      from: cleanFrom,
      to: uniqueRecipients,
      subject,
      html,
      ...(text ? { text } : {}),
    });

    if (bulkResult.ok) {
      return { success: true, delivered: uniqueRecipients, failed: [] };
    }
  }

  // If sandbox owner was already discovered and is using onboarding@resend.dev, send directly to them first
  const targetOrder =
    isSandboxSender && cachedSandboxOwnerEmail
      ? [cachedSandboxOwnerEmail]
      : uniqueRecipients;

  // 2. Individual delivery
  let allowedOwnerEmail: string | null = cachedSandboxOwnerEmail;

  for (const recipient of targetOrder) {
    const singleResult = await postResendEmail(apiKey, {
      from: cleanFrom,
      to: recipient,
      subject,
      html,
      ...(text ? { text } : {}),
    });

    if (singleResult.ok) {
      delivered.push(recipient);
    } else {
      const msg = singleResult.errorMessage || 'Delivery failed';
      failed.push({ email: recipient, reason: msg });

      // Extract permitted owner email from Resend sandbox message if present
      const match = msg.match(/own email address \(([^)]+)\)/i);
      if (match && match[1]) {
        allowedOwnerEmail = match[1].toLowerCase().trim();
        cachedSandboxOwnerEmail = allowedOwnerEmail;
      }
    }
  }

  // 3. If no recipient received it yet, but Resend identified the verified account owner, auto-deliver to them
  if (delivered.length === 0 && allowedOwnerEmail && !delivered.includes(allowedOwnerEmail)) {
    const ownerResult = await postResendEmail(apiKey, {
      from: cleanFrom,
      to: allowedOwnerEmail,
      subject,
      html,
      ...(text ? { text } : {}),
    });

    if (ownerResult.ok) {
      delivered.push(allowedOwnerEmail);
    }
  }

  if (delivered.length > 0) {
    return { success: true, delivered, failed };
  }

  const firstReason = failed[0]?.reason || 'Delivery failed';
  let friendlyError = firstReason;
  if (firstReason.includes('API key is invalid')) {
    friendlyError = 'Invalid Resend API key. Please check RESEND_API_KEY in your .env file or secrets.';
  } else if (firstReason.includes('can only send testing emails') || firstReason.includes('onboarding@resend.dev')) {
    friendlyError = `Resend Free Sandbox: onboarding@resend.dev can only deliver to the verified Resend account owner (${allowedOwnerEmail || 'your Resend email'}). Verify a custom domain at resend.com/domains and set RESEND_FROM_EMAIL to send to other recipients.`;
  }

  return { success: false, delivered: [], failed, error: friendlyError };
}

app.post('/api/notify-admin', async (req: Request, res: Response) => {
  try {
    const { booking } = req.body || {};
    if (!booking) {
      return res.status(400).json({ success: false, error: 'Missing booking payload' });
    }

    const apiKey = getResendApiKey();
    if (!apiKey) {
      return res.json({
        success: true,
        message: 'Notification skipped (RESEND_API_KEY not configured)',
      });
    }

    const fromEmail = process.env.RESEND_FROM_EMAIL || 'MATCH and SIP <onboarding@resend.dev>';
    const slotsSummary = (booking.slots || [])
      .map((s: any) => `${s.courtName || 'Court'}: ${s.timeLabel || ''}`)
      .join(', ');

    const subject = `🎾 New Court Reservation: #${booking.bookingReference} (${booking.selectedDate})`;
    const html = `
      <div style="background-color: #5E2CB2; color: #ffffff; padding: 24px; border-radius: 16px; font-family: sans-serif; max-width: 550px; margin: 0 auto;">
        <h2 style="color: #00C6FF; margin-top: 0;">MATCH & SIP New Reservation</h2>
        <p>A new court booking has been confirmed:</p>
        <div style="background: rgba(255,255,255,0.1); padding: 16px; border-radius: 8px; margin: 16px 0;">
          <p style="margin: 4px 0;"><strong>Reference:</strong> #${booking.bookingReference}</p>
          <p style="margin: 4px 0;"><strong>Player:</strong> ${booking.customer?.fullName || booking.customerName}</p>
          <p style="margin: 4px 0;"><strong>Phone:</strong> ${booking.customer?.phoneNumber || booking.customerPhone}</p>
          <p style="margin: 4px 0;"><strong>Date:</strong> ${booking.selectedDate}</p>
          <p style="margin: 4px 0;"><strong>Slots:</strong> ${slotsSummary}</p>
          <p style="margin: 4px 0;"><strong>Total:</strong> ₱${booking.totalAmount}</p>
          <p style="margin: 4px 0;"><strong>Status:</strong> ${booking.status || 'BOOKED'}</p>
        </div>
      </div>
    `;

    const dispatchResult = await dispatchNotificationEmail(
      apiKey,
      fromEmail,
      ADMIN_EMAILS,
      subject,
      html
    );

    return res.json({
      success: true,
      message: dispatchResult.delivered.length > 0
        ? `Notification sent to ${dispatchResult.delivered.join(', ')}`
        : (dispatchResult.error || 'Notification recorded'),
      delivered: dispatchResult.delivered,
      notices: dispatchResult.failed,
    });
  } catch (err: any) {
    return res.json({ success: true, warning: err.message });
  }
});

// Direct Test Email Endpoint for Diagnostics (Protected: Requires Admin PIN & Rate Limited)
app.post(
  '/api/test-email',
  requireAdminPin,
  customRateLimiter(3, 15 * 60 * 1000, 'Test email limit exceeded (max 3 per 15 min). Please wait before trying again.'),
  async (_req: Request, res: Response) => {
  try {
    const apiKey = getResendApiKey();
    if (!apiKey) {
      return res.status(400).json({
        success: false,
        error:
          'RESEND_API_KEY is not configured. Please add RESEND_API_KEY to your .env file or configure your secrets.',
      });
    }

    const fromEmail = process.env.RESEND_FROM_EMAIL || 'MATCH and SIP <onboarding@resend.dev>';
    const now = new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' });

    const subject = `🔔 MATCH&SIP Admin Notification Test (${now})`;
    const html = `
      <div style="background-color: #5E2CB2; color: #ffffff; padding: 24px; border-radius: 16px; font-family: sans-serif; max-width: 500px; margin: 0 auto;">
        <h2 style="color: #00C6FF; margin-top: 0;">MATCH&SIP Test Email</h2>
        <p>This is a live test email confirming that your Resend automated booking notification system is connected and working properly.</p>
        <div style="background: rgba(255,255,255,0.1); padding: 14px; border-radius: 8px; margin: 16px 0;">
          <p style="margin: 4px 0;"><strong>Recipients:</strong> ${ADMIN_EMAILS.join(', ')}</p>
          <p style="margin: 4px 0;"><strong>Timestamp:</strong> ${now}</p>
          <p style="margin: 4px 0;"><strong>Sender:</strong> ${fromEmail}</p>
        </div>
        <p style="font-size: 12px; color: #B3A2DB;">If you see this in your Spam or Junk folder, click <strong>"Not Spam"</strong> so future real-time customer booking alerts arrive straight to your Primary Inbox!</p>
      </div>
    `;
    const text = `MATCH&SIP Test Email\n\nThis confirms your Resend integration is functioning.\nRecipients: ${ADMIN_EMAILS.join(', ')}\nTimestamp: ${now}`;

    const dispatchResult = await dispatchNotificationEmail(
      apiKey,
      fromEmail,
      ADMIN_EMAILS,
      subject,
      html,
      text
    );

    if (!dispatchResult.success) {
      return res.status(400).json({
        success: false,
        error: dispatchResult.error,
        details: dispatchResult.failed,
      });
    }

    return res.json({
      success: true,
      message: `Test email sent successfully to ${dispatchResult.delivered.join(', ')}`,
      delivered: dispatchResult.delivered,
      notices: dispatchResult.failed,
    });
  } catch (err: any) {
    console.error('[MATCH&SIP] Error sending test email:', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to send test email',
    });
  }
});

// -------------------------------------------------------------
// 5. VERSION & DEPLOYMENT CHECK
// -------------------------------------------------------------

app.get('/api/version', (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  return res.json({
    version: '1.0.0',
    buildTime: BUILD_TIME,
    timestamp: new Date().toISOString(),
  });
});



// Global unhandled error handler middleware
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  if (err?.type === 'entity.too.large' || err?.status === 413) {
    return res.status(413).json({
      success: false,
      error: 'The uploaded file exceeds the 25MB server limit. Automatic client compression will be applied.',
    });
  }
  console.error('[UNHANDLED SERVER ERROR]', err);
  if (!res.headersSent) {
    res.status(500).json({
      success: false,
      error: err.message || 'Internal server error occurred.',
    });
  }
});

// -------------------------------------------------------------
// 7. DEV SERVER / PRODUCTION STATIC ASSET SERVING
// -------------------------------------------------------------

async function startServer() {
  const isProduction =
    process.env.NODE_ENV === 'production' ||
    Boolean(process.argv[1]?.endsWith('.cjs')) ||
    Boolean(process.argv[1]?.includes('dist'));

  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(
      express.static(distPath, {
        setHeaders: (res, filePath) => {
          if (filePath.includes(`${path.sep}assets${path.sep}`) || filePath.includes('/assets/')) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          } else {
            res.setHeader(
              'Cache-Control',
              'no-cache, no-store, must-revalidate, max-age=0, proxy-revalidate'
            );
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
          }
        },
      })
    );
    app.get('*', (_req, res) => {
      res.setHeader(
        'Cache-Control',
        'no-cache, no-store, must-revalidate, max-age=0, proxy-revalidate'
      );
      res.setHeader('Pragma', 'no-cache');
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[MATCH&SIP] Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
