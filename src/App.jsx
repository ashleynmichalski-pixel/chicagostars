import { useState, useEffect } from "react";
import {
  playerExists, registerPlayer, saveSubmission,
  getPlayerHistory, getWeekSubmissions, getAllSubmissions,
  resetAllData, saveNote,
} from "./lib/db";

// ── Constants ──────────────────────────────────────────────────────────────
const ADMIN_PASSWORD = "StarsIntent2026";
const MIN_SUBMISSIONS_TO_UNLOCK = 5;
const MAX_ROSTER = 25;

const COLORS = {
  navy: "#1B2E45",
  navyLight: "#243C58",
  navyDark: "#111E2D",
  sky: "#5BB8D4",
  skyDim: "#3A8FAA",
  red: "#C8102E",
  white: "#F5F5F5",
  muted: "#8AA0B4",
  dim: "#162435",
  border: "#243C58",
};

const QUESTIONS = [
  { id: 1, type: "positive", text: "This week, I set a clear and specific focus before each training session.", dimension: "preparation" },
  { id: 2, type: "positive", text: "This week, I noticed in the moment when something wasn't working and made an adjustment.", dimension: "awareness" },
  { id: 3, type: "struggle", text: "This week, there were moments where I was physically present in training but mentally elsewhere.", dimension: "presence" },
  { id: 4, type: "positive", text: "This week, I identified at least one thing I needed to do differently and deliberately worked on it.", dimension: "learning" },
  { id: 5, type: "positive", text: "This week, I prioritized the quality of my effort over simply completing the work.", dimension: "quality" },
  { id: 6, type: "struggle", text: "This week, after a poor rep or play, I made a specific adjustment on my next attempt rather than just repeating the same thing.", dimension: "recovery", reversed: true },
  { id: 7, type: "peer", text: "This week, I felt the team's overall energy and focus in training was high.", dimension: "team energy" },
];

// ── Helpers ────────────────────────────────────────────────────────────────
function getParticipationNote(count, total) {
  const pct = count / total;
  if (pct >= 0.8) return { text: `${count} of ${total} athletes responded — high participation. This is a reliable read on where the team is this week.`, color: COLORS.sky };
  if (pct >= 0.5) return { text: `${count} of ${total} athletes responded — solid sample. This reflects a meaningful portion of the team but isn't the full picture.`, color: COLORS.sky };
  if (pct >= 0.3) return { text: `${count} of ${total} athletes responded — partial data. Directionally useful, but about half the team hasn't weighed in yet.`, color: "#F5A623" };
  return { text: `${count} of ${total} athletes responded — small sample. Treat this as an early signal only, not a team-wide read.`, color: "#F5A623" };
}

function getWeekKey() {
  const now = new Date();
  const jan1 = new Date(now.getFullYear(), 0, 1);
  const week = Math.ceil(((now - jan1) / 86400000 + jan1.getDay() + 1) / 7);
  return `${now.getFullYear()}-W${week}`;
}

function getWeekLabel() {
  const now = new Date();
  const jan1 = new Date(now.getFullYear(), 0, 1);
  const week = Math.ceil(((now - jan1) / 86400000 + jan1.getDay() + 1) / 7);
  return `WEEK ${week} · ${now.toLocaleString("default", { month: "short" }).toUpperCase()} ${now.getFullYear()}`;
}

function computeIntentScore(answers) {
  let total = 0;
  QUESTIONS.forEach((q, i) => {
    if (q.type === "peer") return;
    const val = answers[i] || 0;
    if (q.type === "struggle" && !q.reversed) {
      total += 6 - val;
    } else {
      total += val;
    }
  });
  return total;
}

function getScoreBand(score) {
  if (score >= 24) return { label: "HIGH INTENTIONALITY", color: COLORS.sky };
  if (score >= 18) return { label: "EMERGING INTENTIONALITY", color: COLORS.sky };
  if (score >= 12) return { label: "INCONSISTENT", color: "#F5A623" };
  return { label: "SIGNIFICANT OPPORTUNITY", color: COLORS.red };
}

function getWeakDimension(answers) {
  const dims = QUESTIONS.map((q, i) => {
    const val = answers[i] || 0;
    const adjusted = q.type === "struggle" && !q.reversed ? 6 - val : val;
    return { dimension: q.dimension, score: adjusted };
  });
  dims.sort((a, b) => a.score - b.score);
  return dims[0].dimension;
}

function focusByDimension(dim) {
  const map = {
    preparation: "Before your next session, write down one specific thing you want to get better at in that session. Not a general intention — one concrete, nameable thing.",
    awareness: "During your next session, pick one moment to pause and ask yourself: is what I'm doing right now actually working? If not, change something before the next rep.",
    presence: "When you notice your mind leaving the session, use a physical reset — a breath, a word, a tap — to bring yourself back. Name the moment when it happens instead of letting it pass.",
    learning: "After your next session, spend 60 seconds identifying one thing you did differently than last week. If you can't name it, you didn't learn it.",
    quality: "Choose one drill or exercise this week where you do fewer reps than prescribed but execute each one with complete focus. Quality over quantity is a decision, not a feeling.",
    recovery: "After your next poor rep or play, before you move on, say one specific thing out loud or in your head about what you're changing on the next attempt. Make the adjustment visible to yourself.",
  };
  return map[dim] || "Focus on closing the gap between your intention and your execution this week.";
}

const SUMMARIES = {
  high: { text: (weak) => `You're showing up with purpose this week. Your intentionality is measurably high — you're not just putting in time, you're using it. The one area to sharpen: your ${weak} still has room to go from good to elite. That's where your next level lives.` },
  emerging: { text: (weak) => `You're trending in the right direction but there's a gap between your intention and your execution this week. You have the awareness — now the work is closing that loop consistently, not just when it's easy. Your ${weak} is where that gap is widest right now.` },
  inconsistent: { text: (weak) => `Your intentionality this week was uneven. Some sessions you locked in. Others you went through the motions. The difference between good athletes and elite ones is what happens in those uneven moments — the choice to refocus before the next rep, not after. Your ${weak} needs specific attention.` },
  low: { text: (weak) => `This was not your most intentional week. That's honest data, not a judgment. The question is what you do with it. Effort without intention is just repetition — and repetition without learning doesn't move the needle. Start with one thing: your ${weak}. Fix that first.` },
};

function getSummaryContent(score, answers) {
  const weak = getWeakDimension(answers);
  const weakLabel = weak.charAt(0).toUpperCase() + weak.slice(1);
  const focus = focusByDimension(weak);
  if (score >= 24) return { text: SUMMARIES.high.text(weakLabel), focus };
  if (score >= 18) return { text: SUMMARIES.emerging.text(weakLabel), focus };
  if (score >= 12) return { text: SUMMARIES.inconsistent.text(weakLabel), focus };
  return { text: SUMMARIES.low.text(weakLabel), focus };
}

// ── Shared styles ──────────────────────────────────────────────────────────
const styles = {
  screen: {
    display: "flex", flexDirection: "column", gap: 20,
    padding: "20px 24px 32px", height: "100%", overflowY: "auto",
  },
  numBtn: {
    background: COLORS.dim, border: `1px solid ${COLORS.border}`,
    borderRadius: 12, padding: "16px 0",
    fontFamily: "'Barlow Condensed', sans-serif", fontSize: 26, fontWeight: 700,
    color: COLORS.white, cursor: "pointer", transition: "all 0.1s",
  },
};

// ── Sub-components ─────────────────────────────────────────────────────────
function StarLogo({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none">
      <polygon points="50,5 61,35 95,35 68,57 79,91 50,70 21,91 32,57 5,35 39,35" fill={COLORS.sky} opacity="0.9" />
      <polygon points="50,20 58,42 82,42 63,56 70,78 50,65 30,78 37,56 18,42 42,42" fill={COLORS.navy} />
      <polygon points="50,28 56,44 73,44 60,54 65,70 50,61 35,70 40,54 27,44 44,44" fill={COLORS.red} opacity="0.9" />
    </svg>
  );
}

function Btn({ children, onClick, variant = "primary", disabled = false, style = {} }) {
  const base = {
    width: "100%", border: "none", borderRadius: 12, padding: "17px",
    fontFamily: "'Barlow Condensed', sans-serif", fontSize: 18, fontWeight: 700,
    letterSpacing: 2, cursor: disabled ? "not-allowed" : "pointer",
    transition: "all 0.15s", textTransform: "uppercase", ...style,
  };
  const variants = {
    primary: { background: COLORS.sky, color: COLORS.navy, opacity: disabled ? 0.4 : 1 },
    secondary: { background: COLORS.dim, color: COLORS.white, border: `1px solid ${COLORS.border}`, opacity: disabled ? 0.4 : 1 },
    danger: { background: COLORS.red, color: COLORS.white, opacity: disabled ? 0.4 : 1 },
  };
  return (
    <button onClick={disabled ? undefined : onClick} style={{ ...base, ...variants[variant] }}>
      {children}
    </button>
  );
}

// ── SCREEN: Onboarding ─────────────────────────────────────────────────────
function OnboardingScreen({ onContinue }) {
  return (
    <div style={styles.screen}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, marginTop: 24 }}>
        <StarLogo size={52} />
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 42, fontWeight: 800, color: COLORS.white, letterSpacing: 2, lineHeight: 1 }}>
          INTENT<span style={{ color: COLORS.sky }}>SCORE</span>
        </div>
        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: COLORS.muted, letterSpacing: 3 }}>CHICAGO STARS FC</div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16, flex: 1, justifyContent: "center" }}>
        <div style={{ background: COLORS.dim, border: `1px solid ${COLORS.border}`, borderRadius: 16, padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: COLORS.sky, letterSpacing: 3, textTransform: "uppercase" }}>Before You Begin</div>
          {[
            ["🔒", "Your responses are completely anonymous. Your number is known only to you."],
            ["👁", "The team psychologist sees only team averages — never individual scores."],
            ["📊", "What gets shared with coaches: team trends only, nothing individual."],
            ["⚡", "This takes 90 seconds. Be honest — the data only works if you are."],
          ].map(([icon, text], i) => (
            <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <span style={{ fontSize: 16, flexShrink: 0 }}>{icon}</span>
              <div style={{ fontSize: 13, color: COLORS.white, lineHeight: 1.6, fontWeight: 300 }}>{text}</div>
            </div>
          ))}
        </div>
      </div>

      <Btn onClick={onContinue}>I Understand — Let's Go</Btn>
    </div>
  );
}

// ── SCREEN: Number Entry (new player) ──────────────────────────────────────
function NumberEntry({ onEnter }) {
  const [num, setNum] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);

  const handleDigit = (d) => { if (num.length < 2) setNum(num + d); setError(""); };
  const handleBack = () => { setNum(num.slice(0, -1)); setError(""); };

  const handleEnter = async () => {
    if (!num || num === "0") { setError("Please enter a number between 1 and 99."); return; }
    setChecking(true);
    const taken = await playerExists(num);
    if (taken) { setError(`Number ${num} is already taken. Choose a different one.`); setChecking(false); return; }
    await registerPlayer(num);
    onEnter(num);
    setChecking(false);
  };

  return (
    <div style={styles.screen}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, marginTop: 16 }}>
        <StarLogo size={36} />
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 34, fontWeight: 800, color: COLORS.white, letterSpacing: 2 }}>
          INTENT<span style={{ color: COLORS.sky }}>SCORE</span>
        </div>
        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: COLORS.muted, letterSpacing: 3 }}>{getWeekLabel()}</div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 20, flex: 1, justifyContent: "center" }}>
        <div style={{ fontSize: 14, color: COLORS.muted, lineHeight: 1.6, textAlign: "center", fontWeight: 300 }}>
          Choose a 1 or 2 digit number you'll remember.<br />This is your anonymous ID.
        </div>

        <div style={{ background: COLORS.dim, border: `2px solid ${error ? COLORS.red : num ? COLORS.sky : COLORS.border}`, borderRadius: 16, padding: "24px 20px", display: "flex", alignItems: "center", justifyContent: "center", minHeight: 80, transition: "border-color 0.2s" }}>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 72, color: num ? COLORS.sky : COLORS.border, fontWeight: 800, letterSpacing: 4, minWidth: 60, textAlign: "center" }}>
            {num || "—"}
          </div>
        </div>

        {error && <div style={{ fontSize: 12, color: COLORS.red, textAlign: "center", lineHeight: 1.5 }}>{error}</div>}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          {[1,2,3,4,5,6,7,8,9].map(d => (
            <button key={d} onClick={() => handleDigit(String(d))} style={styles.numBtn}>{d}</button>
          ))}
          <div />
          <button onClick={() => handleDigit("0")} style={styles.numBtn}>0</button>
          <button onClick={handleBack} style={{ ...styles.numBtn, color: COLORS.muted }}>⌫</button>
        </div>

        <div style={{ fontSize: 11, color: "#4A6580", textAlign: "center", lineHeight: 1.6 }}>
          Save your number — you'll need it to access your history on any device.
        </div>
      </div>

      <Btn onClick={handleEnter} disabled={!num || checking}>
        {checking ? "Checking..." : "Enter →"}
      </Btn>
    </div>
  );
}

// ── SCREEN: Returning Player ───────────────────────────────────────────────
function ReturningEntry({ onEnter, onNewNumber }) {
  const [num, setNum] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);

  const handleDigit = (d) => { if (num.length < 2) setNum(num + d); setError(""); };
  const handleBack = () => { setNum(num.slice(0, -1)); setError(""); };

  const handleEnter = async () => {
    if (!num) { setError("Enter your number."); return; }
    setChecking(true);
    const exists = await playerExists(num);
    if (!exists) { setError(`Number ${num} not found. Try again or start fresh.`); setChecking(false); return; }
    onEnter(num);
    setChecking(false);
  };

  return (
    <div style={styles.screen}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, marginTop: 16 }}>
        <StarLogo size={36} />
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 34, fontWeight: 800, color: COLORS.white, letterSpacing: 2 }}>
          INTENT<span style={{ color: COLORS.sky }}>SCORE</span>
        </div>
        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: COLORS.muted, letterSpacing: 3 }}>{getWeekLabel()}</div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 20, flex: 1, justifyContent: "center" }}>
        <div style={{ fontSize: 14, color: COLORS.muted, lineHeight: 1.6, textAlign: "center" }}>Enter your number to continue.</div>

        <div style={{ background: COLORS.dim, border: `2px solid ${error ? COLORS.red : num ? COLORS.sky : COLORS.border}`, borderRadius: 16, padding: "24px 20px", display: "flex", alignItems: "center", justifyContent: "center", minHeight: 80 }}>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 72, color: num ? COLORS.sky : COLORS.border, fontWeight: 800, letterSpacing: 4, textAlign: "center" }}>
            {num || "—"}
          </div>
        </div>

        {error && <div style={{ fontSize: 12, color: COLORS.red, textAlign: "center" }}>{error}</div>}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          {[1,2,3,4,5,6,7,8,9].map(d => (
            <button key={d} onClick={() => handleDigit(String(d))} style={styles.numBtn}>{d}</button>
          ))}
          <div />
          <button onClick={() => handleDigit("0")} style={styles.numBtn}>0</button>
          <button onClick={handleBack} style={{ ...styles.numBtn, color: COLORS.muted }}>⌫</button>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Btn onClick={handleEnter} disabled={!num || checking}>{checking ? "Checking..." : "Enter →"}</Btn>
        <Btn onClick={onNewNumber} variant="secondary">I'm New — Choose a Number</Btn>
      </div>
    </div>
  );
}

// ── SCREEN: Profile / Home ─────────────────────────────────────────────────
function ProfileScreen({ playerNum, history, onTakeAssessment, weekKey }) {
  const [teamData, setTeamData] = useState(null);
  const thisWeekDone = history.some(h => h.week === weekKey);

  useEffect(() => {
    if (!thisWeekDone) return;
    async function loadTeam() {
      const submissions = await getWeekSubmissions(weekKey);
      const count = submissions.length;
      if (count < MIN_SUBMISSIONS_TO_UNLOCK) { setTeamData({ count, unlocked: false }); return; }
      let totals = Array(7).fill(0);
      let teamScores = [];
      let peerScores = [];
      for (const d of submissions) {
        teamScores.push(d.score);
        d.answers.forEach((a, i) => { totals[i] += a; if (i === 6) peerScores.push(a); });
      }
      const avgScore = Math.round(teamScores.reduce((a, b) => a + b, 0) / teamScores.length);
      const avgPerQ = totals.map(t => (t / count).toFixed(1));
      const avgTeamEnergy = peerScores.length ? (peerScores.reduce((a, b) => a + b, 0) / peerScores.length).toFixed(1) : null;
      setTeamData({ count, unlocked: true, avgScore, avgPerQ, avgTeamEnergy });
    }
    loadTeam();
  }, [thisWeekDone, weekKey]);

  const streak = (() => {
    let s = 0;
    const sorted = [...history].sort((a, b) => b.weekNum - a.weekNum);
    for (let i = 0; i < sorted.length; i++) {
      if (i === 0 || sorted[i - 1].weekNum - sorted[i].weekNum === 1) s++;
      else break;
    }
    return s;
  })();

  return (
    <div style={{ ...styles.screen, gap: 16, overflowY: "auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: 12 }}>
        <div>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: COLORS.muted, letterSpacing: 3 }}>YOUR ID</div>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 56, color: COLORS.sky, fontWeight: 800, lineHeight: 1 }}>{playerNum}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 36, color: COLORS.white, fontWeight: 700, lineHeight: 1 }}>{streak}</div>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 8, color: COLORS.muted, letterSpacing: 2 }}>WEEK STREAK 🔥</div>
        </div>
      </div>

      {!thisWeekDone ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Btn onClick={onTakeAssessment}>Take This Week's Check-In →</Btn>
          <div style={{ background: COLORS.dim, border: `1px solid ${COLORS.border}`, borderRadius: 14, padding: 16, display: "flex", gap: 12, alignItems: "center" }}>
            <div style={{ fontSize: 22 }}>🔒</div>
            <div>
              <div style={{ fontSize: 13, color: COLORS.white, fontWeight: 500 }}>Team results are locked</div>
              <div style={{ fontSize: 11, color: COLORS.muted, lineHeight: 1.5, marginTop: 2 }}>Complete this week's check-in to unlock team averages.</div>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ background: COLORS.dim, border: `1px solid ${COLORS.sky}33`, borderRadius: 14, padding: 16 }}>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: COLORS.sky, letterSpacing: 3, marginBottom: 10 }}>THIS WEEK — TEAM DATA</div>
          {!teamData ? (
            <div style={{ fontSize: 12, color: COLORS.muted }}>Loading...</div>
          ) : !teamData.unlocked ? (
            <div style={{ fontSize: 13, color: COLORS.white }}>
              <span style={{ color: COLORS.sky, fontWeight: 700 }}>{teamData.count}</span> of {MIN_SUBMISSIONS_TO_UNLOCK} needed to unlock team averages.
              <div style={{ marginTop: 8, height: 4, background: COLORS.navyDark, borderRadius: 2 }}>
                <div style={{ height: "100%", width: `${(teamData.count / MIN_SUBMISSIONS_TO_UNLOCK) * 100}%`, background: COLORS.sky, borderRadius: 2, transition: "width 0.5s" }} />
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 12, color: COLORS.muted }}>Team Avg Score</div>
                <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 28, color: COLORS.sky, fontWeight: 700 }}>
                  {teamData.avgScore}<span style={{ fontSize: 14, color: COLORS.muted }}>/30</span>
                </div>
              </div>
              {(() => {
                const note = getParticipationNote(teamData.count, MAX_ROSTER);
                return (
                  <div style={{ fontSize: 11, color: note.color, lineHeight: 1.55, background: note.color + "15", borderRadius: 8, padding: "8px 10px" }}>
                    {note.text}
                  </div>
                );
              })()}
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
                {QUESTIONS.filter(q => q.type !== "peer").map((q, i) => (
                  <div key={q.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <div style={{ fontSize: 9, color: COLORS.muted, width: 70, flexShrink: 0, fontFamily: "'DM Mono', monospace", letterSpacing: 1 }}>{q.dimension.toUpperCase()}</div>
                    <div style={{ flex: 1, height: 4, background: COLORS.navyDark, borderRadius: 2 }}>
                      <div style={{ height: "100%", width: `${(teamData.avgPerQ[i] / 5) * 100}%`, background: q.type === "struggle" ? COLORS.red + "99" : COLORS.sky + "99", borderRadius: 2 }} />
                    </div>
                    <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: COLORS.white, width: 24, textAlign: "right" }}>{teamData.avgPerQ[i]}</div>
                  </div>
                ))}
              </div>
              {teamData.avgTeamEnergy && (
                <div style={{ borderTop: `1px solid ${COLORS.border}`, paddingTop: 12, marginTop: 4 }}>
                  <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: "#F5A623", letterSpacing: 2, marginBottom: 8 }}>TEAM ENERGY PERCEPTION</div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <div style={{ flex: 1, height: 6, background: COLORS.navyDark, borderRadius: 3 }}>
                      <div style={{ height: "100%", width: `${(parseFloat(teamData.avgTeamEnergy) / 5) * 100}%`, background: "#F5A623", borderRadius: 3 }} />
                    </div>
                    <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 20, color: "#F5A623", fontWeight: 700 }}>
                      {teamData.avgTeamEnergy}<span style={{ fontSize: 11, color: COLORS.muted }}>/5</span>
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: COLORS.muted, marginTop: 6, lineHeight: 1.5 }}>How athletes perceived the team's collective focus this week.</div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {history.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: COLORS.muted, letterSpacing: 3 }}>YOUR HISTORY</div>
          {[...history].sort((a, b) => b.weekNum - a.weekNum).map((h) => (
            <div key={h.week} style={{ display: "flex", alignItems: "center", background: COLORS.dim, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "12px 14px", gap: 10 }}>
              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: COLORS.muted, width: 48, flexShrink: 0 }}>WK {h.weekNum}</div>
              <div style={{ flex: 1, height: 3, background: COLORS.navyDark, borderRadius: 2 }}>
                <div style={{ height: "100%", width: `${(h.score / 30) * 100}%`, background: COLORS.sky, borderRadius: 2 }} />
              </div>
              <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 20, color: COLORS.sky, fontWeight: 700, width: 40, textAlign: "right" }}>{h.score}</div>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={() => {
          localStorage.removeItem("intentscore_num");
          localStorage.removeItem("intentscore_seen");
          window.location.reload();
        }}
        style={{ background: "none", border: "none", color: COLORS.border, fontSize: 10, fontFamily: "'DM Mono', monospace", letterSpacing: 2, cursor: "pointer", textAlign: "center", paddingBottom: 8, textDecoration: "underline", textUnderlineOffset: 3 }}
      >
        START OVER / SWITCH NUMBER
      </button>
    </div>
  );
}

// ── SCREEN: Assessment ─────────────────────────────────────────────────────
function AssessmentScreen({ playerNum, weekKey, onComplete }) {
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState(Array(7).fill(null));
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const q = QUESTIONS[current];
  const isLast = current === QUESTIONS.length - 1;

  const selectRating = (val) => {
    const next = [...answers];
    next[current] = val;
    setAnswers(next);
  };

  const handleNext = () => {
    if (isLast) setShowNote(true);
    else setCurrent(current + 1);
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    const score = computeIntentScore(answers);
    const weekNum = parseInt(weekKey.split("W")[1]);
    await saveSubmission({
      weekKey,
      playerNum,
      answers: answers.map(a => a ?? 0),
      score,
      weekNum,
    });
    if (note.trim()) saveNote(playerNum, weekKey, note.trim());
    setSubmitting(false);
    onComplete(score, answers);
  };

  if (showNote) {
    return (
      <div style={styles.screen}>
        <div style={{ marginTop: 20 }}>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: COLORS.muted, letterSpacing: 3, marginBottom: 8 }}>OPTIONAL — PRIVATE NOTE</div>
          <div style={{ fontSize: 15, color: COLORS.white, lineHeight: 1.6, marginBottom: 20, fontWeight: 300 }}>
            Anything you want to remember about this week? Only you can see this.
          </div>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Travel schedule, injury, something you noticed..."
            style={{ width: "100%", background: COLORS.dim, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 16, color: COLORS.white, fontSize: 14, fontFamily: "'DM Sans', sans-serif", resize: "none", height: 120, outline: "none", lineHeight: 1.6, boxSizing: "border-box" }}
          />
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Btn onClick={handleSubmit} disabled={submitting}>
            {submitting ? "Submitting..." : "Submit & See My Score →"}
          </Btn>
          <Btn onClick={handleSubmit} variant="secondary" disabled={submitting}>Skip Note</Btn>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.screen}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
        <div style={{ display: "flex", gap: 4 }}>
          {QUESTIONS.map((_, i) => (
            <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: i < current ? COLORS.sky : i === current ? COLORS.sky + "66" : COLORS.border, transition: "background 0.3s" }} />
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: COLORS.muted, letterSpacing: 1 }}>
            QUESTION {current + 1} OF {QUESTIONS.length}
          </div>
          <div style={{ fontSize: 9, letterSpacing: 2, color: q.type === "struggle" ? COLORS.red : q.type === "peer" ? "#F5A623" : COLORS.sky, background: q.type === "struggle" ? COLORS.red + "22" : q.type === "peer" ? "#F5A62322" : COLORS.sky + "22", padding: "3px 8px", borderRadius: 4, fontFamily: "'DM Mono', monospace", fontWeight: 500 }}>
            {q.type === "struggle" ? "REFLECTION" : q.type === "peer" ? "TEAM PERCEPTION" : "PERFORMANCE"}
          </div>
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 28 }}>
        <div style={{ fontSize: 11, color: COLORS.muted, fontStyle: "italic", borderLeft: `2px solid ${COLORS.sky}`, paddingLeft: 10, lineHeight: 1.5 }}>
          Be honest. This is for you.
        </div>
        <div style={{ fontSize: 20, color: COLORS.white, lineHeight: 1.45, fontWeight: 300 }}>{q.text}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", gap: 8 }}>
            {[1, 2, 3, 4, 5].map(v => (
              <button key={v} onClick={() => selectRating(v)} style={{
                flex: 1, aspectRatio: "1", background: answers[current] === v ? COLORS.sky : COLORS.dim,
                border: `1px solid ${answers[current] === v ? COLORS.sky : COLORS.border}`,
                borderRadius: 10, fontFamily: "'Barlow Condensed', sans-serif", fontSize: 24, fontWeight: 700,
                color: answers[current] === v ? COLORS.navy : COLORS.muted, cursor: "pointer", transition: "all 0.15s",
              }}>
                {v}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <div style={{ fontSize: 9, color: "#4A6580" }}>Not at all</div>
            <div style={{ fontSize: 9, color: "#4A6580" }}>Completely true</div>
          </div>
        </div>
      </div>

      <Btn onClick={handleNext} disabled={answers[current] === null}>
        {isLast ? "Finish →" : "Next →"}
      </Btn>
    </div>
  );
}

// ── SCREEN: Score Reveal ───────────────────────────────────────────────────
function ScoreRevealScreen({ score, answers, onViewProfile }) {
  const [displayed, setDisplayed] = useState(0);
  const band = getScoreBand(score);
  const summary = getSummaryContent(score, answers);
  const pct = (score / 30) * 100;

  useEffect(() => {
    let frame;
    const start = Date.now();
    const duration = 1200;
    const animate = () => {
      const elapsed = Date.now() - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayed(Math.round(eased * score));
      if (progress < 1) frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [score]);

  return (
    <div style={{ ...styles.screen, alignItems: "center", gap: 20 }}>
      <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: COLORS.muted, letterSpacing: 3, marginTop: 16 }}>YOUR INTENTSCORE</div>

      <div style={{ position: "relative", width: 160, height: 160 }}>
        <svg width="160" height="160" style={{ position: "absolute", top: 0, left: 0, transform: "rotate(-90deg)" }}>
          <circle cx="80" cy="80" r="70" fill="none" stroke={COLORS.dim} strokeWidth="6" />
          <circle cx="80" cy="80" r="70" fill="none" stroke={band.color} strokeWidth="6"
            strokeDasharray={`${2 * Math.PI * 70}`}
            strokeDashoffset={`${2 * Math.PI * 70 * (1 - pct / 100)}`}
            strokeLinecap="round"
            style={{ transition: "stroke-dashoffset 1.2s cubic-bezier(0.34, 1.56, 0.64, 1)" }} />
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 64, color: band.color, fontWeight: 800, lineHeight: 1 }}>{displayed}</div>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: COLORS.muted, letterSpacing: 1 }}>/ 30</div>
        </div>
      </div>

      <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 14, letterSpacing: 4, color: band.color, fontWeight: 700 }}>{band.label}</div>

      <div style={{ background: COLORS.dim, border: `1px solid ${COLORS.border}`, borderRadius: 16, padding: 20, width: "100%", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: COLORS.muted, letterSpacing: 3 }}>THIS WEEK'S READ</div>
        <div style={{ fontSize: 13, color: COLORS.white, lineHeight: 1.7, fontWeight: 300 }}>{summary.text}</div>
        <div style={{ borderTop: `1px solid ${COLORS.border}`, paddingTop: 14, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: COLORS.sky, letterSpacing: 2 }}>FOCUS THIS WEEK</div>
          <div style={{ fontSize: 12, color: "#AAC0D0", lineHeight: 1.65, borderLeft: `2px solid ${COLORS.sky}`, paddingLeft: 10 }}>{summary.focus}</div>
        </div>
      </div>

      <Btn onClick={onViewProfile} variant="secondary">View My Profile →</Btn>
    </div>
  );
}

// ── SCREEN: Admin ──────────────────────────────────────────────────────────
function AdminLogin({ onLogin }) {
  const [pw, setPw] = useState("");
  const [error, setError] = useState("");

  const handleLogin = () => {
    if (pw === ADMIN_PASSWORD) onLogin();
    else { setError("Incorrect password."); setPw(""); }
  };

  return (
    <div style={styles.screen}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, marginTop: 24 }}>
        <StarLogo size={36} />
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 28, fontWeight: 800, color: COLORS.white, letterSpacing: 2 }}>ADMIN ACCESS</div>
        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: COLORS.muted, letterSpacing: 3 }}>CHICAGO STARS FC · INTENTSCORE</div>
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 16 }}>
        <input
          type="password" value={pw}
          onChange={e => { setPw(e.target.value); setError(""); }}
          onKeyDown={e => e.key === "Enter" && handleLogin()}
          placeholder="Enter admin password"
          style={{ background: COLORS.dim, border: `1px solid ${error ? COLORS.red : COLORS.border}`, borderRadius: 12, padding: "16px 20px", color: COLORS.white, fontSize: 16, fontFamily: "'DM Sans', sans-serif", outline: "none", width: "100%", boxSizing: "border-box" }}
        />
        {error && <div style={{ fontSize: 12, color: COLORS.red, textAlign: "center" }}>{error}</div>}
      </div>
      <Btn onClick={handleLogin}>Access Dashboard →</Btn>
    </div>
  );
}

function AdminDashboard({ onBack }) {
  const [data, setData] = useState(null);
  const [allWeeks, setAllWeeks] = useState([]);
  const [resetting, setResetting] = useState(false);
  const [resetDone, setResetDone] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const weekKey = getWeekKey();
  const weekNum = parseInt(weekKey.split("W")[1]);

  const handleReset = async () => {
    setResetting(true);
    await resetAllData();
    setResetting(false);
    setConfirmReset(false);
    setResetDone(true);
    setData(null);
    setAllWeeks([]);
  };

  useEffect(() => {
    async function load() {
      const weekSubs = await getWeekSubmissions(weekKey);
      const count = weekSubs.length;
      let totals = Array(7).fill(0);
      let scores = [];
      let peerScores = [];
      for (const d of weekSubs) {
        scores.push(d.score);
        d.answers.forEach((a, i) => { totals[i] += a; if (i === 6) peerScores.push(a); });
      }
      const avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
      const avgPerQ = totals.map(t => scores.length ? (t / scores.length).toFixed(1) : "—");
      const avgTeamEnergy = peerScores.length ? (peerScores.reduce((a, b) => a + b, 0) / peerScores.length).toFixed(1) : null;

      const allSubs = await getAllSubmissions();
      const weekMap = {};
      for (const s of allSubs) {
        if (!weekMap[s.week_key]) weekMap[s.week_key] = [];
        weekMap[s.week_key].push(s.score);
      }
      const weeks = Object.entries(weekMap).map(([wk, s]) => ({
        week: wk,
        weekNum: parseInt(wk.split("W")[1]),
        avg: Math.round(s.reduce((a, b) => a + b, 0) / s.length),
        count: s.length,
      })).sort((a, b) => a.weekNum - b.weekNum);

      setData({ count, avgScore, avgPerQ, completionPct: Math.round((count / MAX_ROSTER) * 100), avgTeamEnergy });
      setAllWeeks(weeks);
    }
    load();
  }, [weekKey]);

  return (
    <div style={{ ...styles.screen, gap: 16, overflowY: "auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
        <div>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 26, fontWeight: 800, color: COLORS.white, letterSpacing: 1 }}>ADMIN DASHBOARD</div>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: COLORS.muted, letterSpacing: 2 }}>CHICAGO STARS FC</div>
        </div>
        <button onClick={onBack} style={{ background: "none", border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: "6px 12px", color: COLORS.muted, fontSize: 11, cursor: "pointer", fontFamily: "'DM Mono', monospace" }}>← BACK</button>
      </div>

      {!data ? <div style={{ color: COLORS.muted, fontSize: 13 }}>Loading...</div> : (
        <>
          <div style={{ background: COLORS.dim, border: `1px solid ${COLORS.border}`, borderRadius: 16, padding: 20 }}>
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: COLORS.sky, letterSpacing: 3, marginBottom: 16 }}>WEEK {weekNum} — CURRENT</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 16 }}>
              {[["Submitted", `${data.count}/${MAX_ROSTER}`], ["Completion", `${data.completionPct}%`], ["Team Avg", `${data.avgScore}/30`]].map(([label, val]) => (
                <div key={label} style={{ textAlign: "center" }}>
                  <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 28, color: COLORS.sky, fontWeight: 700 }}>{val}</div>
                  <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 8, color: COLORS.muted, letterSpacing: 1 }}>{label}</div>
                </div>
              ))}
            </div>
            {(() => {
              const note = getParticipationNote(data.count, MAX_ROSTER);
              return (
                <div style={{ fontSize: 11, color: note.color, lineHeight: 1.55, background: note.color + "15", borderRadius: 8, padding: "8px 10px", marginBottom: 16 }}>
                  {note.text}
                </div>
              );
            })()}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: COLORS.muted, letterSpacing: 2, marginBottom: 4 }}>AVG PER DIMENSION</div>
              {QUESTIONS.map((q, i) => (
                <div key={q.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <div style={{ fontSize: 9, color: COLORS.muted, width: 72, flexShrink: 0, fontFamily: "'DM Mono', monospace", letterSpacing: 1 }}>{q.dimension.toUpperCase()}</div>
                  <div style={{ flex: 1, height: 5, background: COLORS.navyDark, borderRadius: 3 }}>
                    <div style={{ height: "100%", width: `${(parseFloat(data.avgPerQ[i]) / 5) * 100}%`, background: q.type === "struggle" ? COLORS.red + "AA" : COLORS.sky, borderRadius: 3, transition: "width 0.8s" }} />
                  </div>
                  <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: COLORS.white, width: 28, textAlign: "right" }}>{data.avgPerQ[i]}</div>
                </div>
              ))}
            </div>
            {data.avgTeamEnergy && (
              <div style={{ borderTop: `1px solid ${COLORS.border}`, paddingTop: 12, marginTop: 8 }}>
                <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: "#F5A623", letterSpacing: 2, marginBottom: 8 }}>TEAM ENERGY PERCEPTION AVG</div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <div style={{ flex: 1, height: 6, background: COLORS.navyDark, borderRadius: 3 }}>
                    <div style={{ height: "100%", width: `${(parseFloat(data.avgTeamEnergy) / 5) * 100}%`, background: "#F5A623", borderRadius: 3 }} />
                  </div>
                  <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 20, color: "#F5A623", fontWeight: 700 }}>{data.avgTeamEnergy}<span style={{ fontSize: 11, color: COLORS.muted }}>/5</span></div>
                </div>
              </div>
            )}
          </div>

          {allWeeks.length > 1 && (
            <div style={{ background: COLORS.dim, border: `1px solid ${COLORS.border}`, borderRadius: 16, padding: 20 }}>
              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: COLORS.sky, letterSpacing: 3, marginBottom: 16 }}>SEASON TREND — TEAM AVG</div>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 80 }}>
                {allWeeks.map((w) => (
                  <div key={w.week} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                    <div style={{ width: "100%", background: w.week === weekKey ? COLORS.sky : COLORS.sky + "55", borderRadius: "3px 3px 0 0", height: `${(w.avg / 30) * 80}px`, transition: "height 0.5s" }} />
                    <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 7, color: COLORS.muted }}>W{w.weekNum}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {allWeeks.length > 0 && (
            <div style={{ background: COLORS.dim, border: `1px solid ${COLORS.border}`, borderRadius: 16, padding: 20 }}>
              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: COLORS.sky, letterSpacing: 3, marginBottom: 12 }}>ALL WEEKS</div>
              {allWeeks.map(w => (
                <div key={w.week} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${COLORS.border}` }}>
                  <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: COLORS.muted }}>WEEK {w.weekNum}</div>
                  <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: COLORS.muted }}>{w.count} submitted</div>
                  <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 16, color: COLORS.sky, fontWeight: 700 }}>{w.avg}/30</div>
                </div>
              ))}
            </div>
          )}

          <div style={{ background: COLORS.dim, border: `1px solid ${COLORS.red}33`, borderRadius: 16, padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: COLORS.red, letterSpacing: 3 }}>DANGER ZONE — TEST DATA RESET</div>
            <div style={{ fontSize: 12, color: COLORS.muted, lineHeight: 1.6 }}>
              Wipes all submissions and player numbers. Use this to clear test data before handing the tool to the team. This cannot be undone.
            </div>
            {resetDone ? (
              <div style={{ fontSize: 13, color: COLORS.sky, fontFamily: "'DM Mono', monospace", letterSpacing: 1 }}>✓ All data cleared. App is fresh.</div>
            ) : !confirmReset ? (
              <button onClick={() => setConfirmReset(true)} style={{ background: "none", border: `1px solid ${COLORS.red}`, borderRadius: 10, padding: "12px", color: COLORS.red, fontFamily: "'Barlow Condensed', sans-serif", fontSize: 16, letterSpacing: 2, cursor: "pointer" }}>
                RESET ALL DATA
              </button>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ fontSize: 13, color: COLORS.white, textAlign: "center" }}>Are you sure? This deletes everything.</div>
                <div style={{ display: "flex", gap: 10 }}>
                  <button onClick={handleReset} disabled={resetting} style={{ flex: 1, background: COLORS.red, border: "none", borderRadius: 10, padding: "12px", color: COLORS.white, fontFamily: "'Barlow Condensed', sans-serif", fontSize: 16, letterSpacing: 2, cursor: "pointer" }}>
                    {resetting ? "CLEARING..." : "YES, RESET"}
                  </button>
                  <button onClick={() => setConfirmReset(false)} style={{ flex: 1, background: "none", border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "12px", color: COLORS.muted, fontFamily: "'Barlow Condensed', sans-serif", fontSize: 16, letterSpacing: 2, cursor: "pointer" }}>
                    CANCEL
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Root App ───────────────────────────────────────────────────────────────
export default function IntentScore() {
  const weekKey = getWeekKey();
  const [view, setView] = useState("loading");
  const [playerNum, setPlayerNum] = useState(null);
  const [history, setHistory] = useState([]);
  const [resultData, setResultData] = useState(null);

  useEffect(() => {
    async function init() {
      if (window.location.hash === "#admin") { setView("admin-login"); return; }
      const savedNum = localStorage.getItem("intentscore_num");
      if (savedNum) {
        setPlayerNum(savedNum);
        const hist = await getPlayerHistory(savedNum);
        setHistory(hist);
        setView("profile");
      } else {
        const seen = localStorage.getItem("intentscore_seen");
        setView(seen ? "returning" : "onboarding");
      }
    }
    init();
  }, []);

  const handleOnboarding = () => {
    localStorage.setItem("intentscore_seen", "1");
    setView("entry");
  };

  const handleNumberEntered = async (num) => {
    localStorage.setItem("intentscore_num", num);
    setPlayerNum(num);
    const hist = await getPlayerHistory(num);
    setHistory(hist);
    setView("profile");
  };

  const handleAssessmentComplete = async (score, answers) => {
    const hist = await getPlayerHistory(playerNum);
    setHistory(hist);
    setResultData({ score, answers });
    setView("result");
  };

  const alreadySubmitted = history.some(h => h.week === weekKey);

  return (
    <div style={{ minHeight: "100vh", background: "#0A1520", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans', sans-serif", color: COLORS.white, padding: "20px 0" }}>
      <div style={{ width: "100%", maxWidth: 390, minHeight: 700, background: COLORS.navy, borderRadius: 32, border: `1px solid ${COLORS.border}`, boxShadow: "0 40px 80px rgba(0,0,0,0.5)", display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>
        {view !== "admin-login" && view !== "admin" && (
          <button onClick={() => setView("admin-login")} style={{ position: "absolute", top: 16, right: 16, background: "none", border: "none", color: COLORS.border, fontSize: 10, fontFamily: "'DM Mono', monospace", cursor: "pointer", letterSpacing: 1, zIndex: 10 }}>ADMIN</button>
        )}
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          {view === "loading" && <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}><StarLogo size={48} /></div>}
          {view === "onboarding" && <OnboardingScreen onContinue={handleOnboarding} />}
          {view === "returning" && <ReturningEntry onEnter={handleNumberEntered} onNewNumber={() => setView("entry")} />}
          {view === "entry" && <NumberEntry onEnter={handleNumberEntered} />}
          {view === "profile" && <ProfileScreen playerNum={playerNum} history={history} weekKey={weekKey} onTakeAssessment={() => { if (!alreadySubmitted) setView("assessment"); }} />}
          {view === "assessment" && <AssessmentScreen playerNum={playerNum} weekKey={weekKey} onComplete={handleAssessmentComplete} />}
          {view === "result" && resultData && <ScoreRevealScreen score={resultData.score} answers={resultData.answers} onViewProfile={() => setView("profile")} />}
          {view === "admin-login" && <AdminLogin onLogin={() => setView("admin")} />}
          {view === "admin" && <AdminDashboard onBack={() => setView(playerNum ? "profile" : "returning")} />}
        </div>
      </div>
    </div>
  );
}
