import { useEffect, useState, useCallback, useRef } from 'react';

const CURRENT_BUILD_STORAGE_KEY = 'matchsip_active_build_id';
const CHECK_INTERVAL_MS = 45 * 1000; // 45 seconds background check

export interface VersionInfo {
  version: string;
  buildId: string;
  buildTime: string;
  timestamp: number;
}

/**
 * Hard cache-busting force refresh:
 * Appends a unique timestamp cache-buster query parameter and forces a hard browser reload.
 */
export function forceAppRefresh(clearClientCache = false): void {
  try {
    if (clearClientCache) {
      sessionStorage.clear();
      // Remove stale UI drafts while preserving active user credentials
      localStorage.removeItem('matchsip_selected_slots');
      localStorage.removeItem('matchsip_checkout_draft');
    }
  } catch {}

  const url = new URL(window.location.href);
  url.searchParams.set('t', String(Date.now()));
  window.location.replace(url.toString());
}

/**
 * Hook to monitor server deployments in real-time.
 * Automatically detects code pushes and forces a smooth refresh so users never get stuck on stale bundles.
 */
export function useVersionCheck() {
  const [hasNewVersion, setHasNewVersion] = useState<boolean>(false);
  const [currentBuildId, setCurrentBuildId] = useState<string | null>(null);
  const isCheckingRef = useRef<boolean>(false);
  const initialKnownBuildRef = useRef<string | null>(null);

  const checkVersion = useCallback(async () => {
    if (isCheckingRef.current) return;
    isCheckingRef.current = true;

    try {
      // Add unique timestamp query parameter to bypass intermediate proxies & service workers
      const res = await fetch(`/api/version?_cb=${Date.now()}`, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
        },
      });

      if (!res.ok) return;

      const data: VersionInfo = await res.json();
      const serverBuildId = data.buildId;

      if (!serverBuildId) return;

      const storedBuildId = localStorage.getItem(CURRENT_BUILD_STORAGE_KEY);

      if (!initialKnownBuildRef.current) {
        initialKnownBuildRef.current = serverBuildId;
        setCurrentBuildId(serverBuildId);

        if (storedBuildId && storedBuildId !== serverBuildId) {
          // A deployment occurred while the user had the website closed or in previous session
          localStorage.setItem(CURRENT_BUILD_STORAGE_KEY, serverBuildId);
        } else if (!storedBuildId) {
          localStorage.setItem(CURRENT_BUILD_STORAGE_KEY, serverBuildId);
        }
        return;
      }

      // If server buildId has changed while the app was running:
      if (initialKnownBuildRef.current !== serverBuildId) {
        console.log(`[MATCH&SIP] New deployment detected: ${serverBuildId} (was ${initialKnownBuildRef.current})`);
        setHasNewVersion(true);
        localStorage.setItem(CURRENT_BUILD_STORAGE_KEY, serverBuildId);

        // Auto force-reload after brief pause so user state doesn't freeze
        setTimeout(() => {
          forceAppRefresh(false);
        }, 1200);
      }
    } catch (err) {
      // Network hiccup or offline; ignore quietly
    } finally {
      isCheckingRef.current = false;
    }
  }, []);

  useEffect(() => {
    // Initial check on mount
    checkVersion();

    // Check periodically in the background
    const interval = setInterval(checkVersion, CHECK_INTERVAL_MS);

    // Check when user switches back to this tab
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        checkVersion();
      }
    };

    window.addEventListener('focus', checkVersion);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', checkVersion);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [checkVersion]);

  return {
    hasNewVersion,
    currentBuildId,
    checkVersion,
    forceRefresh: () => forceAppRefresh(true),
  };
}
