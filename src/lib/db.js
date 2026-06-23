import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // Surfaced via each query's thrown error rather than crashing the whole app at import.
  console.error(
    "Missing Supabase env vars (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY). Set them in the deployment environment."
  );
}

const supabase =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

function requireClient() {
  if (!supabase) {
    throw new Error(
      "Database not configured: missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in this deployment."
    );
  }
  return supabase;
}

// ── Shared (Supabase) ──────────────────────────────────────────────────────

export async function playerExists(playerNum) {
  const { data } = await requireClient()
    .from("players")
    .select("player_num")
    .eq("player_num", playerNum)
    .maybeSingle();
  return !!data;
}

export async function registerPlayer(playerNum) {
  await requireClient().from("players").insert({ player_num: playerNum });
}

export async function saveSubmission({ weekKey, playerNum, answers, score, weekNum, coachingRetention, otherConcerns }) {
  const { error } = await requireClient().from("submissions").insert({
    week_key: weekKey,
    player_num: playerNum,
    answers: answers.map((a) => a ?? 0),
    score,
    week_num: weekNum,
    ...(coachingRetention != null && { coaching_retention: coachingRetention }),
    ...(otherConcerns?.trim() && { other_concerns: otherConcerns.trim() }),
  });
  return { error };
}

export async function getWeekFeedback(weekKey) {
  const { data, error } = await requireClient()
    .from("submissions")
    .select("coaching_retention, other_concerns")
    .eq("week_key", weekKey)
    .or("coaching_retention.not.is.null,other_concerns.not.is.null");
  if (error) throw new Error(error.message);
  return data || [];
}

export async function getPlayerHistory(playerNum) {
  const { data } = await requireClient()
    .from("submissions")
    .select("week_key, week_num, score")
    .eq("player_num", playerNum)
    .order("week_num", { ascending: true });
  return (data || []).map((s) => ({
    week: s.week_key,
    weekNum: s.week_num,
    score: s.score,
  }));
}

export async function getWeekSubmissions(weekKey) {
  const { data, error } = await requireClient()
    .from("submissions")
    .select("score, answers")
    .eq("week_key", weekKey);
  if (error) throw new Error(error.message);
  return data || [];
}

export async function getAllSubmissions() {
  const { data, error } = await requireClient().from("submissions").select("week_key, score");
  if (error) throw new Error(error.message);
  return data || [];
}

export async function resetAllData() {
  const client = requireClient();
  await client.from("submissions").delete().neq("player_num", "");
  await client.from("players").delete().neq("player_num", "");
}

// ── Private (localStorage) ─────────────────────────────────────────────────

export async function getPlayerFullHistory(playerNum) {
  const { data } = await requireClient()
    .from("submissions")
    .select("week_key, week_num, score, answers")
    .eq("player_num", playerNum)
    .order("week_num", { ascending: true });
  return data || [];
}

export async function getPlayerSubmission(playerNum, weekKey) {
  const { data } = await requireClient()
    .from("submissions")
    .select("answers, score")
    .eq("player_num", playerNum)
    .eq("week_key", weekKey)
    .maybeSingle();
  return data || null;
}

export function saveNote(playerNum, weekKey, note) {
  localStorage.setItem(
    `intentscore_note:${playerNum}:${weekKey}`,
    JSON.stringify({ note, weekKey })
  );
}
