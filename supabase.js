import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createCoalescedFetch } from './usage-efficiency.js';

const supabaseUrl = "https://kxhqfwlfendphhwurhcg.supabase.co";
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt4aHFmd2xmZW5kcGhod3VyaGNnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4NDI4MjQsImV4cCI6MjA5MzQxODgyNH0.K4kwmU_i9qln-74xGX5Qj-VqwsJIlERvF3VAMXUcMa4";

// Singleton — reuse existing client if already created
const existing = globalThis.__supabaseClient;
export const supabase = existing ?? createClient(supabaseUrl, supabaseKey, {
  auth: { storageKey: "utwx-auth" },
  global: { fetch: createCoalescedFetch(globalThis.fetch.bind(globalThis), supabaseUrl) }
});
globalThis.__supabaseClient = supabase;
