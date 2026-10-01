import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function createSupabaseServerClient(url: string, secretKey: string): SupabaseClient {
  if (!secretKey || secretKey.startsWith("sb_publishable_")) {
    throw new Error("SUPABASE_SECRET_KEY must be a server-only secret, not the publishable key.");
  }
  return createClient(url, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
