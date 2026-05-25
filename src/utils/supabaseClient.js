import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("Supabase URL 또는 Anon Key가 존재하지 않습니다. .env 파일을 확인해 주세요.");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
