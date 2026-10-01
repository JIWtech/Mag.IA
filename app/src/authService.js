import { createClient } from '@supabase/supabase-js';

const runtimeEnv = import.meta.env || {};
const supabaseUrl = runtimeEnv.VITE_SUPABASE_URL || '';
const supabaseAnonKey = runtimeEnv.VITE_SUPABASE_ANON_KEY || '';
const configuredRequireAuth = runtimeEnv.VITE_REQUIRE_AUTH;
const requireAuth = configuredRequireAuth === undefined
  ? runtimeEnv.MODE === 'production'
  : String(configuredRequireAuth).toLowerCase() === 'true';

let client = null;

export function isAuthRequired() {
  return requireAuth;
}

export function hasAuthConfig() {
  return Boolean(supabaseUrl && supabaseAnonKey);
}

export function getAuthClient() {
  if (!hasAuthConfig()) return null;
  if (!client) {
    client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return client;
}

export async function getCurrentSession() {
  const supabase = getAuthClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session || null;
}

export function subscribeToAuthState(callback) {
  const supabase = getAuthClient();
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_event, session) => callback(session));
  return () => data.subscription.unsubscribe();
}

export async function signInWithPassword(email, password) {
  const supabase = getAuthClient();
  if (!supabase) throw new Error('Supabase Auth nao configurado');
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.session;
}

export async function signOut() {
  const supabase = getAuthClient();
  if (!supabase) return;
  await supabase.auth.signOut();
}
