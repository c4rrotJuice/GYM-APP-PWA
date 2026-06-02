export const runtimeEnv = Object.freeze({
  SUPABASE_URL: readRuntimeValue('SUPABASE_URL'),
  SUPABASE_ANON_KEY: readRuntimeValue('SUPABASE_ANON_KEY'),
  VAPID_PUBLIC_KEY: readRuntimeValue('VAPID_PUBLIC_KEY')
});

function readRuntimeValue(key) {
  return globalThis.__GYM_PWA_ENV__?.[key] || '';
}
