import { createClient } from '@supabase/supabase-js';

let client;
export function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Banco ainda não configurado. Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no servidor.');
  if (!client) client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}
