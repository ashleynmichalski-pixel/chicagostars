import { useState, useEffect } from "react";
import {
  playerExists, registerPlayer, saveSubmission,
  getPlayerHistory, getPlayerFullHistory, getWeekSubmissions, getAllSubmissions,
  resetAllData, saveNote, getPlayerSubmission, getWeekFeedback,
} from "./lib/db";

// ── Constants ──────────────────────────────────────────────────────────────
const ADMIN_PASSWORD = "StarsIntent2026";
const MIN_SUBMISSIONS_TO_UNLOCK = 3;
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
function getParticipationNote(count, total, showCount = true) {
  const pct = count / total;
  const prefix = showCount ? `${count} of ${total} athletes responded — ` : "";
  if (pct >= 0.8) return { text: `${prefix}High participation. This is a reliable read on where the team is this week.`, color: COLORS.sky };
  if (pct >= 0.5) return { text: `${prefix}Solid sample. This reflects a meaningful portion of the team but isn't the full picture.`, color: COLORS.sky };
  if (pct >= 0.3) return { text: `${prefix}Partial data. Directionally useful, but not the full team yet.`, color: "#F5A623" };
  return { text: `${prefix}Early data. Treat this as an initial signal — more check-ins are still coming in.`, color: "#F5A623" };
}

function getTeamSummary(avgScore, avgPerQ) {
  const dims = QUESTIONS.map((q, i) => {
    const val = parseFloat(avgPerQ[i]) || 0;
    const adjusted = q.type === "struggle" && !q.reversed ? 5 - val : val;
    return { dimension: q.dimension, score: adjusted };
  });
  dims.sort((a, b) => a.score - b.score);
  const weak = dims[0].dimension;
  const weakLabel = weak.charAt(0).toUpperCase() + weak.slice(1);

  if (avgScore >= 24) return {
    color: COLORS.sky,
    text: `As a group, the team brought real intention to training this week. The data reflects a collective that is actively engaging — not just putting in time. The shared area with the most room to grow: ${weakLabel}. That's where the team's next level lives.`,
  };
  if (avgScore >= 18) return {
    color: COLORS.sky,
    text: `The team is trending in the right direction, but there's a gap between intention and execution at the group level. Some athletes are locking in consistently; others aren't fully there yet. ${weakLabel} is where that gap is widest across the team.`,
  };
  if (avgScore >= 12) return {
    color: "#F5A623",
    text: `The team's intentionality was uneven this week. The data shows a split — some athletes brought real focus, others went through the motions. That inconsistency at the group level is worth addressing directly. ${weakLabel} needs collective attention.`,
  };
  return {
    color: COLORS.red,
    text: `As a group, this was not an intentional week — the data is clear. This isn't just about individual effort; it's about whether the team's collective environment is driving focus in training. ${weakLabel} is where the biggest gap sits.`,
  };
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

function getWeekDeadline() {
  const now = new Date();
  const daysUntilSunday = now.getDay() === 0 ? 0 : 7 - now.getDay();
  const sunday = new Date(now);
  sunday.setDate(now.getDate() + daysUntilSunday);
  return sunday.toLocaleDateString("default", { month: "short", day: "numeric" });
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
function Sparkline({ history }) {
  if (history.length < 2) return null;
  const sorted = [...history].sort((a, b) => a.weekNum - b.weekNum);
  const W = 100, H = 28, pad = 3;
  const pts = sorted.map((h, i) => {
    const x = pad + (i / (sorted.length - 1)) * (W - pad * 2);
    const y = H - pad - (h.score / 30) * (H - pad * 2);
    return `${x},${y}`;
  }).join(" ");
  const last = sorted[sorted.length - 1];
  const prev = sorted[sorted.length - 2];
  const trending = last.score >= prev.score;
  const color = trending ? COLORS.sky : COLORS.red;
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: "block", height: 28 }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />
      {sorted.map((h, i) => {
        const x = pad + (i / (sorted.length - 1)) * (W - pad * 2);
        const y = H - pad - (h.score / 30) * (H - pad * 2);
        return <circle key={i} cx={x} cy={y} r={i === sorted.length - 1 ? 2.5 : 1.5} fill={i === sorted.length - 1 ? color : color + "88"} />;
      })}
    </svg>
  );
}

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
function NumberEntry({ onEnter, onSwitchToLogin }) {
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

        {error && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "center" }}>
            <div style={{ fontSize: 12, color: COLORS.red, textAlign: "center", lineHeight: 1.5 }}>{error}</div>
            {error.includes("already taken") && (
              <button onClick={() => onSwitchToLogin(num)} style={{ background: "none", border: "none", color: COLORS.sky, fontSize: 12, cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 3, fontFamily: "'DM Sans', sans-serif", padding: 0 }}>
                That's my number — log in instead
              </button>
            )}
          </div>
        )}

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
function ReturningEntry({ onEnter, onNewNumber, initialNum = "" }) {
  const [num, setNum] = useState(initialNum);
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
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedWeek, setExpandedWeek] = useState(null);
  const [weekDetails, setWeekDetails] = useState({});
  const [fullHistory, setFullHistory] = useState([]);
  const [showAths, setShowAths] = useState(() => {
    if (typeof window !== "undefined" && window.matchMedia("(display-mode: standalone)").matches) return false;
    return !localStorage.getItem("intentscore_aths_dismissed");
  });
  const thisWeekDone = history.some(h => h.week === weekKey);
  const bestScore = history.length >= 3 ? Math.max(...history.map(h => h.score)) : null;

  const dismissAths = () => {
    localStorage.setItem("intentscore_aths_dismissed", "1");
    setShowAths(false);
  };

  const handleHistoryTap = async (h) => {
    if (expandedWeek === h.week) { setExpandedWeek(null); return; }
    setExpandedWeek(h.week);
    if (!weekDetails[h.week]) {
      const sub = await getPlayerSubmission(playerNum, h.week);
      const noteRaw = localStorage.getItem(`intentscore_note:${playerNum}:${h.week}`);
      const note = noteRaw ? JSON.parse(noteRaw).note : null;
      if (sub) setWeekDetails(prev => ({ ...prev, [h.week]: { ...sub, note } }));
    }
  };

  useEffect(() => {
    getPlayerFullHistory(playerNum).then(setFullHistory);
  }, [playerNum, history.length]);

  useEffect(() => {
    if (!thisWeekDone) return;
    async function loadTeam() {
      setRefreshing(true);
      const submissions = await getWeekSubmissions(weekKey);
      const count = submissions.length;
      if (count < MIN_SUBMISSIONS_TO_UNLOCK) { setTeamData({ count, unlocked: false }); setRefreshing(false); return; }
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
      setRefreshing(false);
    }
    loadTeam();
  }, [thisWeekDone, weekKey, refreshKey]);

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
      {showAths && (
        <div style={{ background: COLORS.sky + "18", border: `1px solid ${COLORS.sky}44`, borderRadius: 12, padding: "12px 14px", display: "flex", gap: 10, alignItems: "flex-start", marginTop: 12 }}>
          <div style={{ fontSize: 16, flexShrink: 0 }}>📲</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: COLORS.white, fontWeight: 500, marginBottom: 4 }}>Add to your home screen</div>
            {/android/i.test(navigator.userAgent) ? (
              <div style={{ fontSize: 11, color: COLORS.muted, lineHeight: 1.6 }}>
                Tap the <span style={{ color: COLORS.white }}>⋮ three dots</span> in the top right of your browser → <span style={{ color: COLORS.white }}>Add to Home Screen</span>
              </div>
            ) : (
              <div style={{ fontSize: 11, color: COLORS.muted, lineHeight: 1.6 }}>
                Tap the <span style={{ color: COLORS.white }}>· · · three dots</span> next to the URL → <span style={{ color: COLORS.white }}>Add to Home Screen</span>
              </div>
            )}
          </div>
          <button onClick={dismissAths} style={{ background: "none", border: "none", color: COLORS.muted, fontSize: 16, cursor: "pointer", padding: 0, lineHeight: 1, flexShrink: 0 }}>✕</button>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: showAths ? 0 : 12 }}>
        <div>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: COLORS.muted, letterSpacing: 3 }}>YOUR ID</div>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 56, color: COLORS.sky, fontWeight: 800, lineHeight: 1 }}>{playerNum}</div>
        </div>
        <div style={{ display: "flex", gap: 20, alignItems: "flex-end" }}>
          {bestScore !== null && (
            <div style={{ textAlign: "right" }}>
              <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 36, color: "#F5A623", fontWeight: 700, lineHeight: 1 }}>{bestScore}</div>
              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 8, color: COLORS.muted, letterSpacing: 2 }}>BEST ⭐</div>
            </div>
          )}
          <div style={{ textAlign: "right" }}>
            <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 36, color: COLORS.white, fontWeight: 700, lineHeight: 1 }}>{streak}</div>
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 8, color: COLORS.muted, letterSpacing: 2 }}>STREAK 🔥</div>
          </div>
        </div>
      </div>

      {!thisWeekDone ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Btn onClick={onTakeAssessment}>Take This Week's Check-In →</Btn>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: COLORS.muted, letterSpacing: 2, textAlign: "center" }}>CLOSES {getWeekDeadline().toUpperCase()}</div>
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
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: COLORS.sky, letterSpacing: 3 }}>THIS WEEK — TEAM DATA</div>
            <button onClick={() => setRefreshKey(k => k + 1)} disabled={refreshing} style={{ background: "none", border: "none", color: refreshing ? COLORS.border : COLORS.muted, fontSize: 14, cursor: refreshing ? "default" : "pointer", padding: 0, lineHeight: 1 }}>↻</button>
          </div>
          <div style={{ fontSize: 11, color: COLORS.muted, lineHeight: 1.6, marginBottom: 10 }}>Your team's collective intentionality shapes the training environment everyone develops in. Use this as a pulse check — not a grade.</div>
          {!teamData ? (
            <div style={{ fontSize: 12, color: COLORS.muted }}>Loading...</div>
          ) : !teamData.unlocked ? (
            <div style={{ fontSize: 13, color: COLORS.muted, lineHeight: 1.6 }}>
              Team results will be available once a few more teammates have checked in. Check back later.
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
                const note = getParticipationNote(teamData.count, MAX_ROSTER, false);
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
              <div style={{ display: "flex", gap: 14, marginTop: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <div style={{ width: 8, height: 8, borderRadius: 2, background: COLORS.sky + "99", flexShrink: 0 }} />
                  <div style={{ fontSize: 9, color: COLORS.muted, fontFamily: "'DM Mono', monospace" }}>INTENTIONALITY</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <div style={{ width: 8, height: 8, borderRadius: 2, background: COLORS.red + "99", flexShrink: 0 }} />
                  <div style={{ fontSize: 9, color: COLORS.muted, fontFamily: "'DM Mono', monospace" }}>STRUGGLE DIMENSIONS</div>
                </div>
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
              {(() => {
                const ts = getTeamSummary(teamData.avgScore, teamData.avgPerQ);
                return (
                  <div style={{ borderTop: `1px solid ${COLORS.border}`, paddingTop: 14, marginTop: 4 }}>
                    <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: ts.color, letterSpacing: 2, marginBottom: 8 }}>THIS WEEK'S TEAM READ</div>
                    <div style={{ fontSize: 12, color: COLORS.white, lineHeight: 1.7, fontWeight: 300 }}>{ts.text}</div>
                  </div>
                );
              })()}
              <div style={{ borderTop: `1px solid ${COLORS.border}`, paddingTop: 10, marginTop: 4 }}>
                <div style={{ fontSize: 10, color: "#4A6580", lineHeight: 1.6 }}>
                  Team data resets each week as new check-ins come in. As the season builds, your individual history below will show how your scores track week over week.
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {history.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: COLORS.muted, letterSpacing: 3 }}>YOUR HISTORY</div>
            <div style={{ width: 80 }}><Sparkline history={history} /></div>
          </div>
          {[...history].sort((a, b) => b.weekNum - a.weekNum).map((h) => {
            const isOpen = expandedWeek === h.week;
            const detail = weekDetails[h.week];
            const band = getScoreBand(h.score);
            const summary = detail ? getSummaryContent(h.score, detail.answers) : null;
            return (
              <div key={h.week} style={{ background: COLORS.dim, border: `1px solid ${isOpen ? COLORS.sky + "55" : COLORS.border}`, borderRadius: 10, overflow: "hidden", transition: "border-color 0.2s" }}>
                <button onClick={() => handleHistoryTap(h)} style={{ width: "100%", background: "none", border: "none", display: "flex", alignItems: "center", padding: "12px 14px", gap: 10, cursor: "pointer" }}>
                  <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: COLORS.muted, width: 48, flexShrink: 0, textAlign: "left" }}>WK {h.weekNum}</div>
                  <div style={{ flex: 1, height: 3, background: COLORS.navyDark, borderRadius: 2 }}>
                    <div style={{ height: "100%", width: `${(h.score / 30) * 100}%`, background: COLORS.sky, borderRadius: 2 }} />
                  </div>
                  <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 20, color: COLORS.sky, fontWeight: 700, width: 40, textAlign: "right" }}>{h.score}</div>
                  <div style={{ color: COLORS.muted, fontSize: 12, width: 14, textAlign: "right", flexShrink: 0 }}>{isOpen ? "▲" : "▼"}</div>
                </button>
                {isOpen && (
                  <div style={{ padding: "0 14px 14px", display: "flex", flexDirection: "column", gap: 12 }}>
                    <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 11, letterSpacing: 3, color: band.color, fontWeight: 700 }}>{band.label}</div>
                    {!detail ? (
                      <div style={{ fontSize: 12, color: COLORS.muted }}>Loading...</div>
                    ) : (
                      <>
                        <div style={{ fontSize: 12, color: COLORS.white, lineHeight: 1.7, fontWeight: 300 }}>{summary.text}</div>
                        <div style={{ borderTop: `1px solid ${COLORS.border}`, paddingTop: 10 }}>
                          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: COLORS.sky, letterSpacing: 2, marginBottom: 6 }}>FOCUS</div>
                          <div style={{ fontSize: 12, color: "#AAC0D0", lineHeight: 1.65, borderLeft: `2px solid ${COLORS.sky}`, paddingLeft: 10 }}>{summary.focus}</div>
                        </div>
                        {detail.note && (
                          <div style={{ borderTop: `1px solid ${COLORS.border}`, paddingTop: 10 }}>
                            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: COLORS.muted, letterSpacing: 2, marginBottom: 6 }}>YOUR NOTE</div>
                            <div style={{ fontSize: 12, color: COLORS.muted, lineHeight: 1.65, fontStyle: "italic" }}>{detail.note}</div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {fullHistory.length >= 2 && (() => {
        const nonPeerQs = QUESTIONS.filter(q => q.type !== "peer");
        const dimHistory = nonPeerQs.map(q => ({
          label: q.dimension.slice(0, 5).toUpperCase(),
          dimension: q.dimension,
          weeks: fullHistory.map(h => ({
            weekNum: h.week_num,
            score: getAdjustedScore(q, h.answers, QUESTIONS.indexOf(q)),
          })),
        }));
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: COLORS.muted, letterSpacing: 3 }}>DIMENSION TRENDS</div>
            <div style={{ background: COLORS.dim, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
              {dimHistory.map(({ label, weeks }) => {
                const latest = weeks[weeks.length - 1]?.score;
                const color = latest >= 4 ? COLORS.sky : latest >= 3 ? "#F5A623" : COLORS.red;
                return (
                  <div key={label} style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 8, color: COLORS.muted, width: 42, flexShrink: 0, letterSpacing: 1 }}>{label}</div>
                    <div style={{ flex: 1, display: "flex", gap: 4, alignItems: "center" }}>
                      {weeks.map((w, i) => {
                        const c = w.score >= 4 ? COLORS.sky : w.score >= 3 ? "#F5A623" : COLORS.red;
                        const isLatest = i === weeks.length - 1;
                        return (
                          <div key={i} style={{ width: isLatest ? 10 : 7, height: isLatest ? 10 : 7, borderRadius: "50%", background: c, opacity: isLatest ? 1 : 0.5, flexShrink: 0 }} />
                        );
                      })}
                    </div>
                    <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 16, color, fontWeight: 700, width: 20, textAlign: "right" }}>{latest}</div>
                  </div>
                );
              })}
              <div style={{ display: "flex", gap: 12, marginTop: 4, paddingTop: 8, borderTop: `1px solid ${COLORS.border}` }}>
                {[{ color: COLORS.sky, label: "Strong (4-5)" }, { color: "#F5A623", label: "Developing (3)" }, { color: COLORS.red, label: "Needs focus (1-2)" }].map(({ color, label }) => (
                  <div key={label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: color }} />
                    <div style={{ fontSize: 8, color: COLORS.muted, fontFamily: "'DM Mono', monospace" }}>{label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      <button
        onClick={() => {
          localStorage.removeItem("intentscore_num");
          localStorage.removeItem("intentscore_seen");
          window.location.reload();
        }}
        style={{ background: "none", border: "none", color: "#4A6580", fontSize: 10, fontFamily: "'DM Mono', monospace", letterSpacing: 2, cursor: "pointer", textAlign: "center", paddingBottom: 8, textDecoration: "underline", textUnderlineOffset: 3 }}
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
  const [coachingRetention, setCoachingRetention] = useState(null);
  const [otherConcerns, setOtherConcerns] = useState("");
  const [showNote, setShowNote] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  const q = QUESTIONS[current];
  const isLast = current === QUESTIONS.length - 1;

  const selectRating = (val) => {
    const next = [...answers];
    next[current] = val;
    setAnswers(next);
    setTimeout(() => {
      if (current === QUESTIONS.length - 1) setShowNote(true);
      else setCurrent(c => c + 1);
    }, 320);
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    const score = computeIntentScore(answers);
    const weekNum = parseInt(weekKey.split("W")[1]);
    const { error } = await saveSubmission({
      weekKey, playerNum, answers: answers.map(a => a ?? 0), score, weekNum,
      coachingRetention, otherConcerns,
    });
    if (error) {
      setSubmitting(false);
      setSubmitError("You've already submitted this week. Come back next week!");
      return;
    }
    if (note.trim()) saveNote(playerNum, weekKey, note.trim());
    setSubmitting(false);
    onComplete(score, answers);
  };

  if (showNote) {
    return (
      <div style={styles.screen}>
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 20 }}>

          {/* Coaching feedback section */}
          <div style={{ background: COLORS.dim, border: `1px solid ${COLORS.border}`, borderRadius: 14, padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: COLORS.sky, letterSpacing: 3, marginBottom: 4 }}>FOR COACHING STAFF — OPTIONAL</div>
              <div style={{ fontSize: 11, color: COLORS.muted, lineHeight: 1.5 }}>Anonymous. Team psychologist only shares themes and averages.</div>
            </div>

            <div>
              <div style={{ fontSize: 13, color: COLORS.white, lineHeight: 1.55, fontWeight: 300, marginBottom: 12 }}>
                This week, how well are you retaining and understanding the information from coaching sessions?
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {[1, 2, 3, 4, 5].map(v => (
                  <button key={v} onClick={() => setCoachingRetention(coachingRetention === v ? null : v)} style={{
                    flex: 1, aspectRatio: "1", background: coachingRetention === v ? COLORS.sky : COLORS.navyDark,
                    border: `1px solid ${coachingRetention === v ? COLORS.sky : COLORS.border}`,
                    borderRadius: 10, fontFamily: "'Barlow Condensed', sans-serif", fontSize: 22, fontWeight: 700,
                    color: coachingRetention === v ? COLORS.navy : COLORS.muted, cursor: "pointer", transition: "all 0.15s",
                  }}>
                    {v}
                  </button>
                ))}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5 }}>
                <div style={{ fontSize: 9, color: "#4A6580" }}>Not at all</div>
                <div style={{ fontSize: 9, color: "#4A6580" }}>Completely</div>
              </div>
            </div>

            <div>
              <div style={{ fontSize: 13, color: COLORS.white, lineHeight: 1.55, fontWeight: 300, marginBottom: 8 }}>
                Any other concerns or thoughts for the coaching staff?
              </div>
              <textarea
                value={otherConcerns}
                onChange={e => setOtherConcerns(e.target.value)}
                placeholder="Anything on your mind..."
                style={{ width: "100%", background: COLORS.navyDark, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 14, color: COLORS.white, fontSize: 13, fontFamily: "'DM Sans', sans-serif", resize: "none", height: 80, outline: "none", lineHeight: 1.6, boxSizing: "border-box" }}
              />
            </div>
          </div>

          {/* Private note section */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: COLORS.muted, letterSpacing: 3 }}>YOUR PRIVATE NOTE — OPTIONAL</div>
            <div style={{ fontSize: 11, color: COLORS.muted, lineHeight: 1.5 }}>Only you can see this — not stored on any server.</div>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Travel schedule, injury, something you noticed..."
              style={{ width: "100%", background: COLORS.dim, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 14, color: COLORS.white, fontSize: 13, fontFamily: "'DM Sans', sans-serif", resize: "none", height: 90, outline: "none", lineHeight: 1.6, boxSizing: "border-box" }}
            />
          </div>
        </div>

        <div style={{ flex: 1 }} />
        {submitError ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 12, color: COLORS.sky, textAlign: "center", lineHeight: 1.6, background: COLORS.sky + "15", borderRadius: 10, padding: "10px 14px" }}>{submitError}</div>
            <Btn onClick={() => onComplete(computeIntentScore(answers), answers)}>View My Score →</Btn>
          </div>
        ) : (
          <Btn onClick={handleSubmit} disabled={submitting}>
            {submitting ? "Submitting..." : "Submit & See My Score →"}
          </Btn>
        )}
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

      {current > 0 && (
        <button onClick={() => setCurrent(current - 1)} style={{ background: "none", border: `1px solid ${COLORS.border}`, borderRadius: 10, color: COLORS.muted, fontSize: 13, cursor: "pointer", padding: "12px", fontFamily: "'DM Mono', monospace", letterSpacing: 1, width: "100%" }}>← BACK</button>
      )}
    </div>
  );
}

// ── SCREEN: Score Reveal ───────────────────────────────────────────────────
function ScoreRevealScreen({ score, answers, prevScore, onViewProfile, onDeepProfile }) {
  const [displayed, setDisplayed] = useState(0);
  const band = getScoreBand(score);
  const summary = getSummaryContent(score, answers);
  const pct = (score / 30) * 100;
  const delta = prevScore !== null && prevScore !== undefined ? score - prevScore : null;

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

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 14, letterSpacing: 4, color: band.color, fontWeight: 700 }}>{band.label}</div>
        {delta !== null && (
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: delta > 0 ? COLORS.sky : delta < 0 ? COLORS.red : COLORS.muted, letterSpacing: 1 }}>
            {delta > 0 ? `▲ +${delta}` : delta < 0 ? `▼ ${delta}` : `— same`} from last week
          </div>
        )}
      </div>

      {/* Dimension breakdown */}
      <div style={{ background: COLORS.dim, border: `1px solid ${COLORS.border}`, borderRadius: 16, padding: 20, width: "100%", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: COLORS.muted, letterSpacing: 3, marginBottom: 2 }}>YOUR DIMENSIONS</div>
        {QUESTIONS.filter(q => q.type !== "peer").map((q, i) => {
          const raw = answers[i] ?? 0;
          const adjusted = q.type === "struggle" && !q.reversed ? 6 - raw : raw;
          return (
            <div key={q.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <div style={{ fontSize: 9, color: COLORS.muted, width: 72, flexShrink: 0, fontFamily: "'DM Mono', monospace", letterSpacing: 1 }}>{q.dimension.toUpperCase()}</div>
              <div style={{ flex: 1, height: 5, background: COLORS.navyDark, borderRadius: 3 }}>
                <div style={{ height: "100%", width: `${(adjusted / 5) * 100}%`, background: adjusted >= 4 ? COLORS.sky : adjusted >= 3 ? "#F5A623" : COLORS.red, borderRadius: 3, transition: "width 1s ease" }} />
              </div>
              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: COLORS.white, width: 12, textAlign: "right" }}>{adjusted}</div>
            </div>
          );
        })}
      </div>

      <div style={{ background: COLORS.dim, border: `1px solid ${COLORS.border}`, borderRadius: 16, padding: 20, width: "100%", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: COLORS.muted, letterSpacing: 3 }}>THIS WEEK'S READ</div>
        <div style={{ fontSize: 13, color: COLORS.white, lineHeight: 1.7, fontWeight: 300 }}>{summary.text}</div>
        <div style={{ borderTop: `1px solid ${COLORS.border}`, paddingTop: 14, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: COLORS.sky, letterSpacing: 2 }}>FOCUS THIS WEEK</div>
          <div style={{ fontSize: 12, color: "#AAC0D0", lineHeight: 1.65, borderLeft: `2px solid ${COLORS.sky}`, paddingLeft: 10 }}>{summary.focus}</div>
        </div>
      </div>

      <div style={{ fontSize: 10, color: "#4A6580", textAlign: "center", lineHeight: 1.6, paddingTop: 4 }}>
        Insights are AI-generated based on your responses and may not reflect complete accuracy. Use as a starting point for reflection.
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%" }}>
        <Btn onClick={onDeepProfile}>View In-Depth Profile →</Btn>
        <Btn onClick={onViewProfile} variant="secondary">View My Profile →</Btn>
      </div>
    </div>
  );
}

// ── Deep profile content ───────────────────────────────────────────────────
const DIMENSION_DETAIL = {
  preparation: {
    label: "Preparation",
    what: "How deliberately you prime your mind before training begins.",
    high: {
      read: (s) => "You're consistently entering sessions with a clear purpose. That pre-session clarity isn't a small thing — it's the difference between training and practicing. Athletes who set specific intentions before they start learn faster because their brain knows what to filter for. Keep it specific, keep it writeable." +
        (s.awareness < 3 ? " One gap worth watching: with your in-session awareness lower this week, that clear intention isn't always being checked against what's actually happening. Preparation and awareness need to work as a pair — one sets the target, the other tracks whether you're hitting it." :
         s.learning < 3 ? " The next level is converting that preparation into a specific learning target — not just an intention to show up focused, but something measurable you're trying to improve by the end of each session." : ""),
      action: "Push your intention further: not just what you'll work on, but what 'doing it well' will look like in that session. Raise the bar on your own standard.",
    },
    mid: {
      read: (s) => "You're setting intentions some of the time — but not consistently enough for it to compound. Preparation only works when it becomes automatic. The sessions where you didn't prepare are the sessions where you defaulted to habit instead of growth." +
        (s.awareness < 3 ? " And without consistent in-session awareness to check your intention against, the sessions where you did prepare may not be translating as much as they could." :
         s.learning < 3 ? " That also explains your learning score — without a clear upfront intention, there's no defined gap to close during the session." : ""),
      action: "Before your next session, write your intention down — even one sentence. The act of writing it makes it real. Check back at the end and see if you followed through.",
    },
    low: {
      read: (s) => "You're entering sessions without a clear target, which means your effort isn't being directed — it's just being spent. Volume without intention builds habits, not skills. You can work extremely hard and get extremely average results if you're not training toward something specific." +
        (s.learning >= 4 ? " There's something worth noting: your learning score was strong this week — meaning you're extracting lessons even without clear upfront preparation. Imagine how much faster that develops when you combine it with a specific intention going in." :
         s.awareness < 3 ? " With both preparation and awareness low this week, you're entering sessions without a target and without a mid-session check. That's the full loop missing." : ""),
      action: "Before your next session, answer one question out loud: what specifically will I do differently today than I did last time? If you can't answer it, you're not ready to start.",
    },
  },
  awareness: {
    label: "Awareness",
    what: "Your ability to detect in real time when something isn't working and adjust.",
    high: {
      read: (s) => "You have real-time feedback loops running. Noticing what isn't working while it's happening — not after the session, not after the season — is one of the hardest skills to develop. Most athletes need a coach to tell them. You're catching it yourself. That's a genuine edge that compounds over time." +
        (s.recovery < 3 ? " One gap to close: your recovery score shows that detection isn't always leading to adjustment. You're catching the problem but not always making a specific change on the next rep. Detection without adjustment leaves the feedback loop half-open." :
         s.presence < 3 ? " One thing to watch: your presence score shows you were mentally elsewhere at times this week. The moments you drifted are the moments your awareness couldn't function — you can only notice what's happening when you're actually there." : ""),
      action: "Start tracking what you're catching. After sessions, note what you noticed and what you changed. Patterns in your awareness will tell you where your blind spots still are.",
    },
    mid: {
      read: (s) => "You're aware sometimes — but you're catching things after several reps instead of immediately. The gap isn't attention, it's calibration. You haven't yet set a clear enough standard for what 'working' looks like, so it takes longer to detect when you've drifted from it." +
        (s.presence < 3 ? " Your presence score this week helps explain the gap — when you left the session mentally, your ability to notice what wasn't working went with it. Presence is the precondition for awareness." :
         s.preparation >= 4 ? " You're entering sessions with clear intentions — that's real. Use those intentions as your awareness anchor: check yourself against the standard you set before you walked in." : ""),
      action: "Before your next session, define one specific thing to watch for. Not a vague feeling — a concrete marker. Give your awareness a target and it becomes much sharper.",
    },
    low: {
      read: (s) => "You're completing sessions without detecting what's working and what isn't. That means you could be reinforcing poor patterns without knowing it — and every rep you take without feedback is a rep that locks something in. Awareness is trainable, but only if you practice it intentionally." +
        (s.presence < 3 ? " These two are deeply linked: you can't notice what's happening mid-session if you're not mentally present for it. Presence is the prerequisite — start there." :
         s.preparation >= 4 ? " You're entering sessions with clear intentions, which is a real foundation. The missing piece is checking those intentions mid-session. You have a target — now learn to track whether you're hitting it." : ""),
      action: "Pause once, mid-session — just once. Ask yourself: is what I'm doing right now actually working? Yes or no. That one pause is the beginning of the skill.",
    },
  },
  presence: {
    label: "Presence",
    what: "The degree to which you were mentally engaged, not just physically there.",
    high: {
      read: (s) => "Your mental engagement this week was strong. You were where your feet were. That kind of presence is increasingly rare — distractions are everywhere and sustaining focus across a full session takes real discipline. The challenge now is maintaining it when conditions aren't ideal: when you're tired, frustrated, or coming off a bad rep." +
        (s.recovery < 3 ? " One opportunity to leverage this: when you're as locked in as you were this week, you should also be catching mistakes quickly and adjusting rep-to-rep. Your recovery score has room to grow — and strong presence gives you the platform to do that." :
         s.awareness >= 4 ? " Your awareness is also high this week — these two are working together. When presence and awareness are both active, you're operating at the highest level of intentional training." : ""),
      action: "Notice what your best presence sessions have in common. Time of day, warm-up routine, mindset going in. Start engineering the conditions that make presence easier to access.",
    },
    mid: {
      read: (s) => "You drifted in and out this week. Some moments you were fully in it, others your mind was somewhere else entirely. That fluctuation is normal — but it's where development slows, because you only learn in the moments you're actually present for. The moments you drifted, you were logging time without logging growth." +
        (s.quality < 3 ? " That drift is likely connected to your quality score — it's very hard to prioritize executing well when you're not fully mentally engaged. Presence is the foundation quality is built on." :
         s.awareness < 3 ? " It also explains the awareness gap — when you drifted, your ability to notice what wasn't working drifted with you." : ""),
      action: "When you notice yourself leaving, don't judge it — just name it. 'I just left.' Then come back. The noticing is the skill. You can't return to something you didn't realize you left.",
    },
    low: {
      read: (s) => "You spent significant time this week physically in training but mentally elsewhere. That's one of the most expensive places to be — you're logging hours without logging learning. It also affects teammates. Presence isn't just about your development; it's part of the team's collective environment." +
        (s.quality < 3 ? " Your quality score reflects this directly — the two compound each other. It's nearly impossible to maintain execution standards when your mind has already left the session." :
         s.awareness < 3 ? " With both presence and awareness low this week, neither of your real-time feedback systems were functioning. You were in training, but not really training." : ""),
      action: "Build a physical reset cue — one specific action that signals your brain to return. A breath, a word, a tap on your leg. Use it every time you catch yourself drifting. Consistency builds the habit.",
    },
  },
  learning: {
    label: "Learning",
    what: "Whether you identified a specific gap and deliberately worked to close it.",
    high: {
      read: (s) => "You completed the full loop this week: identified a gap, set an intention, and deliberately worked on it. That's not common. Most athletes are in motion without being in pursuit of something specific. The compounding effect of doing this consistently over a season — over a career — is enormous." +
        (s.preparation < 3 ? " One thing to build on: your preparation score was lower this week, meaning that learning is happening reactively rather than proactively. You're extracting lessons, but without a clear intention going in you're leaving some development on the table." :
         s.recovery < 3 ? " One layer to add: you're learning across sessions well — that's the macro loop. The micro version of that same skill is recovery: adjusting rep-to-rep within a session. Your recovery score shows room to grow there." : ""),
      action: "Keep raising the quality of the gap you're targeting. As you close one, find the next. The goal is always to be working at the edge of your current capability.",
    },
    mid: {
      read: (s) => "You noticed something this week, but didn't fully pursue it. The noticing is real — that's the hardest part. What's missing is converting observation into deliberate action. There's a gap between 'I know I need to work on this' and 'I specifically practiced this today.'" +
        (s.awareness >= 4 ? " Your awareness is strong this week — you're catching things in real time. The gap is in converting those in-session observations into a deliberate practice target for the next session. Close that loop." :
         s.preparation < 3 ? " It's also harder to learn deliberately when you didn't enter the session with a specific intention. Without a defined target going in, the gap detection becomes reactive rather than systematic." : ""),
      action: "Make it concrete. Not 'work on my first touch' but 'receive with my body already turned.' Specificity is what turns noticing into learning.",
    },
    low: {
      read: (s) => "This week you went through training without identifying a specific gap to close. You put in work, but it wasn't directed at anything in particular. That's maintenance at best — and regression at worst if bad patterns are getting reps. Growth requires a target." +
        (s.preparation >= 4 ? " Your preparation score was stronger — you entered sessions with intention, which is the right start. But the learning loop didn't close: effort was directed, but lessons weren't extracted. The full loop is preparation → execution → reflection." :
         s.awareness < 3 ? " With awareness also lower this week, the detection system that would normally flag what needs to change isn't running. Awareness is the input for learning — without it, there's nothing to act on." : ""),
      action: "After your next session, spend 90 seconds on this: what is one thing I did today that I want to do differently next time? Write it. Say it out loud. That question, answered honestly, is the beginning of real development.",
    },
  },
  quality: {
    label: "Quality",
    what: "Whether you prioritized executing well over simply completing the work.",
    high: {
      read: (s) => "You chose quality over completion this week. That's a harder standard to hold than most people realize — especially when you're tired, behind, or when no one's watching. The athletes who consistently choose quality over quantity are the ones whose reps actually transfer. Every rep you took with real intention this week is a rep that counts." +
        (s.recovery < 3 ? " One place to extend that quality mindset: how you respond to mistakes. Your recovery score shows that after a poor rep, you're not always making a specific adjustment before the next one. The same standard that drives your quality in good reps should drive your response to bad ones." :
         s.presence >= 4 ? " Your presence was also strong this week — these two are directly connected. When you're mentally engaged, holding a quality standard is significantly easier. You set yourself up well." : ""),
      action: "Raise the standard again. If quality this week was 8/10, what would 9/10 look like? The goal isn't perfection — it's always working at the edge of your current best.",
    },
    mid: {
      read: (s) => "Some sessions this week you locked in on quality. Others you defaulted to completion — finishing the drill, hitting the number, checking the box. That split is where development diverges. The sessions where you chose quality are the ones that contributed to your growth. The others were mostly maintenance." +
        (s.presence < 3 ? " The drop in presence likely explains some of that split. In the sessions where you were mentally present, quality was probably higher. Presence is the foundation quality is built on — they move together." :
         s.preparation >= 4 ? " You're entering sessions with clear intentions — now make quality part of the intention itself. Not just 'work on my positioning' but 'execute my positioning at the highest standard I can, every rep.'" : ""),
      action: "When you feel yourself defaulting to completion, do fewer reps — not more. One well-executed rep is worth ten automatic ones.",
    },
    low: {
      read: (s) => "This week effort and intentionality weren't aligned. You put in work, but the focus was on getting through it rather than getting something from it. Volume without quality doesn't build skill — it builds automation of whatever you're already doing, good or bad. Hard work in the wrong direction is still the wrong direction." +
        (s.presence < 3 ? " Your presence score reflects this — it's nearly impossible to maintain a quality standard when you're not mentally in the session. Getting your presence back is the prerequisite for getting your quality back." :
         s.preparation >= 4 ? " You're entering sessions with clear intentions, which is the right foundation. But quality broke down in execution — meaning the gap is between knowing what to do and holding the standard when it gets difficult." : ""),
      action: "Choose one drill in your next session and do it at half the normal volume with full attention on every single rep. That session will teach you more than doubling your reps at half the intention.",
    },
  },
  recovery: {
    label: "Recovery",
    what: "How quickly and specifically you adjusted after a poor rep or play.",
    high: {
      read: (s) => "After mistakes this week, you made specific adjustments before your next attempt. That's elite-level processing — most athletes either repeat the mistake or overcorrect emotionally. You're closing the feedback loop quickly and moving forward with information instead of frustration. Over a season, that compounds into a measurably faster development rate." +
        (s.awareness >= 4 ? " Your awareness is also strong this week — these two are working together in a way that's genuinely rare. You're catching problems in real time and adjusting immediately. That combination is where real acceleration happens." :
         s.learning >= 4 ? " Combined with your strong learning score, you're closing the loop at both the rep level and the session level. That's the full picture of an athlete who is actually developing." : ""),
      action: "Track what your adjustments actually are. You'll start to notice patterns in your mistakes — and patterns in what fixes them. That data is yours. Use it.",
    },
    mid: {
      read: (s) => "You recovered from mistakes sometimes — but your adjustments weren't always specific enough. You reset emotionally, which is good, but you didn't always identify what exactly to change on the next attempt. The result: you moved on, but didn't fully learn from the rep." +
        (s.awareness < 3 ? " Your awareness score is connected here — without consistently catching what went wrong in the moment, it's hard to make a specific adjustment on the next rep. Awareness and recovery are sequential: one enables the other." :
         s.presence < 3 ? " Presence plays a role here too — in the moments you were mentally absent, recovery becomes nearly impossible because you weren't tracking what went wrong in the first place." : ""),
      action: "Before your next rep after any mistake, name one specific thing you're changing. Say it in your head. Make the adjustment visible to yourself before you execute.",
    },
    low: {
      read: (s) => "After mistakes this week, the pattern was repetition rather than adjustment. That's not a mental weakness — it's a missing habit. Without a deliberate recovery routine, bad reps just accumulate and get practiced. You can't out-effort a loop that keeps repeating itself." +
        (s.awareness >= 4 ? " Here's something important: your awareness score is strong — you're noticing when things aren't working. The gap is in what happens next. You have the detection; now build the response. Those two together are the full feedback loop." :
         s.presence < 3 ? " With presence also low this week, recovery becomes even harder — you can't adjust deliberately in a session you've mentally left. Getting present is the prerequisite for everything else." : ""),
      action: "Build a 3-second rule: after any poor rep, take 3 full seconds before the next one. In those 3 seconds, name one thing you're changing. That pause is where the rep becomes information instead of just a mistake.",
    },
  },
};

function getAdjustedScore(q, answers, idx) {
  const raw = answers[idx] ?? 0;
  return q.type === "struggle" && !q.reversed ? 6 - raw : raw;
}

// ── SCREEN: Deep Profile ───────────────────────────────────────────────────
function DeepProfileScreen({ score, answers, onBack }) {
  const band = getScoreBand(score);
  const nonPeerQs = QUESTIONS.filter(q => q.type !== "peer");

  const allScores = Object.fromEntries(
    nonPeerQs.map((q, i) => [q.dimension, getAdjustedScore(q, answers, i)])
  );

  return (
    <div style={{ ...styles.screen, gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12 }}>
        <button onClick={onBack} style={{ background: "none", border: "none", color: COLORS.muted, fontSize: 13, cursor: "pointer", padding: 0, fontFamily: "'DM Mono', monospace", letterSpacing: 1, flexShrink: 0 }}>← BACK</button>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 22, fontWeight: 800, color: COLORS.white, letterSpacing: 1, lineHeight: 1 }}>IN-DEPTH PROFILE</div>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: COLORS.muted, letterSpacing: 2, marginTop: 2 }}>{getWeekLabel()}</div>
        </div>
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 28, color: band.color, fontWeight: 800 }}>{score}<span style={{ fontSize: 13, color: COLORS.muted, fontWeight: 400 }}>/30</span></div>
      </div>

      <div style={{ fontSize: 11, color: COLORS.muted, lineHeight: 1.6, background: COLORS.dim, borderRadius: 10, padding: "10px 14px", borderLeft: `3px solid ${COLORS.sky}` }}>
        Your six intentionality dimensions, broken down individually. Each reflects a different aspect of how you showed up this week.
      </div>

      {nonPeerQs.map((q, i) => {
        const adjusted = getAdjustedScore(q, answers, i);
        const tier = adjusted >= 4 ? "high" : adjusted >= 3 ? "mid" : "low";
        const detail = DIMENSION_DETAIL[q.dimension];
        if (!detail) return null;
        const content = detail[tier];
        const color = adjusted >= 4 ? COLORS.sky : adjusted >= 3 ? "#F5A623" : COLORS.red;
        const tierLabel = adjusted >= 4 ? "STRONG" : adjusted >= 3 ? "DEVELOPING" : "NEEDS FOCUS";

        return (
          <div key={q.id} style={{ background: COLORS.dim, border: `1px solid ${color}33`, borderRadius: 16, padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 18, fontWeight: 800, color: COLORS.white, letterSpacing: 1 }}>{detail.label.toUpperCase()}</div>
                <div style={{ fontSize: 10, color: COLORS.muted, marginTop: 2, lineHeight: 1.4 }}>{detail.what}</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, flexShrink: 0, marginLeft: 12 }}>
                <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 28, color, fontWeight: 800, lineHeight: 1 }}>{adjusted}<span style={{ fontSize: 12, color: COLORS.muted, fontWeight: 400 }}>/5</span></div>
                <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 7, color, letterSpacing: 2 }}>{tierLabel}</div>
              </div>
            </div>

            <div style={{ height: 4, background: COLORS.navyDark, borderRadius: 2 }}>
              <div style={{ height: "100%", width: `${(adjusted / 5) * 100}%`, background: color, borderRadius: 2, transition: "width 0.8s ease" }} />
            </div>

            <div style={{ fontSize: 12, color: COLORS.white, lineHeight: 1.75, fontWeight: 300 }}>{typeof content.read === "function" ? content.read(allScores) : content.read}</div>

            <div style={{ borderTop: `1px solid ${COLORS.border}`, paddingTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color, letterSpacing: 2 }}>THIS WEEK'S ACTION</div>
              <div style={{ fontSize: 12, color: "#AAC0D0", lineHeight: 1.65, borderLeft: `2px solid ${color}`, paddingLeft: 10 }}>{content.action}</div>
            </div>
          </div>
        );
      })}

      <div style={{ fontSize: 10, color: "#4A6580", textAlign: "center", lineHeight: 1.6 }}>
        Insights are AI-generated based on your responses and may not reflect complete accuracy. Use as a starting point for reflection.
      </div>

      <Btn onClick={onBack} variant="secondary">← Back to My Score</Btn>
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
  const [feedback, setFeedback] = useState([]);
  const [resetting, setResetting] = useState(false);
  const [resetDone, setResetDone] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const currentWeekKey = getWeekKey();
  const [selectedWeekKey, setSelectedWeekKey] = useState(currentWeekKey);
  const weekNum = parseInt(selectedWeekKey.split("W")[1]);
  const isCurrentWeek = selectedWeekKey === currentWeekKey;

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
    setData(null);
    async function load() {
      const weekSubs = await getWeekSubmissions(selectedWeekKey);
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

      const bands = {
        high: scores.filter(s => s >= 24).length,
        emerging: scores.filter(s => s >= 18 && s < 24).length,
        inconsistent: scores.filter(s => s >= 12 && s < 18).length,
        low: scores.filter(s => s < 12).length,
      };
      setData({ count, avgScore, avgPerQ, completionPct: Math.round((count / MAX_ROSTER) * 100), avgTeamEnergy, bands });
      setAllWeeks(weeks);
      const fb = await getWeekFeedback(selectedWeekKey);
      setFeedback(fb);
    }
    load();
  }, [selectedWeekKey]);

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
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: COLORS.sky, letterSpacing: 3 }}>WEEK {weekNum}{isCurrentWeek ? " — CURRENT" : " — HISTORICAL"}</div>
              {!isCurrentWeek && (
                <button onClick={() => setSelectedWeekKey(currentWeekKey)} style={{ background: "none", border: `1px solid ${COLORS.sky}44`, borderRadius: 6, padding: "4px 10px", color: COLORS.sky, fontSize: 9, cursor: "pointer", fontFamily: "'DM Mono', monospace", letterSpacing: 1 }}>← CURRENT WEEK</button>
              )}
            </div>
            {/* Roster completion progress */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
                <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 32, color: COLORS.white, fontWeight: 700, lineHeight: 1 }}>
                  {data.count}<span style={{ fontSize: 16, color: COLORS.muted, fontWeight: 400 }}>/{MAX_ROSTER}</span>
                  <span style={{ fontSize: 14, color: COLORS.muted, fontWeight: 400, marginLeft: 8 }}>submitted</span>
                </div>
                <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 28, color: data.completionPct >= 80 ? COLORS.sky : data.completionPct >= 50 ? "#F5A623" : COLORS.muted, fontWeight: 700 }}>{data.completionPct}%</div>
              </div>
              <div style={{ height: 8, background: COLORS.navyDark, borderRadius: 4 }}>
                <div style={{ height: "100%", width: `${data.completionPct}%`, background: data.completionPct >= 80 ? COLORS.sky : data.completionPct >= 50 ? "#F5A623" : COLORS.muted, borderRadius: 4, transition: "width 0.8s" }} />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
              {[["Team Avg", `${data.avgScore}/30`], ["Avg Band", getScoreBand(data.avgScore).label.split(" ")[0]]].map(([label, val]) => (
                <div key={label} style={{ textAlign: "center", background: COLORS.navyDark, borderRadius: 10, padding: "12px 8px" }}>
                  <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 22, color: COLORS.sky, fontWeight: 700 }}>{val}</div>
                  <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 8, color: COLORS.muted, letterSpacing: 1 }}>{label}</div>
                </div>
              ))}
            </div>
            {data.bands && data.count > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: COLORS.muted, letterSpacing: 2, marginBottom: 8 }}>SCORE DISTRIBUTION</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
                  {[
                    { label: "HIGH", count: data.bands.high, color: COLORS.sky },
                    { label: "EMRG", count: data.bands.emerging, color: COLORS.sky + "88" },
                    { label: "INCON", count: data.bands.inconsistent, color: "#F5A623" },
                    { label: "LOW", count: data.bands.low, color: COLORS.red },
                  ].map(({ label, count, color }) => (
                    <div key={label} style={{ textAlign: "center", background: COLORS.navyDark, borderRadius: 8, padding: "10px 4px" }}>
                      <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 26, color, fontWeight: 700, lineHeight: 1 }}>{count}</div>
                      <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 7, color: COLORS.muted, letterSpacing: 1, marginTop: 3 }}>{label}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
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
            {(() => {
              const ts = getTeamSummary(data.avgScore, data.avgPerQ);
              return (
                <div style={{ borderTop: `1px solid ${COLORS.border}`, paddingTop: 14, marginTop: 8 }}>
                  <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: ts.color, letterSpacing: 2, marginBottom: 8 }}>THIS WEEK'S TEAM READ</div>
                  <div style={{ fontSize: 12, color: COLORS.white, lineHeight: 1.7, fontWeight: 300 }}>{ts.text}</div>
                </div>
              );
            })()}
          </div>

          {feedback.length > 0 && (() => {
            const retentionScores = feedback.map(f => f.coaching_retention).filter(Boolean);
            const avgRetention = retentionScores.length
              ? (retentionScores.reduce((a, b) => a + b, 0) / retentionScores.length).toFixed(1)
              : null;
            const concerns = feedback.map(f => f.other_concerns).filter(Boolean);
            return (
              <div style={{ background: COLORS.dim, border: `1px solid ${COLORS.sky}33`, borderRadius: 16, padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: COLORS.sky, letterSpacing: 3 }}>COACHING FEEDBACK — WEEK {weekNum}</div>

                {avgRetention && (
                  <div>
                    <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: COLORS.muted, letterSpacing: 2, marginBottom: 10 }}>
                      INFO RETENTION · {retentionScores.length} of {feedback.length} responded
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <div style={{ flex: 1, height: 6, background: COLORS.navyDark, borderRadius: 3 }}>
                        <div style={{ height: "100%", width: `${(parseFloat(avgRetention) / 5) * 100}%`, background: parseFloat(avgRetention) >= 4 ? COLORS.sky : parseFloat(avgRetention) >= 3 ? "#F5A623" : COLORS.red, borderRadius: 3, transition: "width 0.8s" }} />
                      </div>
                      <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 24, color: COLORS.sky, fontWeight: 700, width: 40, textAlign: "right" }}>
                        {avgRetention}<span style={{ fontSize: 11, color: COLORS.muted }}>/5</span>
                      </div>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
                      {[1,2,3,4,5].map(v => {
                        const c = retentionScores.filter(s => s === v).length;
                        return (
                          <div key={v} style={{ textAlign: "center", flex: 1 }}>
                            <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 16, color: c > 0 ? COLORS.white : COLORS.border, fontWeight: 700 }}>{c}</div>
                            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 7, color: COLORS.muted }}>{v}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {concerns.length > 0 && (
                  <div style={{ borderTop: avgRetention ? `1px solid ${COLORS.border}` : "none", paddingTop: avgRetention ? 14 : 0, display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: COLORS.muted, letterSpacing: 2 }}>CONCERNS & NOTES ({concerns.length})</div>
                    {concerns.map((c, i) => (
                      <div key={i} style={{ fontSize: 12, color: COLORS.white, lineHeight: 1.65, background: COLORS.navyDark, borderRadius: 8, padding: "10px 12px", borderLeft: `3px solid ${COLORS.sky}44` }}>
                        {c}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

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
              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: COLORS.sky, letterSpacing: 3, marginBottom: 4 }}>ALL WEEKS</div>
              <div style={{ fontSize: 10, color: COLORS.muted, marginBottom: 12 }}>Tap a week to view its full breakdown.</div>
              {allWeeks.map(w => {
                const isSelected = w.week === selectedWeekKey;
                return (
                  <button key={w.week} onClick={() => { setSelectedWeekKey(w.week); window.scrollTo(0, 0); }} style={{ width: "100%", background: isSelected ? COLORS.sky + "18" : "none", border: "none", borderBottom: `1px solid ${COLORS.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", cursor: "pointer" }}>
                    <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: isSelected ? COLORS.sky : COLORS.muted }}>WEEK {w.weekNum}{isSelected ? " ←" : ""}</div>
                    <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: COLORS.muted }}>{w.count} submitted</div>
                    <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 16, color: isSelected ? COLORS.sky : COLORS.white, fontWeight: 700 }}>{w.avg}/30</div>
                  </button>
                );
              })}
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
  const [prefillNum, setPrefillNum] = useState("");

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
    const prevScore = history.length > 0
      ? [...history].sort((a, b) => b.weekNum - a.weekNum)[0].score
      : null;
    const hist = await getPlayerHistory(playerNum);
    setHistory(hist);
    setResultData({ score, answers, prevScore });
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
          {view === "returning" && <ReturningEntry onEnter={handleNumberEntered} onNewNumber={() => { setPrefillNum(""); setView("entry"); }} initialNum={prefillNum} />}
          {view === "entry" && <NumberEntry onEnter={handleNumberEntered} onSwitchToLogin={(n) => { setPrefillNum(n); setView("returning"); }} />}
          {view === "profile" && <ProfileScreen playerNum={playerNum} history={history} weekKey={weekKey} onTakeAssessment={() => { if (!alreadySubmitted) setView("assessment"); }} />}
          {view === "assessment" && <AssessmentScreen playerNum={playerNum} weekKey={weekKey} onComplete={handleAssessmentComplete} />}
          {view === "result" && resultData && <ScoreRevealScreen score={resultData.score} answers={resultData.answers} prevScore={resultData.prevScore} onViewProfile={() => setView("profile")} onDeepProfile={() => setView("deep-profile")} />}
          {view === "deep-profile" && resultData && <DeepProfileScreen score={resultData.score} answers={resultData.answers} onBack={() => setView("result")} />}
          {view === "admin-login" && <AdminLogin onLogin={() => setView("admin")} />}
          {view === "admin" && <AdminDashboard onBack={() => setView(playerNum ? "profile" : "returning")} />}
        </div>
      </div>
    </div>
  );
}
