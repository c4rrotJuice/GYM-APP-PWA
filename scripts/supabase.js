import { runtimeEnv } from './env.js';

const SUPABASE_CDN_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
let supabaseClient = null;
let supabaseLoadPromise = null;

export function getSupabaseConfig() {
  return {
    url: runtimeEnv.SUPABASE_URL,
    anonKey: runtimeEnv.SUPABASE_ANON_KEY,
    configured: Boolean(runtimeEnv.SUPABASE_URL && runtimeEnv.SUPABASE_ANON_KEY)
  };
}

export function getSupabaseClient() {
  if (supabaseClient) {
    return supabaseClient;
  }

  const config = getSupabaseConfig();

  if (!config.configured || !globalThis.supabase?.createClient) {
    return null;
  }

  supabaseClient = globalThis.supabase.createClient(config.url, config.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce'
    }
  });

  return supabaseClient;
}

export async function getSupabaseClientReady() {
  const existingClient = getSupabaseClient();
  if (existingClient) {
    return existingClient;
  }

  const config = getSupabaseConfig();
  if (!config.configured) {
    return null;
  }

  await loadSupabaseBrowserClient();
  return getSupabaseClient();
}

export function isSupabaseConfigured() {
  return getSupabaseConfig().configured;
}

function loadSupabaseBrowserClient() {
  if (globalThis.supabase?.createClient) {
    return Promise.resolve();
  }

  if (supabaseLoadPromise) {
    return supabaseLoadPromise;
  }

  supabaseLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SUPABASE_CDN_URL;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Unable to load Supabase browser client'));
    document.head.append(script);
  });

  return supabaseLoadPromise;
}
