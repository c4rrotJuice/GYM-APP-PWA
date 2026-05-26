export const runtimeEnv = Object.freeze({
  SUPABASE_URL: readRuntimeValue('SUPABASE_URL'),
  SUPABASE_ANON_KEY: readRuntimeValue('SUPABASE_ANON_KEY')
});

function readRuntimeValue(key) {
  return globalThis.__GYM_PWA_ENV__?.[key] || '';
}
