import React, { useState, useEffect, useRef, useCallback } from "react";

/* ------------------------------------------------------------------ *
 *  ROT ROYALE — skill-contest prototype (light & friendly build)
 *  - default mood: bright, playful, "just fun"
 *  - buyable visual MODES (coin sink, closed loop, no cash)
 *  - category splash flashes before each question
 *  - engagement via SKILL + HABIT (daily streak, ladder, practice)
 *  - opponents are SIMULATED bots (no backend yet)
 * ------------------------------------------------------------------ */

/* ---- THEMES: to add one, drop in an object. That's the whole job. ----
 *  id        unique key
 *  name      shown in the store
 *  cost      coins to unlock (0 = free / default)
 *  style     art style → "soft" | "pixel" | "mono"  (changes fonts/shapes/texture)
 *  blurb     one-line vibe shown in the store
 *  vars      colors. 8 slots, fixed roles:
 *            --lime  primary / CTA / "correct"     --amber reward / coins / highlights
 *            --pink  energy / urgency / "wrong"    --cyan  secondary info / score
 *            --bg --panel --panel2 --line --text --muted --btnText
 * ------------------------------------------------------------------------ */
const THEMES = [
  { id: "daylight", name: "Vault", cost: 0, style: "soft", blurb: "Calm money-green & gold", vars: {
    "--bg": "radial-gradient(900px 480px at 82% -12%, rgba(245,165,36,.20), transparent 60%), radial-gradient(760px 560px at -12% 112%, rgba(21,168,95,.18), transparent 58%), #f6f6f1",
    "--panel": "#ffffff", "--panel2": "#eef3ea", "--line": "#e2e6da",
    "--lime": "#15a85f", "--pink": "#ff5a4d", "--cyan": "#8b5cf6", "--amber": "#f5a524",
    "--text": "#1c2a20", "--muted": "#7a857a", "--btnText": "#ffffff" } },
  { id: "retro", name: "Retro Arcade", cost: 150, style: "pixel", blurb: "70s warmth + pixel art & scanlines", vars: {
    "--bg": "radial-gradient(820px 460px at 84% -12%, rgba(232,96,28,.28), transparent 60%), radial-gradient(760px 560px at -10% 112%, rgba(214,64,44,.22), transparent 58%), #fdf3e0",
    "--panel": "#fff8ea", "--panel2": "#fbedce", "--line": "#e7d4ad",
    "--lime": "#e8601c", "--pink": "#d6402c", "--cyan": "#7d9b2f", "--amber": "#f2b705",
    "--text": "#3a2a14", "--muted": "#9a7e54", "--btnText": "#fff8ea" } },
  { id: "mono", name: "Ink", cost: 180, style: "mono", blurb: "Near-black, one electric accent", vars: {
    "--bg": "radial-gradient(900px 520px at 84% -12%, rgba(216,255,62,.10), transparent 60%), #101012",
    "--panel": "#1a1a1e", "--panel2": "#202026", "--line": "#2e2e36",
    "--lime": "#d8ff3e", "--pink": "#ff5a4d", "--cyan": "#b9b9c4", "--amber": "#f5c542",
    "--text": "#f4f4f0", "--muted": "#8c8c96", "--btnText": "#101012" } },
  { id: "bubblegum", name: "Bubblegum", cost: 120, style: "soft", blurb: "Candy pink & violet, extra bouncy", vars: {
    "--bg": "radial-gradient(820px 460px at 84% -12%, rgba(255,120,190,.36), transparent 60%), radial-gradient(760px 560px at -10% 112%, rgba(150,120,255,.30), transparent 58%), #fff0f8",
    "--panel": "#ffffff", "--panel2": "#ffe9f5", "--line": "#f6d9ec",
    "--lime": "#ff5fa2", "--pink": "#a06bff", "--cyan": "#ff9ad1", "--amber": "#ffc94d",
    "--text": "#4a2a44", "--muted": "#bf93b3", "--btnText": "#ffffff" } },
  { id: "forest", name: "Evergreen", cost: 120, style: "soft", blurb: "Mossy greens & amber, easy on the eyes", vars: {
    "--bg": "radial-gradient(820px 460px at 84% -12%, rgba(70,200,150,.30), transparent 60%), radial-gradient(760px 560px at -10% 112%, rgba(245,180,60,.22), transparent 58%), #f3f8f1",
    "--panel": "#ffffff", "--panel2": "#e9f5ec", "--line": "#d6ebda",
    "--lime": "#27c08a", "--pink": "#ff7a59", "--cyan": "#9a7b4f", "--amber": "#f5b53d",
    "--text": "#1f3a2e", "--muted": "#7e9587", "--btnText": "#ffffff" } },
  { id: "midnight", name: "Midnight Arcade", cost: 150, style: "soft", blurb: "Neon glow on black (the old look)", vars: {
    "--bg": "radial-gradient(900px 500px at 80% -10%, rgba(255,46,136,.20), transparent 60%), radial-gradient(800px 600px at -10% 110%, rgba(255,176,46,.16), transparent 55%), #08070f",
    "--panel": "#14121f", "--panel2": "#1d1a2c", "--line": "#2a2740",
    "--lime": "#c7f73a", "--pink": "#ff2e88", "--cyan": "#a06bff", "--amber": "#ffb02e",
    "--text": "#f5f2ff", "--muted": "#8e89ad", "--btnText": "#08070f" } },
];

const STYLE = `
@import url('https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&family=Nunito:wght@400;600;800&family=Archivo:wght@700;800;900&family=Press+Start+2P&family=VT323&display=swap');
.rr-root *{box-sizing:border-box;margin:0;padding:0}
.rr-root{
  --bg:radial-gradient(900px 480px at 82% -12%, rgba(245,165,36,.20), transparent 60%), radial-gradient(760px 560px at -12% 112%, rgba(21,168,95,.18), transparent 58%), #f6f6f1;
  --panel:#fff; --panel2:#eef3ea; --line:#e2e6da;
  --lime:#15a85f; --pink:#ff5a4d; --cyan:#8b5cf6; --amber:#f5a524;
  --text:#1c2a20; --muted:#7a857a; --btnText:#fff;
  font-family:'Nunito',system-ui,sans-serif; color:var(--text);
  background:var(--bg); min-height:100vh; width:100%; padding:18px; overflow-x:hidden;
  transition:background .35s ease,color .35s ease;
}
.rr-wrap{max-width:520px;margin:0 auto}
.rr-disp{font-family:'Fredoka',sans-serif;font-weight:700;line-height:1.02}
.rr-topbar{display:flex;gap:8px;align-items:center;justify-content:space-between;margin-bottom:16px}
.rr-stat{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:9px 11px;display:flex;flex-direction:column;gap:1px;flex:1;min-width:0;box-shadow:0 4px 14px rgba(0,0,0,.04)}
.rr-stat b{font-family:'Fredoka',sans-serif;font-weight:700;font-size:19px;line-height:1}
.rr-stat span{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.6px;font-weight:800}
.rr-card{background:linear-gradient(180deg,var(--panel2),var(--panel));border:1px solid var(--line);border-radius:24px;padding:22px;margin-bottom:14px;box-shadow:0 10px 30px rgba(0,0,0,.06)}
.rr-hero{position:relative;overflow:hidden}
.rr-hero:before{content:"";position:absolute;inset:0;background:linear-gradient(120deg,transparent 30%,color-mix(in srgb,var(--lime) 16%,transparent) 50%,transparent 70%);transform:translateX(-130%);animation:rr-sheen 5s ease-in-out infinite}
@keyframes rr-sheen{0%,62%{transform:translateX(-130%)}100%{transform:translateX(130%)}}
.rr-eyebrow{font-size:11px;letter-spacing:2px;color:var(--lime);text-transform:uppercase;font-weight:800;margin-bottom:8px}
.rr-h1{font-size:40px;margin-bottom:8px}
.rr-h1 em{font-style:normal;color:var(--pink)}
.rr-sub{color:var(--muted);font-size:14px;margin-bottom:18px;line-height:1.5;font-weight:600}
.rr-btn{width:100%;border:none;cursor:pointer;font-family:'Fredoka',sans-serif;font-weight:600;font-size:20px;padding:15px;border-radius:16px;color:var(--btnText);background:var(--lime);transition:transform .08s ease,box-shadow .2s ease;position:relative;z-index:1}
.rr-btn:hover{box-shadow:0 10px 26px color-mix(in srgb,var(--lime) 42%,transparent)}
.rr-btn:active{transform:translateY(2px)}
.rr-btn.ghost{background:transparent;color:var(--text);border:1.5px solid var(--line);font-size:15px;padding:13px;box-shadow:none}
.rr-btn.pink{background:var(--pink);color:#fff}
.rr-btn.sm{font-size:14px;padding:10px 14px;width:auto;border-radius:12px}
.rr-btn:disabled{opacity:.45;cursor:not-allowed}
.rr-chip{display:inline-flex;align-items:center;gap:6px;background:var(--panel);border:1px solid var(--line);border-radius:999px;padding:6px 11px;font-size:12px;color:var(--muted);font-weight:700}
.rr-chip b{color:var(--text)}
.rr-lb{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-radius:13px;font-size:14px;border:1px solid transparent;font-weight:700}
.rr-lb.me{background:color-mix(in srgb,var(--pink) 13%,transparent);border-color:color-mix(in srgb,var(--pink) 40%,transparent)}
.rr-lb .rk{font-family:'Fredoka',sans-serif;width:26px;color:var(--muted)}
.rr-lb .nm{flex:1;margin-left:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rr-lb .sc{font-family:'Fredoka',sans-serif;color:var(--cyan)}
.rr-kind{font-size:11px;letter-spacing:2px;text-transform:uppercase;color:var(--cyan);font-weight:800}
.rr-q{font-size:25px;font-weight:800;line-height:1.18;margin:10px 0 20px}
.rr-opts{display:grid;gap:11px}
.rr-opt{border:1.5px solid var(--line);background:var(--panel);color:var(--text);border-radius:16px;padding:16px;font-size:17px;font-weight:700;cursor:pointer;text-align:left;transition:transform .07s ease,border-color .15s,background .15s}
.rr-opt:hover{border-color:var(--muted)}
.rr-opt:active{transform:scale(.985)}
.rr-opt.right{border-color:var(--lime);background:color-mix(in srgb,var(--lime) 18%,transparent);animation:rr-pop .35s ease}
.rr-opt.wrong{border-color:var(--pink);background:color-mix(in srgb,var(--pink) 18%,transparent);animation:rr-shake .35s ease}
.rr-opt.dim{opacity:.4}
@keyframes rr-pop{0%{transform:scale(1)}45%{transform:scale(1.04)}100%{transform:scale(1)}}
@keyframes rr-shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-7px)}75%{transform:translateX(7px)}}
@keyframes rr-splash{0%{opacity:0;transform:scale(.6)}55%{opacity:1;transform:scale(1.1)}100%{opacity:1;transform:scale(1)}}
.rr-timer{height:9px;border-radius:6px;background:var(--panel);overflow:hidden;margin-bottom:18px;border:1px solid var(--line)}
.rr-timerfill{height:100%;background:linear-gradient(90deg,var(--lime),var(--amber));transition:width .05s linear}
.rr-timerfill.low{background:linear-gradient(90deg,var(--amber),var(--pink))}
.rr-pts{font-family:'Fredoka',sans-serif;font-weight:700;font-size:15px;color:var(--lime);text-align:center;height:22px;animation:rr-float .8s ease}
@keyframes rr-float{0%{opacity:0;transform:translateY(8px)}20%{opacity:1}100%{opacity:1;transform:translateY(0)}}
.rr-progress{display:flex;gap:5px;margin-bottom:14px}
.rr-progress i{flex:1;height:5px;border-radius:3px;background:var(--line)}
.rr-progress i.done{background:var(--cyan)}
.rr-progress i.cur{background:var(--lime)}
.rr-mem{display:grid;grid-template-columns:repeat(3,1fr);gap:11px;margin:6px 0 18px}
.rr-tile{aspect-ratio:1;border-radius:18px;border:2px solid var(--line);cursor:pointer;transition:transform .08s,filter .12s,box-shadow .12s;opacity:.55}
.rr-tile.lit{opacity:1;transform:scale(1.04)}
.rr-tile:active{transform:scale(.95)}
.rr-place{font-family:'Fredoka',sans-serif;font-weight:700;font-size:74px;line-height:.9;text-align:center}
.rr-place small{font-size:24px;vertical-align:super;color:var(--muted)}
.rr-stagger{opacity:0;animation:rr-up .5s ease forwards}
@keyframes rr-up{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
.rr-divbadge{font-family:'Fredoka',sans-serif;font-weight:700;letter-spacing:.5px;padding:5px 12px;border-radius:999px;font-size:13px}
.rr-note{font-size:12.5px;color:var(--muted);line-height:1.55;border-left:2px solid var(--cyan);padding-left:11px;margin-top:14px;font-weight:600}
.rr-swatches{display:flex;gap:6px;margin:10px 0}
.rr-dot{width:22px;height:22px;border-radius:7px}
.rr-splash{text-align:center;padding:30px 0 24px}
.rr-styletag{display:inline-block;font-size:10px;letter-spacing:1px;text-transform:uppercase;font-weight:800;color:var(--muted);margin-top:2px}

/* === ART STYLE: PIXEL (retro) === */
.rr-root.s-pixel .rr-disp{font-family:'Press Start 2P',monospace;line-height:1.4;letter-spacing:0}
.rr-root.s-pixel .rr-h1{font-size:19px}
.rr-root.s-pixel .rr-place{font-size:46px;line-height:1.1}
.rr-root.s-pixel .rr-stat b{font-size:14px}
.rr-root.s-pixel .rr-card,.rr-root.s-pixel .rr-btn,.rr-root.s-pixel .rr-opt,.rr-root.s-pixel .rr-stat,.rr-root.s-pixel .rr-tile,.rr-root.s-pixel .rr-chip,.rr-root.s-pixel .rr-lb,.rr-root.s-pixel .rr-timer{border-radius:3px}
.rr-root.s-pixel .rr-card{box-shadow:5px 5px 0 rgba(58,42,20,.22);border-width:2px}
.rr-root.s-pixel .rr-btn{box-shadow:4px 4px 0 rgba(58,42,20,.3)}
.rr-root.s-pixel .rr-btn:active{transform:translate(2px,2px);box-shadow:2px 2px 0 rgba(58,42,20,.3)}
.rr-root.s-pixel .rr-opt{border-width:2px}
.rr-root.s-pixel:after{content:"";position:fixed;inset:0;pointer-events:none;z-index:60;background:repeating-linear-gradient(0deg,rgba(0,0,0,.05) 0 1px,transparent 1px 3px)}

/* === ART STYLE: MONO (ink) === */
.rr-root.s-mono .rr-disp{font-family:'Archivo',sans-serif;font-weight:900;letter-spacing:-.5px;text-transform:uppercase}
.rr-root.s-mono .rr-card,.rr-root.s-mono .rr-btn,.rr-root.s-mono .rr-opt,.rr-root.s-mono .rr-stat,.rr-root.s-mono .rr-chip,.rr-root.s-mono .rr-lb,.rr-root.s-mono .rr-tile{border-radius:8px}
.rr-root.s-mono .rr-card{box-shadow:none;border-width:1.5px}
.rr-root.s-mono .rr-btn{box-shadow:none}
.rr-root.s-mono .rr-eyebrow{letter-spacing:3px}
`;

/* ---------------- content ---------------- */
const TRIVIA = [
  { p: "Which planet has the most moons?", o: ["Jupiter", "Saturn", "Neptune", "Mars"], c: 1, cat: "Space", icon: "🪐" },
  { p: "The currency of Japan is the:", o: ["Won", "Yuan", "Yen", "Baht"], c: 2, cat: "Geography", icon: "🌍" },
  { p: "How many bones are in the adult human body?", o: ["186", "206", "242", "198"], c: 1, cat: "The Body", icon: "🦴" },
  { p: "Mount Kilimanjaro is located in:", o: ["Kenya", "Tanzania", "Nepal", "Peru"], c: 1, cat: "Geography", icon: "🌍" },
  { p: "Which element has the symbol 'Fe'?", o: ["Fluorine", "Iron", "Lead", "Tin"], c: 1, cat: "Science", icon: "🔬" },
  { p: "A group of crows is called a:", o: ["Pack", "Murder", "Flock", "School"], c: 1, cat: "Nature", icon: "🦉" },
  { p: "The Great Barrier Reef is off the coast of:", o: ["Brazil", "Australia", "Mexico", "Fiji"], c: 1, cat: "Geography", icon: "🌍" },
  { p: "Which is NOT a primary color of light?", o: ["Red", "Green", "Blue", "Yellow"], c: 3, cat: "Science", icon: "🔬" },
  { p: "The fastest land animal is the:", o: ["Lion", "Pronghorn", "Cheetah", "Greyhound"], c: 2, cat: "Nature", icon: "🦉" },
  { p: "How many sides does a heptagon have?", o: ["6", "7", "8", "9"], c: 1, cat: "Numbers", icon: "🔢" },
  { p: "Which ocean is the deepest?", o: ["Atlantic", "Indian", "Pacific", "Arctic"], c: 2, cat: "Geography", icon: "🌍" },
  { p: "DNA stands for deoxyribonucleic ___:", o: ["Acid", "Atom", "Agent", "Amino"], c: 0, cat: "Science", icon: "🔬" },
  { p: "The Eiffel Tower was completed in:", o: ["1879", "1889", "1901", "1925"], c: 1, cat: "History", icon: "🏛️" },
  { p: "Which gas do plants absorb from the air?", o: ["Oxygen", "Nitrogen", "Carbon dioxide", "Helium"], c: 2, cat: "Nature", icon: "🌿" },
];
const ODD = [
  { p: "Tap the odd one out", o: ["Apple", "Banana", "Carrot", "Mango"], c: 2 },
  { p: "Tap the odd one out", o: ["Square", "Circle", "Triangle", "Cube"], c: 3 },
  { p: "Tap the odd one out", o: ["Mercury", "Venus", "Moon", "Mars"], c: 2 },
  { p: "Tap the odd one out", o: ["Violin", "Cello", "Flute", "Viola"], c: 2 },
  { p: "Which number doesn't belong?", o: ["9", "16", "25", "30"], c: 3 },
  { p: "Tap the odd one out", o: ["Copper", "Granite", "Gold", "Silver"], c: 1 },
];
const NAMES = ["zerocool", "qwk_draw", "nova_kid", "blitz", "m1nd", "tapgod", "ari", "lobby_rat",
  "snapfast", "owl", "dex", "v1per", "kaze", "pixl", "h0tstreak", "mara", "jolt", "echo"];
const PALETTE = ["#ff5d8f", "#aad633", "#ffae2b", "#27c08a", "#a06bff", "#ff7a4d"];

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const shuffle = (a) => { const x = [...a]; for (let i = x.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0;[x[i], x[j]] = [x[j], x[i]]; } return x; };

function makeMath() {
  const ops = [["+", (a, b) => a + b], ["−", (a, b) => a - b], ["×", (a, b) => a * b]];
  const [sym, fn] = pick(ops);
  let a = 2 + ((Math.random() * 11) | 0), b = 2 + ((Math.random() * 11) | 0);
  if (sym === "−" && b > a) [a, b] = [b, a];
  if (sym === "×") { a = 2 + ((Math.random() * 8) | 0); b = 2 + ((Math.random() * 8) | 0); }
  const ans = fn(a, b);
  const set = new Set([ans]);
  while (set.size < 4) set.add(ans + (((Math.random() * 9) | 0) - 4) + (Math.random() < .5 ? 1 : -1));
  const opts = shuffle([...set]).map(String);
  return { kind: "mc", cat: "Rapid Math", icon: "➗", p: `${a} ${sym} ${b} = ?`, o: opts, c: opts.indexOf(String(ans)), t: 8, type: "mc" };
}
function makeTrivia() { const q = pick(TRIVIA); return { type: "mc", cat: q.cat, icon: q.icon, p: q.p, o: q.o, c: q.c, t: 9 }; }
function makeOdd() { const q = pick(ODD); return { type: "mc", cat: "Odd One Out", icon: "🔀", p: q.p, o: q.o, c: q.c, t: 8 }; }
function makeMemory() { return { type: "memory", cat: "Memory Flash", icon: "🧩", seq: Array.from({ length: 4 }, () => (Math.random() * 6) | 0), t: 7 }; }
function buildContest() { return shuffle([makeTrivia(), makeMath(), makeOdd(), makeMemory(), makeTrivia(), makeMath(), makeTrivia()]); }

const divOf = (r) => r < 1000 ? ["Bronze", "#cd7f32"] : r < 1200 ? ["Silver", "#9aa3b0"] :
  r < 1450 ? ["Gold", "#e0a52b"] : r < 1750 ? ["Platinum", "#8b5cf6"] :
    r < 2050 ? ["Diamond", "#a06bff"] : ["Apex", "#ff5d8f"];

/* ---------------- splash + rounds ---------------- */
function IntroSplash({ cat, icon }) {
  return (
    <div className="rr-splash">
      <div style={{ fontSize: 58, animation: "rr-splash .55s ease" }}>{icon}</div>
      <div className="rr-eyebrow" style={{ color: "var(--cyan)", marginTop: 6 }}>Category</div>
      <div className="rr-disp" style={{ fontSize: 34, color: "var(--text)" }}>{cat}</div>
    </div>
  );
}

function MCRound({ q, onDone }) {
  const total = q.t * 1000;
  const [left, setLeft] = useState(total);
  const [sel, setSel] = useState(null);
  const done = useRef(false);
  const finish = useCallback((correct, frac) => {
    if (done.current) return; done.current = true;
    setTimeout(() => onDone(correct, frac), 850);
  }, [onDone]);
  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => {
      const l = total - (Date.now() - start);
      if (l <= 0) { clearInterval(id); setLeft(0); if (!done.current) { setSel(-1); finish(false, 0); } }
      else setLeft(l);
    }, 50);
    return () => clearInterval(id);
  }, [total, finish]);
  const answer = (i) => { if (done.current) return; setSel(i); finish(i === q.c, Math.max(0, left / total)); };
  const pct = (left / total) * 100;
  return (
    <div>
      <div className="rr-timer"><div className={"rr-timerfill" + (pct < 35 ? " low" : "")} style={{ width: pct + "%" }} /></div>
      <div className="rr-kind">{q.cat}</div>
      <div className="rr-q">{q.p}</div>
      <div className="rr-opts">
        {q.o.map((o, i) => {
          let cls = "rr-opt";
          if (sel !== null) { if (i === q.c) cls += " right"; else if (i === sel) cls += " wrong"; else cls += " dim"; }
          return <button key={i} className={cls} onClick={() => answer(i)}>{o}</button>;
        })}
      </div>
    </div>
  );
}

function MemoryRound({ q, onDone }) {
  const [phase, setPhase] = useState("show");
  const [lit, setLit] = useState(-1);
  const [input, setInput] = useState([]);
  const [left, setLeft] = useState(q.t * 1000);
  const done = useRef(false);
  const timers = useRef([]);
  const finish = useCallback((correct, frac) => {
    if (done.current) return; done.current = true; setPhase("reveal");
    setTimeout(() => onDone(correct, frac), 800);
  }, [onDone]);
  useEffect(() => {
    let t = 350;
    q.seq.forEach((tile) => {
      timers.current.push(setTimeout(() => setLit(tile), t));
      timers.current.push(setTimeout(() => setLit(-1), t + 460));
      t += 620;
    });
    timers.current.push(setTimeout(() => setPhase("input"), t + 100));
    const tm = timers.current;
    return () => tm.forEach(clearTimeout);
  }, [q.seq]);
  useEffect(() => {
    if (phase !== "input") return;
    const total = q.t * 1000, start = Date.now();
    const id = setInterval(() => {
      const l = total - (Date.now() - start);
      if (l <= 0) { clearInterval(id); finish(false, 0); } else setLeft(l);
    }, 50);
    return () => clearInterval(id);
  }, [phase, q.t, finish]);
  const tap = (i) => {
    if (phase !== "input" || done.current) return;
    const next = [...input, i]; setInput(next);
    setLit(i); setTimeout(() => setLit(-1), 160);
    const idx = next.length - 1;
    if (next[idx] !== q.seq[idx]) { finish(false, 0); return; }
    if (next.length === q.seq.length) finish(true, Math.max(0, left / (q.t * 1000)));
  };
  const pct = (left / (q.t * 1000)) * 100;
  return (
    <div>
      {phase === "input"
        ? <div className="rr-timer"><div className={"rr-timerfill" + (pct < 35 ? " low" : "")} style={{ width: pct + "%" }} /></div>
        : <div style={{ height: 9, marginBottom: 18 }} />}
      <div className="rr-kind">Memory Flash</div>
      <div className="rr-q">{phase === "show" ? "Watch the pattern…" : phase === "input" ? "Now repeat it" : "Nice"}</div>
      <div className="rr-mem">
        {PALETTE.map((col, i) => (
          <div key={i} className={"rr-tile" + (lit === i ? " lit" : "")}
            style={{ background: lit === i ? col : "var(--panel)", borderColor: col, boxShadow: lit === i ? `0 0 24px ${col}` : "none" }}
            onClick={() => tap(i)} />
        ))}
      </div>
      <div className="rr-pts" style={{ color: "var(--muted)" }}>{input.length}/{q.seq.length}</div>
    </div>
  );
}

/* wrapper: category splash, then the round */
function Round({ q, onDone }) {
  const [show, setShow] = useState(false);
  useEffect(() => { const t = setTimeout(() => setShow(true), 1050); return () => clearTimeout(t); }, []);
  if (!show) return <IntroSplash cat={q.cat} icon={q.icon} />;
  return q.type === "memory" ? <MemoryRound q={q} onDone={onDone} /> : <MCRound q={q} onDone={onDone} />;
}

/* ---------------- contest ---------------- */
function Contest({ onComplete }) {
  const [qs] = useState(buildContest);
  const [i, setI] = useState(0);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [flash, setFlash] = useState("");
  const [bots] = useState(() =>
    Array.from({ length: 11 }, () => {
      const skill = 0.42 + Math.random() * 0.5; let s = 0, bs = 0;
      for (let r = 0; r < 7; r++) {
        if (Math.random() < skill) { const mult = 1 + Math.min(bs, 5) * 0.12; s += Math.round((110 + Math.random() * 55) * mult); bs++; }
        else bs = 0;
      }
      return { name: pick(NAMES) + (Math.random() < .3 ? (10 + (Math.random() * 89 | 0)) : ""), score: s };
    })
  );
  const handleDone = (correct, frac) => {
    let gained = 0, ns = streak;
    if (correct) {
      ns = streak + 1; const mult = 1 + Math.min(ns, 5) * 0.12;
      gained = Math.round((100 + frac * 60) * mult);
      setFlash(`+${gained}` + (ns > 1 ? `  🔥x${ns}` : ""));
    } else { ns = 0; setFlash("missed"); }
    setStreak(ns); setScore((s) => s + gained);
    setTimeout(() => {
      setFlash("");
      if (i + 1 >= qs.length) {
        const finalScore = score + gained;
        const field = [...bots, { name: "you", me: true, score: finalScore }].sort((a, b) => b.score - a.score);
        onComplete(finalScore, field);
      } else setI(i + 1);
    }, 250);
  };
  const q = qs[i];
  return (
    <div className="rr-card">
      <div className="rr-progress">{qs.map((_, k) => <i key={k} className={k < i ? "done" : k === i ? "cur" : ""} />)}</div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <span className="rr-chip">Score <b style={{ marginLeft: 4 }}>{score}</b></span>
        <span className="rr-chip">Field <b style={{ marginLeft: 4 }}>12</b></span>
      </div>
      <Round key={i} q={q} onDone={handleDone} />
      <div className="rr-pts">{flash}</div>
    </div>
  );
}

/* ---------------- practice ---------------- */
function Practice({ onExit }) {
  const [qs] = useState(() => shuffle([makeTrivia(), makeMath(), makeOdd(), makeMemory(), makeMath()]));
  const [i, setI] = useState(0);
  const [hits, setHits] = useState(0);
  const [done, setDone] = useState(false);
  const handle = (correct) => {
    if (correct) setHits((h) => h + 1);
    setTimeout(() => { if (i + 1 >= qs.length) setDone(true); else setI(i + 1); }, 250);
  };
  if (done) {
    const acc = Math.round((hits / qs.length) * 100);
    const gain = Math.max(1, Math.round(acc / 14));
    return (
      <div className="rr-card">
        <div className="rr-eyebrow" style={{ color: "var(--cyan)" }}>Warm-up complete</div>
        <div className="rr-disp" style={{ fontSize: 34 }}>+{gain} <span style={{ color: "var(--cyan)" }}>Sharpness</span></div>
        <div className="rr-sub" style={{ marginTop: 8 }}>Accuracy {acc}% · {hits}/{qs.length} correct</div>
        <div className="rr-note">The reps make you faster and more accurate, so you climb because you got <b style={{ color: "var(--text)" }}>better</b> — not because you left the app open.</div>
        <button className="rr-btn" style={{ marginTop: 16 }} onClick={() => onExit(gain)}>Back to lobby</button>
      </div>
    );
  }
  const q = qs[i];
  return (
    <div className="rr-card">
      <div className="rr-progress">{qs.map((_, k) => <i key={k} className={k < i ? "done" : k === i ? "cur" : ""} />)}</div>
      <div className="rr-eyebrow" style={{ color: "var(--cyan)" }}>Practice · no stakes</div>
      <Round key={i} q={q} onDone={(c) => handle(c)} />
    </div>
  );
}

/* ---------------- modes store ---------------- */
function Store({ owned, active, coins, onBuy, onEquip, onExit }) {
  return (
    <div className="rr-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <span className="rr-disp" style={{ fontSize: 22 }}>Modes</span>
        <span className="rr-chip">◆ <b style={{ marginLeft: 4, color: "var(--amber)" }}>{coins}</b></span>
      </div>
      {THEMES.map((t) => {
        const isOwned = owned.includes(t.id), isActive = active === t.id, canAfford = coins >= t.cost;
        const nameFont = t.style === "pixel" ? "'Press Start 2P',monospace" : t.style === "mono" ? "'Archivo',sans-serif" : "'Fredoka',sans-serif";
        return (
          <div key={t.id} style={{ ...t.vars, background: t.vars["--panel2"], color: t.vars["--text"], border: `1px solid ${t.vars["--line"]}`, borderRadius: 18, padding: 15, marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: nameFont, fontWeight: t.style === "mono" ? 900 : 700, fontSize: t.style === "pixel" ? 12 : 18, textTransform: t.style === "mono" ? "uppercase" : "none", lineHeight: 1.3 }}>{t.name}</div>
                <div style={{ fontSize: 12, color: t.vars["--muted"], marginTop: 5, fontWeight: 600 }}>{t.blurb}</div>
              </div>
              {isActive ? <span className="rr-divbadge" style={{ background: t.vars["--lime"], color: t.vars["--btnText"], flexShrink: 0 }}>Equipped</span> : null}
            </div>
            <div className="rr-swatches">
              {["--lime", "--pink", "--cyan", "--amber"].map((v) => <span key={v} className="rr-dot" style={{ background: t.vars[v] }} />)}
              <span style={{ fontSize: 10, letterSpacing: 1, textTransform: "uppercase", fontWeight: 800, color: t.vars["--muted"], alignSelf: "center", marginLeft: 2 }}>{t.style} style</span>
            </div>
            {isActive ? null
              : isOwned
                ? <button className="rr-btn sm" style={{ background: t.vars["--lime"], color: t.vars["--btnText"] }} onClick={() => onEquip(t.id)}>Equip</button>
                : <button className="rr-btn sm" disabled={!canAfford} style={{ background: t.vars["--lime"], color: t.vars["--btnText"] }} onClick={() => onBuy(t.id, t.cost)}>Unlock · ◆{t.cost}</button>}
          </div>
        );
      })}
      <button className="rr-btn ghost" style={{ marginTop: 4 }} onClick={onExit}>Back to lobby</button>
    </div>
  );
}

/* ---------------- app ---------------- */
export default function App() {
  const [screen, setScreen] = useState("home");
  const [coins, setCoins] = useState(400);
  const [rating, setRating] = useState(1180);
  const [streak, setStreak] = useState(3);
  const [sharp, setSharp] = useState(46);
  const [last, setLast] = useState(null);
  const [owned, setOwned] = useState(["daylight"]);
  const [active, setActive] = useState("daylight");

  const theme = THEMES.find((t) => t.id === active) || THEMES[0];
  const [div, divCol] = divOf(rating);

  const finishContest = (score, field) => {
    const total = field.length;
    const place = field.findIndex((f) => f.me) + 1;
    const reward = place === 1 ? 100 : place === 2 ? 70 : place === 3 ? 50 : place <= Math.ceil(total / 3) ? 30 : 15;
    const streakBonus = (streak + 1) * 2;
    const delta = Math.round((((total - place) / (total - 1)) - 0.5) * 64);
    setCoins((c) => c + reward + streakBonus);
    setRating((r) => Math.max(800, r + delta));
    setStreak((s) => s + 1);
    setLast({ score, field, place, total, coins: reward + streakBonus, delta });
    setScreen("results");
  };

  return (
    <div className={"rr-root s-" + (theme.style || "soft")} style={theme.vars}>
      <style>{STYLE}</style>
      <div className="rr-wrap">

        <div className="rr-topbar">
          <div className="rr-stat"><b style={{ color: "var(--amber)" }}>{coins}</b><span>◆ coins</span></div>
          <div className="rr-stat"><b style={{ color: divCol }}>{rating}</b><span>{div}</span></div>
          <div className="rr-stat"><b style={{ color: "var(--pink)" }}>{streak}🔥</b><span>day streak</span></div>
          <div className="rr-stat"><b style={{ color: "var(--cyan)" }}>{sharp}</b><span>sharpness</span></div>
        </div>

        {screen === "home" && (
          <>
            <div className="rr-card rr-hero">
              <div className="rr-eyebrow">Today's contest</div>
              <h1 className="rr-h1 rr-disp">Speed <em>Royale</em></h1>
              <div className="rr-sub">7 quick rounds — trivia, rapid math, patterns &amp; memory. Score on speed and smarts against a friendly field of 12.</div>
              <button className="rr-btn" onClick={() => setScreen("playing")}>Play now</button>
              <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                <button className="rr-btn ghost" style={{ flex: 1 }} onClick={() => setScreen("practice")}>Warm up</button>
                <button className="rr-btn ghost" style={{ flex: 1 }} onClick={() => setScreen("store")}>🎨 Modes</button>
              </div>
              <div className="rr-note">Your streak grows by showing up <b style={{ color: "var(--text)" }}>once a day</b> — not by staying glued on. You climb by getting sharper.</div>
            </div>

            <div className="rr-card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <span className="rr-disp" style={{ fontSize: 20 }}>Season ladder</span>
                <span className="rr-divbadge" style={{ background: divCol, color: "#fff" }}>{div}</span>
              </div>
              {[["snapfast", 2210], ["m1nd", 1980], ["kaze", 1640]].map(([n, s], k) => (
                <div className="rr-lb" key={k}><span className="rk">{k + 1}</span><span className="nm">{n}</span><span className="sc">{s}</span></div>
              ))}
              <div className="rr-lb me"><span className="rk">—</span><span className="nm">you</span><span className="sc">{rating}</span></div>
            </div>
          </>
        )}

        {screen === "playing" && <Contest onComplete={finishContest} />}
        {screen === "practice" && <Practice onExit={(g) => { setSharp((s) => Math.min(100, s + g)); setScreen("home"); }} />}
        {screen === "store" && (
          <Store owned={owned} active={active} coins={coins}
            onBuy={(id, cost) => { setCoins((c) => c - cost); setOwned((o) => [...o, id]); setActive(id); }}
            onEquip={(id) => setActive(id)}
            onExit={() => setScreen("home")} />
        )}

        {screen === "results" && last && (
          <>
            <div className="rr-card" style={{ textAlign: "center" }}>
              <div className="rr-eyebrow rr-stagger" style={{ animationDelay: ".05s" }}>You placed</div>
              <div className="rr-place rr-stagger" style={{ animationDelay: ".12s", color: last.place === 1 ? "var(--lime)" : last.place <= 3 ? "var(--cyan)" : "var(--text)" }}>
                {last.place}<small>/{last.total}</small>
              </div>
              <div className="rr-stagger" style={{ animationDelay: ".2s", marginTop: 6 }}>
                <span className="rr-chip" style={{ marginRight: 6 }}>Score <b style={{ marginLeft: 4, color: "var(--cyan)" }}>{last.score}</b></span>
                <span className="rr-chip" style={{ marginRight: 6 }}>◆ <b style={{ marginLeft: 4, color: "var(--amber)" }}>+{last.coins}</b></span>
                <span className="rr-chip">Rating <b style={{ marginLeft: 4, color: last.delta >= 0 ? "var(--lime)" : "var(--pink)" }}>{last.delta >= 0 ? "+" : ""}{last.delta}</b></span>
              </div>
            </div>
            <div className="rr-card">
              <div className="rr-disp" style={{ fontSize: 18, marginBottom: 10 }}>Final standings</div>
              {last.field.slice(0, 6).map((f, k) => (
                <div className={"rr-lb" + (f.me ? " me" : "")} key={k}>
                  <span className="rk">{k + 1}</span><span className="nm">{f.name}</span><span className="sc">{f.score}</span>
                </div>
              ))}
              {!last.field.slice(0, 6).some((f) => f.me) && (
                <div className="rr-lb me"><span className="rk">{last.place}</span><span className="nm">you</span><span className="sc">{last.score}</span></div>
              )}
            </div>
            <button className="rr-btn pink" onClick={() => setScreen("playing")}>Play again</button>
            <button className="rr-btn ghost" style={{ marginTop: 10 }} onClick={() => setScreen("home")}>Lobby</button>
          </>
        )}

        <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 11, marginTop: 18, lineHeight: 1.5, fontWeight: 600 }}>
          Prototype · opponents are simulated · coins are a closed loop (no purchase, no cash-out)
        </div>
      </div>
    </div>
  );
}
