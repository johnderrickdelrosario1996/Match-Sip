import {
  HARDCODED_MAINTENANCE_MODE,
  DEFAULT_MAINTENANCE_MESSAGE,
} from '../config/maintenanceConfig.ts';

export interface MaintenanceSettings {
  enabled: boolean;
  message: string;
  updatedAt: string;
  isHardcoded: boolean;
}

/**
 * Returns the static, code-level maintenance settings from src/config/maintenanceConfig.ts.
 */
export async function getMaintenanceStatus(): Promise<MaintenanceSettings> {
  return {
    enabled: HARDCODED_MAINTENANCE_MODE,
    message: HARDCODED_MAINTENANCE_MODE ? DEFAULT_MAINTENANCE_MESSAGE : '',
    updatedAt: new Date().toISOString(),
    isHardcoded: true,
  };
}
