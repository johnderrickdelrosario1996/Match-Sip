
import { supabase } from '../lib/supabase';

export interface UploadProgressCallback {
  (progressPercent: number): void;
}

export interface UploadResult {
  downloadUrl: string;
  storagePath: string;
  fileName: string;
  sizeBytes: number;
  contentType: string;
}

// =====================================================
// SUPABASE STORAGE CONFIGURATION
// =====================================================

const STORAGE_BUCKET = 'uploads';
const STORAGE_FOLDER = 'receipts';
const SIGNED_URL_EXPIRY = 60 * 60; // 1 hour

// =====================================================
// PAYMENT RECEIPT VALIDATION
// =====================================================

export const ALLOWED_RECEIPT_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/avif',
] as const;

export const ALLOWED_RECEIPT_EXTENSIONS = [
  'jpg',
  'jpeg',
  'png',
  'webp',
  'heic',
  'heif',
  'avif',
] as const;

// Maximum raw upload size: 30 MB
export const MAX_RAW_FILE_SIZE_BYTES = 30 * 1024 * 1024;
export const MAX_RAW_FILE_SIZE_MB = 30;

export interface FileValidationResult {
  isValid: boolean;
  error?: string;
}

// =====================================================
// FILE VALIDATION
// =====================================================

export function validateReceiptFile(file: File): FileValidationResult {

  if (!file) {
    return {
      isValid: false,
      error: 'No file selected. Please select a valid payment screenshot.',
    };
  }

  // Check empty file
  if (file.size === 0) {
    return {
      isValid: false,
      error: 'The selected file is empty. Please choose a valid receipt image.',
    };
  }

  // Check maximum file size
  if (file.size > MAX_RAW_FILE_SIZE_BYTES) {
    const sizeMb = (file.size / (1024 * 1024)).toFixed(1);

    return {
      isValid: false,
      error: `File size too large (${sizeMb} MB). Maximum allowed size is ${MAX_RAW_FILE_SIZE_MB} MB.`,
    };
  }

  // Check file extension
  const nameParts = file.name.split('.');
  const ext = nameParts.length > 1
    ? nameParts.pop()!.toLowerCase().trim()
    : '';

  const rawType = (file.type || '').toLowerCase().trim();

  // Reject documents and unsupported formats
  const nonImageDocs = [
    'pdf', 'doc', 'docx', 'txt', 'rtf',
    'xls', 'xlsx', 'zip', 'rar', 'mp4', 'mov',
  ];

  if (
    nonImageDocs.includes(ext) ||
    rawType.includes('pdf') ||
    rawType.includes('document')
  ) {
    return {
      isValid: false,
      error: 'Unsupported file format. Please upload an image screenshot.',
    };
  }

  const isMimeAllowed = ALLOWED_RECEIPT_MIME_TYPES.includes(
    rawType as any
  );

  const isExtAllowed = ALLOWED_RECEIPT_EXTENSIONS.includes(
    ext as any
  );

  // Reject non-image MIME types
  if (rawType && !rawType.startsWith('image/')) {
    return {
      isValid: false,
      error: `Invalid file format (${rawType}). Please upload a valid image.`,
    };
  }

  // Reject unsupported extension and MIME combination
  if (!isExtAllowed && !isMimeAllowed) {
    return {
      isValid: false,
      error: `Unsupported file extension (.${ext || 'unknown'}). Only JPG, PNG, WebP, HEIC, HEIF, and AVIF are accepted.`,
    };
  }

  return {
    isValid: true,
  };
}

// =====================================================
// CONTENT TYPE RESOLUTION
// =====================================================

function resolveContentType(file: File): string {

  const type = (file.type || '').toLowerCase().trim();

  if (ALLOWED_RECEIPT_MIME_TYPES.includes(type as any)) {
    return type;
  }

  const ext = file.name.split('.').pop()?.toLowerCase();

  switch (ext) {
    case 'png':
      return 'image/png';

    case 'webp':
      return 'image/webp';

    case 'heic':
      return 'image/heic';

    case 'heif':
      return 'image/heif';

    case 'avif':
      return 'image/avif';

    case 'jpg':
    case 'jpeg':
    default:
      return 'image/jpeg';
  }
}

// =====================================================
// FOLDER NAME SANITIZATION
// =====================================================

function sanitizeFolderName(value: string): string {

  return value
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_');
}

// =====================================================
// UNIQUE FILE NAME GENERATION
// =====================================================

function generateFileName(file: File): string {

  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';

  return `${crypto.randomUUID()}.${ext}`;
}

// =====================================================
// DIRECT SUPABASE STORAGE UPLOAD
// =====================================================

export async function uploadReceiptToFirebaseStorage(
  file: File,
  bookingReference?: string,
  onProgress?: UploadProgressCallback
): Promise<UploadResult> {

  // 1. Validate uploaded file
  if (!file) {
    throw new Error('No file provided for upload.');
  }

  const validation = validateReceiptFile(file);

  if (!validation.isValid) {
    throw new Error(validation.error);
  }

  // 2. Require booking reference
  if (!bookingReference || !bookingReference.trim()) {
    throw new Error('Booking reference is required for receipt upload.');
  }

  const safeBookingReference = sanitizeFolderName(bookingReference);

  if (!safeBookingReference) {
    throw new Error('Invalid booking reference.');
  }

  if (onProgress) onProgress(10);

  // 3. Generate Supabase storage path
  //
  // uploads (bucket)
  //   └── receipts
  //       └── BOOKING_REFERENCE
  //           └── unique-file-name.jpg

  const fileName = generateFileName(file);

  const storagePath =
    `${STORAGE_FOLDER}/${safeBookingReference}/${fileName}`;

  const contentType = resolveContentType(file);

  if (onProgress) onProgress(20);

  // 4. Upload directly to Supabase Storage
  //
  // No Base64 conversion
  // No Firebase
  // No API endpoint
  // No fallback

  const { data, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, file, {
      contentType,
      cacheControl: '3600',
      upsert: false,
    });

  if (error) {
    console.error(
      '[SUPABASE STORAGE] Receipt upload failed:',
      error
    );

    const msg = error.message || 'Unknown upload error';
    if (msg.toLowerCase().includes('row-level security')) {
      throw new Error(
        'Receipt upload blocked by Supabase Storage permissions (RLS). Please enable INSERT and SELECT policies for the "uploads" bucket in Supabase.'
      );
    }

    throw new Error(
      `Receipt upload failed: ${msg}`
    );
  }

  if (!data?.path) {
    throw new Error('Supabase did not return a valid storage path.');
  }

  if (onProgress) onProgress(85);

  // 5. Generate signed URL
  //
  // This works with a PRIVATE Supabase bucket.
  // The URL expires after one hour.

  const { data: signedData, error: signedError } =
    await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(
        data.path,
        SIGNED_URL_EXPIRY
      );

  if (signedError || !signedData?.signedUrl) {

    console.error(
      '[SUPABASE STORAGE] Signed URL generation failed:',
      signedError
    );

    throw new Error(
      'Receipt uploaded successfully, but the signed URL could not be generated. The storage path has been preserved.'
    );
  }

  if (onProgress) onProgress(100);

  // 6. Return upload information

  return {
    downloadUrl: signedData.signedUrl,
    storagePath: data.path,
    fileName,
    sizeBytes: file.size,
    contentType,
  };
}
