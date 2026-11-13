import {
  supabase,
  isSupabaseConfigured,
  isTableMissingError,
  isNetworkOrConnectionError,
} from '../lib/supabase.ts';

export const USERS_COLUMNS = 'id, uid, email, created_at';

export interface GetUsersOptions {
  limit?: number;
  offset?: number;
  page?: number;
}

export async function getOrCreateUser(uid: string, email: string) {
  if (!isSupabaseConfigured) {
    return { uid, email };
  }

  try {
    const { data, error } = await supabase
      .from('users')
      .upsert({ uid, email }, { onConflict: 'uid' })
      .select(USERS_COLUMNS)
      .maybeSingle();

    if (error) {
      if (isTableMissingError(error) || isNetworkOrConnectionError(error)) {
        return { uid, email };
      }
      console.warn('[USERS] Notice in getOrCreateUser:', error.message);
      return { uid, email };
    }

    return data || { uid, email };
  } catch (error: any) {
    if (isTableMissingError(error) || isNetworkOrConnectionError(error)) {
      return { uid, email };
    }
    console.warn('[USERS] Notice in getOrCreateUser:', error.message || error);
    return { uid, email };
  }
}

export async function getUsers(optionsOrLimit?: number | GetUsersOptions) {
  if (!isSupabaseConfigured) {
    return [];
  }

  let limit = 50;
  let offset = 0;

  if (typeof optionsOrLimit === 'number') {
    limit = Math.min(Math.max(1, optionsOrLimit), 100);
  } else if (optionsOrLimit && typeof optionsOrLimit === 'object') {
    if (typeof optionsOrLimit.limit === 'number') {
      limit = Math.min(Math.max(1, optionsOrLimit.limit), 100);
    }
    if (typeof optionsOrLimit.offset === 'number') {
      offset = Math.max(0, optionsOrLimit.offset);
    } else if (typeof optionsOrLimit.page === 'number' && optionsOrLimit.page > 0) {
      offset = (optionsOrLimit.page - 1) * limit;
    }
  }

  const from = offset;
  const to = from + limit - 1;

  try {
    const { data, error } = await supabase
      .from('users')
      .select(USERS_COLUMNS)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) {
      if (isTableMissingError(error) || isNetworkOrConnectionError(error)) {
        return [];
      }
      console.warn('[USERS] Notice fetching users from Supabase:', error.message);
      return [];
    }

    return data || [];
  } catch (error: any) {
    if (isTableMissingError(error) || isNetworkOrConnectionError(error)) {
      return [];
    }
    console.warn('[USERS] Notice querying users from Supabase:', error.message || error);
    return [];
  }
}

