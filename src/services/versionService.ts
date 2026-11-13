/**
 * Version Management & Entry-Point Hard Refresh Service
 * Ensures users get fresh assets on initial app load, without periodic polling
 * or tab focus triggers that would interrupt an active booking session.
 */

import { clearBookingsCache } from './bookingService.ts';

declare global {
  interface Window {
    __APP_BUILD_TIME__?: string | number;
    __APP_VERSION__?: string;
  }
}

// Client build timestamp injected at build time by Vite define
const CLIENT_BOOT_TIME = typeof window !== 'undefined' && window.__APP_BUILD_TIME__
  ? Number(window.__APP_BUILD_TIME__)
  : Date.now();

export interface AppVersionInfo {
  version: string;
  buildTime: number;
  environment?: string;
  timestamp?: string;
}

/**
 * Perform a single, aggressive entry-point reload to fetch the latest JS/CSS bundles.
 * Preserves active form inputs in sessionStorage so users never lose their typed information.
 */
export function forceAppRefresh(reason = 'New version deployed'): void {
  console.warn(`[VERSION] Performing single entry-point refresh: ${reason}`);
  try {
    // Clear stale bookings cache
    clearBookingsCache();

    // If Service Workers are registered, update or unregister them
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const registration of registrations) {
          registration.update().catch(() => {});
        }
      }).catch(() => {});
    }
  } catch {}

  // Force clean reload bypassing cache
  const cleanPath = window.location.pathname + window.location.search;
  const separator = cleanPath.includes('?') ? '&' : '?';
  const refreshUrl = `${cleanPath}${separator}_v=${Date.now()}`;
  
  window.location.replace(refreshUrl);
}

/**
 * Checks for updates once at application entry-point.
 * If a deployment mismatch is detected, silently updates the client once
 * before the user begins interacting with the page.
 */
export async function performEntryPointVersionCheck(): Promise<boolean> {
  if (typeof window === 'undefined') return false;

  try {
    const cacheBuster = Date.now();
    const res = await fetch(`/api/version?_t=${cacheBuster}`, {
      method: 'GET',
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
      },
      cache: 'no-store',
    });

    if (!res.ok) {
      return false;
    }

    const data: AppVersionInfo = await res.json();
    const serverBuildTime = Number(data.buildTime || 0);

    // If server has a newer build timestamp than our bundled boot time
    if (serverBuildTime > 0 && serverBuildTime > CLIENT_BOOT_TIME) {
      const lastRefreshedBuild = sessionStorage.getItem('matchsip_version_refreshed_for');
      if (lastRefreshedBuild !== String(serverBuildTime)) {
        sessionStorage.setItem('matchsip_version_refreshed_for', String(serverBuildTime));
        console.log(`[VERSION] Initial entry mismatch: Server (${serverBuildTime}) > Client (${CLIENT_BOOT_TIME}). Applying single entry refresh.`);
        forceAppRefresh(`New build detected on entry: ${serverBuildTime}`);
        return true;
      }
    }
  } catch (err) {
    // Silent guard if offline or network hiccup
  }
  return false;
}

/**
 * Bootstraps entry-point version checking and chunk error guards.
 * Periodic polling and tab focus listeners are disabled to ensure undisturbed user sessions.
 */
export function initVersionChecker() {
  if (typeof window === 'undefined') return;

  // 1. Guard against Vite "Failed to fetch dynamically imported module" errors.
  // This occurs when a user has a tab open across a deployment and clicks a route that references an old chunk hash.
  window.addEventListener('error', (event) => {
    const errorMsg = event?.message || '';
    if (
      errorMsg.includes('Failed to fetch dynamically imported module') ||
      errorMsg.includes('Loading chunk') ||
      errorMsg.includes('Importing a module script failed')
    ) {
      const lastReload = Number(sessionStorage.getItem('matchsip_chunk_reload_lock') || 0);
      const now = Date.now();
      // Reload at most once every 10 seconds to avoid infinite loop
      if (now - lastReload > 10000) {
        sessionStorage.setItem('matchsip_chunk_reload_lock', String(now));
        console.warn('[VERSION] Dynamic import chunk mismatch detected. Auto-reloading latest bundle...');
        forceAppRefresh('Stale bundle chunk detected');
      }
    }
  });

  // 2. Perform a single check right as the application loads
  performEntryPointVersionCheck();
}
