/**
 * ============================================================================
 * MATCH & SIP - CODE-LEVEL MAINTENANCE MODE CONFIGURATION
 * ============================================================================
 *
 * You can manually control maintenance mode directly here in the code.
 *
 * - Set to `true`: Maintenance mode is HARD-LOCKED ON.
 *   Cloud Run container restarts, scale-to-zero, idle timeouts, and redeploys
 *   CANNOT turn it off. It will stay ON indefinitely until you change it here.
 *
 * - Set to `false`: Normal booking is active.
 *
 * ============================================================================
 */
export const HARDCODED_MAINTENANCE_MODE: boolean = false;

export const DEFAULT_MAINTENANCE_MESSAGE: string =
  'MATCH & SIP is under maintenance. We will be back soon! You can book thru our Instagram link below.';
