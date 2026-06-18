import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// ── Shared (Supabase) ──────────────────────────────────────────────────────

export async function playerExists(playerNum) {
  const { data } = await supabase
    .from("players")
    .select("player_num")
    .eq("player_num", playerNum)
    .maybeSingle();
  return !!data;
}

export async function registerPlayer(playerNum) {
  await supabase.from("players").insert({ player_num: playerNum });
}

export async function saveSubmission({ weekKey, playerNum, answers, score, weekNum }) {
  const { error } = await supabase.from("submissions").insert({
    week_key: weekKey,
    player_num: playerNum,
    answers: answers.map((a) => a ?? 0),
    score,
    week_num: weekNum,
  });
  return { error };
}

export async function getPlayerHistory(playerNum) {
  const { data } = await supabase
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
  const { data } = await supabase
    .from("submissions")
    .select("score, answers")
    .eq("week_key", weekKey);
  return data || [];
}

export async function getAllSubmissions() {
  const { data } = await supabase.from("submissions").select("week_key, score");
  return data || [];
}

export async function resetAllData() {
  await supabase.from("submissions").delete().neq("player_num", "");
  await supabase.from("players").delete().neq("player_num", "");
}

// ── Private (localStorage) ─────────────────────────────────────────────────

export async function getPlayerSubmission(playerNum, weekKey) {
  const { data } = await supabase
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
