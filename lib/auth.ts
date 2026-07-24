import type { User } from "@supabase/supabase-js";
import { getSupabase } from "./supabase";

/** Ensure there is a signed-in (anonymous) user; returns it. */
export async function ensureAnonSession(): Promise<User> {
  const sb = getSupabase();
  const { data: sessionData } = await sb.auth.getSession();
  if (sessionData.session?.user) return sessionData.session.user;

  const { data, error } = await sb.auth.signInAnonymously();
  if (error) throw error;
  if (!data.user) throw new Error("Anonymous sign-in returned no user");
  return data.user;
}
