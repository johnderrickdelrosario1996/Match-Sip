import { createClient } from '@supabase/supabase-js';

/**
 * Single Supabase client initialized using environment variables:
 * - SUPABASE_URL (or VITE_SUPABASE_URL in frontend)
 * - SUPABASE_ANON_KEY (or VITE_SUPABASE_ANON_KEY in frontend)
 */
const getEnvVar = (key: string): string => {
  if (typeof process !== 'undefined' && process?.env && process.env[key]) {
    return process.env[key]!.trim();
  }
  try {
    if (typeof import.meta !== 'undefined' && (import.meta as any).env) {
      const viteKey = key.startsWith('VITE_') ? key : `VITE_${key}`;
      const val = (import.meta as any).env[key] || (import.meta as any).env[viteKey];
      if (val) return String(val).trim();
    }
  } catch {
    // Ignore in non-Vite contexts
  }
  return '';
};

const supabaseUrl =
  getEnvVar('NEXT_PUBLIC_SUPABASE_URL') ||
  getEnvVar('SUPABASE_URL') ||
  getEnvVar('VITE_SUPABASE_URL') ||
  '';

const supabaseAnonKey =
  getEnvVar('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY') ||
  getEnvVar('NEXT_PUBLIC_SUPABASE_ANON_KEY') ||
  getEnvVar('SUPABASE_PUBLISHABLE_KEY') ||
  getEnvVar('SUPABASE_ANON_KEY') ||
  getEnvVar('VITE_SUPABASE_ANON_KEY') ||
  '';

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
  !supabaseUrl.includes('placeholder-project') &&
  supabaseAnonKey &&
  supabaseAnonKey !== 'placeholder-anon-key'
);

/**
 * Detects if a Supabase error is caused by a missing table in schema cache (PGRST205 / 42P01)
 */
export function isTableMissingError(error: any): boolean {
  if (!error) return false;
  const msg = (error.message || error.details || error.hint || String(error)).toLowerCase();
  const code = (error.code || '').toUpperCase();
  return (
    code === 'PGRST205' ||
    code === '42P01' ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    msg.includes('does not exist') ||
    msg.includes('relation')
  );
}

/**
 * Detects network or connection errors (DNS ENOTFOUND, fetch failed, offline, etc.)
 */
export function isNetworkOrConnectionError(error: any): boolean {
  if (!error) return false;
  const msg = (error.message || error.details || error.hint || String(error)).toLowerCase();
  const code = (error.code || '').toUpperCase();
  return (
    msg.includes('fetch failed') ||
    msg.includes('getaddrinfo') ||
    msg.includes('enotfound') ||
    msg.includes('network') ||
    msg.includes('econnrefused') ||
    msg.includes('etimedout') ||
    msg.includes('undici') ||
    code === 'ENOTFOUND' ||
    code === 'ECONNREFUSED'
  );
}

export const supabase = createClient(
  supabaseUrl || 'https://placeholder-project.supabase.co',
  supabaseAnonKey || 'placeholder-anon-key'
);

export default supabase;
