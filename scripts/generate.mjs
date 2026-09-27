// Generates the profile SVGs in ./assets from live GitHub data, in a dark and a light variant.
// Usage: GITHUB_TOKEN=... node scripts/generate.mjs
import { readFile, writeFile, mkdir } from "node:fs/promises";

const root = new URL("..", import.meta.url);
const config = JSON.parse(await readFile(new URL("config.json", root), "utf8"));
const token = process.env.GITHUB_TOKEN;
if (!token) throw new Error("GITHUB_TOKEN is required");

const W = 912;
const FONT = "ui-monospace, SFMono-Regular, 'JetBrains Mono', Menlo, Consolas, 'Liberation Mono', monospace";
const MON = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

// The README picks a variant with <picture> and prefers-color-scheme, which GitHub resolves from
// the viewer's GitHub theme. Dark is smoked glass with light ink; light is frosted glass with
// GitHub's own dark ink, and busier days get darker, like GitHub's light graph.
const THEMES = {
  dark: {
    glass: { fill: "#0a0a0a", opacity: 0.84, edge: "#ffffff", gloss: 0.08, bar: 0.1, active: 0.22, idle: 0.09, card: 0.12 },
    text: "#e6e6e6", strong: "#ffffff", title: "#ededed",
    label: "#a8a8a8", faint: "#8e8e8e", key: "#a0a0a0", sep: "#6a6a6a", barText: "#b0b0b0",
    pill: ["#e6e6e6", "#050505"], logo: "#e0e0e0", icon: "#bdbdbd",
    sheen: ["#d4d4d4", "#ffffff"], shadow: "#5e5e5e",
    palette: ["#141414", "#262626", "#3d3d3d", "#595959", "#7a7a7a", "#a0a0a0", "#c8c8c8", "#f2f2f2"],
    bars: { low: "#555555", high: "#ffffff", none: "#1c1c1c" },
    wire: "#ffffff",
    ramp: ["#141414", "#505050", "#7a7a7a", "#b0b0b0", "#f0f0f0"],
    empty: { fill: "#ffffff", opacity: 0.07 },
    shade: { to: "#050505", front: 0.35, side: 0.62 },
    hot: 0.6,
    peak: { bg: "#050505", stroke: "#3a3a3a", text: "#f2f2f2", tick: "#5a5a5a", dot: "#ffffff" },
  },
  light: {
    glass: { fill: "#f6f8fa", opacity: 0.78, edge: "#1f2328", gloss: 0.5, bar: 0.12, active: 0.3, idle: 0.12, card: 0.14 },
    text: "#1f2328", strong: "#000000", title: "#1f2328",
    label: "#57606a", faint: "#6e7781", key: "#6e7781", sep: "#c4c9cf", barText: "#424a53",
    pill: ["#1f2328", "#ffffff"], logo: "#1f2328", icon: "#424a53",
    sheen: ["#24292f", "#8c959f"], shadow: "#b1b8c0",
    palette: ["#141414", "#262626", "#3d3d3d", "#595959", "#7a7a7a", "#a0a0a0", "#c8c8c8", "#f2f2f2"],
    bars: { low: "#c4c9cf", high: "#1f2328", none: "#e6e9ec" },
    wire: "#1f2328",
    ramp: ["#ebedf0", "#c2c2c2", "#8a8a8a", "#505050", "#1c1c1c"],
    empty: { fill: "#000000", opacity: 0.06 },
    shade: { to: "#000000", front: 0.14, side: 0.3 },
    hot: 0.45,
    peak: { bg: "#ffffff", stroke: "#d0d7de", text: "#1f2328", tick: "#afb8c1", dot: "#1f2328" },
  },
};

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const fmtDate = (iso) => {
  const [, m, d] = iso.split("-").map(Number);
  return `${MON[m - 1]} ${d}`;
};

function mix(a, b, t) {
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [rgb(a), rgb(b)];
  return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("");
}

async function gql(query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

const { user } = await gql(
  `query($login: String!) {
    user(login: $login) {
      contributionsCollection {
        contributionCalendar {
          totalContributions
          weeks { contributionDays { date contributionCount contributionLevel } }
        }
      }
    }
  }`,
  { login: config.username },
);
const cal = user.contributionsCollection.contributionCalendar;

// Icons come from Simple Icons; an entry just renders without its icon if the fetch fails.
const icons = Object.fromEntries(
  await Promise.all(
    [...config.langs, ...config.tools, { icon: "archlinux" }].map(async ({ icon }) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await fetch(`https://cdn.jsdelivr.net/npm/simple-icons/icons/${icon}.svg`);
          const path = res.ok ? (await res.text()).match(/<path d="([^"]+)"/)?.[1] : null;
          if (path) return [icon, path];
        } catch {}
      }
      return [icon, null];
    }),
  ),
);

function frame(w, h, style, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="${FONT}">
  <style>${style}@media (prefers-reduced-motion: reduce) { * { animation: none !important } }</style>
${body}
</svg>
`;
}

// Glass panels shared by both cards. The cards have no background, so the panels float on the
// GitHub page itself: translucent glass with a hairline border and a sheen along the top edge.
const glassDefs = (t) =>
  `<linearGradient id="gloss" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="${t.glass.gloss}"/><stop offset=".3" stop-color="#ffffff" stop-opacity="0"/></linearGradient>`;

function glass(t, x, y, w, h, rx, edge) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${t.glass.fill}" fill-opacity="${t.glass.opacity}" stroke="${t.glass.edge}" stroke-opacity="${edge}"/><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="url(#gloss)"/>`;
}

const days = cal.weeks.flatMap((w) => w.contributionDays);

function stats() {
  let longest = 0, run = 0, best = days[0];
  for (const d of days) {
    run = d.contributionCount > 0 ? run + 1 : 0;
    longest = Math.max(longest, run);
    if (d.contributionCount > best.contributionCount) best = d;
  }
  // today may still be empty; the streak only breaks once a full day passes without contributions
  let i = days.length - 1, current = 0;
  if (days[i]?.contributionCount === 0) i--;
  while (i >= 0 && days[i].contributionCount > 0) current++, i--;
  return { longest, current, best };
}

// Wireframe icosahedron with its dual dodecahedron counter-rotating inside. Both solids map onto
// themselves after a 72° turn about the shared 5-fold axis, so only that slice is sampled and it
// loops seamlessly. Each edge fades with its depth, which is what makes it read as 3D.
function solid(t, cx, cy, R) {
  const PERIOD = 12, FRAMES = 24;
  const TILT = (18 * Math.PI) / 180, ROLL = (-14 * Math.PI) / 180;

  // icosahedron with a vertex on each pole of the y axis
  const ring = (y, offset) =>
    Array.from({ length: 5 }, (_, i) => {
      const a = ((72 * i + offset) * Math.PI) / 180, rho = Math.sqrt(1 - y * y);
      return [rho * Math.cos(a), y, rho * Math.sin(a)];
    });
  const h = 1 / Math.sqrt(5);
  const ico = [[0, 1, 0], ...ring(h, 0), ...ring(-h, 36), [0, -1, 0]];
  const u = (i) => 1 + (i % 5), l = (i) => 6 + (i % 5);
  const faces = [];
  for (let i = 0; i < 5; i++) {
    faces.push([0, u(i), u(i + 1)], [11, l(i), l(i + 1)], [u(i), u(i + 1), l(i)], [l(i), l(i + 1), u(i + 1)]);
  }
  const edgesOf = (fs) => {
    const set = new Map();
    for (const f of fs) for (let k = 0; k < 3; k++) {
      const [a, b] = [f[k], f[(k + 1) % 3]].sort((x, y) => x - y);
      set.set(`${a}-${b}`, [a, b]);
    }
    return [...set.values()];
  };
  const icoEdges = edgesOf(faces);
  // dual: one vertex per face centre, an edge between faces that share an edge
  const dod = faces.map((f) => {
    const c = [0, 1, 2].map((k) => (ico[f[0]][k] + ico[f[1]][k] + ico[f[2]][k]) / 3);
    const n = Math.hypot(...c);
    return c.map((v) => v / n);
  });
  const dodEdges = [];
  faces.forEach((f, i) =>
    faces.forEach((g, j) => {
      if (j > i && f.filter((v) => g.includes(v)).length === 2) dodEdges.push([i, j]);
    }),
  );

  // turn about y, then a fixed tilt toward the viewer and a slight roll so the axis runs diagonally
  const project = ([x, y, z], psi, scale) => {
    const x1 = x * Math.cos(psi) + z * Math.sin(psi), z1 = -x * Math.sin(psi) + z * Math.cos(psi);
    const y2 = y * Math.cos(TILT) - z1 * Math.sin(TILT), z2 = y * Math.sin(TILT) + z1 * Math.cos(TILT);
    const x3 = x1 * Math.cos(ROLL) - y2 * Math.sin(ROLL), y3 = x1 * Math.sin(ROLL) + y2 * Math.cos(ROLL);
    return [r1(cx + R * scale * x3), r1(cy - R * scale * y3), z2];
  };
  const opacity = (z, max) => r2(0.08 + (max - 0.08) * ((z + 1) / 2) ** 1.4);
  const frames = Array.from({ length: FRAMES + 1 }, (_, f) => ((2 * Math.PI) / 5) * (f / FRAMES));
  const anim = (attr, values) =>
    `<animate attributeName="${attr}" dur="${PERIOD}s" repeatCount="indefinite" values="${values.join(";")}"/>`;

  const wire = (verts, edges, dir, scale, max, width) =>
    edges
      .map(([a, b]) => {
        const at = frames.map((psi) => [project(verts[a], dir * psi, scale), project(verts[b], dir * psi, scale)]);
        const d = at.map(([p, q]) => `M${p[0]} ${p[1]}L${q[0]} ${q[1]}`);
        const op = at.map(([p, q]) => opacity((p[2] + q[2]) / 2, max));
        return `<path d="${d[0]}" stroke-opacity="${op[0]}" stroke-width="${width}">${anim("d", d)}${anim("stroke-opacity", op)}</path>`;
      })
      .join("");
  const points = (verts, dir, scale, max) =>
    verts
      .map((v) => {
        const at = frames.map((psi) => project(v, dir * psi, scale));
        const op = at.map((p) => opacity(p[2], max));
        return `<circle cx="${at[0][0]}" cy="${at[0][1]}" r="1.7" fill-opacity="${op[0]}">${anim("cx", at.map((p) => p[0]))}${anim("cy", at.map((p) => p[1]))}${anim("fill-opacity", op)}</circle>`;
      })
      .join("");

  return `
  <g fill="none" stroke="${t.wire}" stroke-linecap="round">${wire(ico, icoEdges, 1, 1, 0.85, 1)}${wire(dod, dodEdges, -1, 0.52, 0.45, 0.8)}</g>
  <g fill="${t.wire}">${points(ico, 1, 1, 1)}</g>`;
}

// "ANSI Shadow" figlet letters. They are drawn as geometry rather than text so the blocks and
// box-drawing strokes tile perfectly whatever monospace font the viewer has.
const FIGLET = {
  B: ["██████╗ ", "██╔══██╗", "██████╔╝", "██╔══██╗", "██████╔╝", "╚═════╝ "],
  C: [" ██████╗", "██╔════╝", "██║     ", "██║     ", "╚██████╗", " ╚═════╝"],
  D: ["██████╗ ", "██╔══██╗", "██║  ██║", "██║  ██║", "██████╔╝", "╚═════╝ "],
  E: ["███████╗", "██╔════╝", "█████╗  ", "██╔══╝  ", "███████╗", "╚══════╝"],
  I: ["██╗", "██║", "██║", "██║", "██║", "╚═╝"],
  L: ["██╗     ", "██║     ", "██║     ", "██║     ", "███████╗", "╚══════╝"],
};

// One entry per text row ({ blocks, lines }), so the rows can be revealed one after another.
function figlet(text, x0, y0, cw, ch) {
  const letters = [...text.toUpperCase()].map((c) => FIGLET[c]);
  if (letters.some((l) => !l)) return null;
  const rows = [0, 1, 2, 3, 4, 5].map((r) => letters.map((l) => l[r]).join(""));
  const gy = ch * 0.16, gx = cw * 0.2;
  const out = rows.map((row, r) => {
    let blocks = "", lines = "";
    const y = y0 + r * ch, cy = y + ch / 2;
    for (let c = 0; c < row.length; c++) {
      const x = x0 + c * cw, cx = x + cw / 2, glyph = row[c];
      if (glyph === "█") {
        let n = 1;
        while (row[c + n] === "█") n++;
        // half a pixel of overlap so stacked rows never show a hairline seam
        blocks += `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(n * cw)}" height="${ch + 0.5}"/>`;
        c += n - 1;
        continue;
      }
      const [L, R, T, B] = [x, x + cw, y, y + ch].map(r1);
      const [a, b, p, q] = [cy - gy, cy + gy, cx - gx, cx + gx].map(r1);
      lines += {
        "═": `M${L} ${a}H${R}M${L} ${b}H${R}`,
        "║": `M${p} ${T}V${B}M${q} ${T}V${B}`,
        "╗": `M${L} ${a}H${q}V${B}M${L} ${b}H${p}V${B}`,
        "╔": `M${R} ${a}H${p}V${B}M${R} ${b}H${q}V${B}`,
        "╝": `M${L} ${b}H${q}V${T}M${L} ${a}H${p}V${T}`,
        "╚": `M${R} ${b}H${p}V${T}M${R} ${a}H${q}V${T}`,
      }[glyph] ?? "";
    }
    return { blocks, lines };
  });
  return { rows: out, width: rows[0].length * cw };
}

// A tiling-WM desktop in the r/unixporn style: a status bar, a terminal running fastfetch with the
// name in figlet, a window rendering the wireframe solid and a small activity monitor.
// On load it boots: the bar drops in, `fastfetch` is typed, its output rises in line by line while
// the side windows open, then the bottom prompt starts typing commands forever.
function heroCard(t) {
  const H = 362, M = 12, GAP = 10, TOP = 50;
  const LW = 540, RX = M + LW + GAP, RW = W - M - RX;
  const RT = 172, RB = TOP + RT + GAP;
  const FS = 11.5, CW = 6.9; // terminal font size and forced cell width (textLength keeps it exact)
  const TX = M + 18;
  const st = stats();

  // boot timeline, seconds from load
  const T = { bar: 0, win: 0.12, prompt: 0.5, type: 0.85, key: 0.075 };
  T.enter = T.type + ("fastfetch".length + 1) * T.key + 0.3;
  T.out = T.enter + 0.1;
  T.prompt2 = T.out + 1.35;
  T.loop = T.prompt2 + 0.4;
  const at = (cls, time, body) => `<g class="${cls}" style="--t:${r2(time)}s">${body}</g>`;

  const win = (x, y, w, h, active) => glass(t, x, y, w, h, 10, active ? t.glass.active : t.glass.idle);
  const mono = (x, y, s, fill, extra = "") =>
    `<text x="${r1(x)}" y="${r1(y)}" fill="${fill}" font-size="${FS}" textLength="${r1(s.length * CW)}" lengthAdjust="spacingAndGlyphs"${extra}>${esc(s)}</text>`;
  const icon = (slug, x, y, size, fill) =>
    icons[slug] ? `<path transform="translate(${r1(x)} ${r1(y)}) scale(${r2(size / 24)})" d="${icons[slug]}" fill="${fill}"/>` : "";

  // status bar
  const barY = M, barH = 28, mid = barY + barH / 2;
  let ws = "";
  for (let i = 0; i < 5; i++) {
    const x = 54 + i * 22;
    ws += i === 0
      ? `<rect x="${x - 8}" y="${mid - 8}" width="16" height="16" rx="8" fill="${t.pill[0]}"/><text x="${x}" y="${mid + 3.5}" fill="${t.pill[1]}" font-size="10" text-anchor="middle" font-weight="700">1</text>`
      : `<text x="${x}" y="${mid + 3.5}" fill="${t.key}" font-size="10" text-anchor="middle">${i + 1}</text>`;
  }
  const bar = at("drop", T.bar, `${glass(t, M, barY, W - 2 * M, barH, 8, t.glass.bar)}
  ${icon("archlinux", 24, mid - 7, 14, t.logo)}${ws}
  <text x="${W / 2}" y="${mid + 3.5}" fill="${t.label}" font-size="10.5" text-anchor="middle">fastfetch - kitty</text>
  <text x="${W - M - 14}" y="${mid + 3.5}" fill="${t.barText}" font-size="10.5" text-anchor="end">${cal.totalContributions} commits<tspan fill="${t.sep}">  │  </tspan>${st.longest}d streak</text>`);

  // terminal
  const prompt = `${config.name}@${config.username} ~ ❯`;
  const promptEl = (y) =>
    `<text x="${TX}" y="${y}" font-size="${FS}" textLength="${r1(prompt.length * CW)}" lengthAdjust="spacingAndGlyphs"><tspan fill="${t.text}">${esc(config.name)}</tspan><tspan fill="${t.label}">@</tspan><tspan fill="${t.text}">${esc(config.username)}</tspan><tspan fill="${t.label}"> ~ </tspan><tspan fill="${t.strong}">❯</tspan></text>`;
  const cmdX = TX + (prompt.length + 1) * CW;

  // typing: a clip rect widens one cell per keystroke and the cursor follows, on discrete SMIL
  // steps so it reads like real keystrokes
  const typer = (id, cmd, y, keys, opts) =>
    `<clipPath id="${id}"><rect x="${r1(cmdX)}" y="${y - 12}" height="16" width="0"><animate attributeName="width" ${discrete(keys, opts)}/></rect></clipPath>${mono(cmdX, y, cmd, t.text, ` clip-path="url(#${id})"`)}`;
  const cursorEl = (y, keys, opts) =>
    `<rect class="cur" x="${r1(cmdX)}" y="${y - 10.5}" width="${CW}" height="13" fill="${t.text}"><animate attributeName="x" ${discrete(keys, opts)}/></rect>`;

  const y1 = TOP + 24;
  const ffKeys = [[0, 0], ...[..."fastfetch"].map((_, k) => [(k + 1) * T.key, r1((k + 1) * CW)])];
  const ffCursor = [[0, r1(cmdX)], ...[..."fastfetch"].map((_, k) => [(k + 1) * T.key, r1(cmdX + (k + 1) * CW)])];
  const once = { begin: T.type, dur: ("fastfetch".length + 1) * T.key + 0.05, loop: false };
  const firstPrompt = at("in", T.prompt,
    `${promptEl(y1)}${typer("ff", "fastfetch", y1, ffKeys, once)}<g>${cursorEl(y1, ffCursor, once)}<set attributeName="opacity" to="0" begin="${r2(T.enter)}s" fill="freeze"/></g>`);

  const fig = figlet(config.name, TX, 86, 8, 15);
  const logo = fig
    ? fig.rows
        .map((row, r) => at("in", T.out + r * 0.055, `<g fill="url(#sheen)" shape-rendering="crispEdges">${row.blocks}</g><path d="${row.lines}" fill="none" stroke="${t.shadow}" stroke-width=".9"/>`))
        .join("")
    : at("in", T.out, `<text x="${TX}" y="150" fill="${t.title}" font-size="64" font-weight="700">${esc(config.name)}</text>`);

  const KX = TX, VX = TX + 9 * CW, info0 = 198, LH = 17;
  const list = (items, y) => {
    let x = VX;
    return items
      .map(({ name, icon: slug }) => {
        const el = icon(slug, x, y - 9.5, 11, t.icon) + mono(x + (icons[slug] ? 15 : 0), y, name.toLowerCase(), t.text);
        x += (icons[slug] ? 15 : 0) + name.length * CW + 16;
        return el;
      })
      .join("");
  };
  const lines = [
    ["role", (y) => mono(VX, y, config.role, t.text)],
    ["focus", (y) => mono(VX, y, config.bio, t.text)],
    ["langs", (y) => list(config.langs, y)],
    ["tools", (y) => list(config.tools, y)],
    ["commits", (y) => mono(VX, y, `${cal.totalContributions} this year · ${st.longest}d longest streak`, t.text)],
    ["note", (y) => mono(VX, y, config.note, t.text)],
  ];
  const info = lines
    .map(([key, value], i) => at("in", T.out + 0.42 + i * 0.075, mono(KX, info0 + i * LH, key, t.key) + value(info0 + i * LH)))
    .join("\n  ");
  const palY = info0 + 5 * LH + 12;
  const palette = t.palette
    .map((c, i) => at("in", T.out + 0.95 + i * 0.035, `<rect x="${KX + i * 22}" y="${palY}" width="22" height="11" fill="${c}"/>`))
    .join("");

  // bottom prompt: each command gets a slot, typed then cleared, forever
  const SLOT = 3.4, cmds = config.commands, P = cmds.length * SLOT, lastY = palY + 36;
  const loop = { begin: T.loop, dur: P, loop: true };
  const cursorKeys = [[0, cmdX]];
  const typed = cmds
    .map((cmd, i) => {
      const t0 = i * SLOT, keys = [[0, 0]];
      [...cmd].forEach((_, k) => {
        const time = t0 + 0.3 + k * 0.065;
        keys.push([time, r1((k + 1) * CW)]);
        cursorKeys.push([time, r1(cmdX + (k + 1) * CW)]);
      });
      keys.push([t0 + SLOT - 0.35, 0]);
      cursorKeys.push([t0 + SLOT - 0.35, cmdX]);
      return typer(`k${i}`, cmd, lastY, keys, loop);
    })
    .join("");
  const lastPrompt = at("in", T.prompt2, `${promptEl(lastY)}${typed}${cursorEl(lastY, cursorKeys, loop)}`);

  // activity: commits per week over the last half year, bars grow in left to right
  const weeks = cal.weeks.slice(-26).map((w) => w.contributionDays.reduce((a, d) => a + d.contributionCount, 0));
  const maxW = Math.max(1, ...weeks), ax = RX + 16, aw = RW - 32, pitch = aw / weeks.length, base = H - M - 16;
  const bars = weeks
    .map((n, i) => {
      const h = n ? Math.max(3, 56 * Math.sqrt(n / maxW)) : 2;
      return `<rect class="grow" style="--t:${r2(T.out + 0.45 + i * 0.018)}s" x="${r1(ax + i * pitch)}" y="${r1(base - h)}" width="${r1(pitch - 4)}" height="${r1(h)}" rx="1.5" fill="${n ? mix(t.bars.low, t.bars.high, (n / maxW) ** 0.7) : t.bars.none}"/>`;
    })
    .join("");

  const ease = "cubic-bezier(.2,.8,.2,1)";
  const style = `
    .in { animation: rise .55s ${ease} backwards; animation-delay: var(--t) }
    @keyframes rise { from { opacity: 0; transform: translateY(5px) } }
    .drop { animation: drop .5s ${ease} backwards; animation-delay: var(--t) }
    @keyframes drop { from { opacity: 0; transform: translateY(-8px) } }
    .pop { transform-box: fill-box; transform-origin: 50% 50%; animation: pop .6s ${ease} backwards; animation-delay: var(--t) }
    @keyframes pop { from { opacity: 0; transform: scale(.975) } }
    .grow { transform-box: fill-box; transform-origin: 50% 100%; animation: grow .6s ${ease} backwards; animation-delay: var(--t) }
    @keyframes grow { from { transform: scaleY(0) } }
    .cur { animation: blink 1.05s steps(1) infinite }
    @keyframes blink { 50% { opacity: 0 } }
  `;
  const figW = fig?.width ?? 400;
  return frame(W, H, style, `
  <defs>${glassDefs(t)}<linearGradient id="sheen" gradientUnits="userSpaceOnUse" x1="${TX}" y1="0" x2="${TX + 140}" y2="0">
    <stop offset="0" stop-color="${t.sheen[0]}"/><stop offset=".5" stop-color="${t.sheen[1]}"/><stop offset="1" stop-color="${t.sheen[0]}"/>
    <animateTransform attributeName="gradientTransform" type="translate" begin="${r2(T.out + 0.5)}s" dur="7s" repeatCount="indefinite" values="-200 0;${r1(figW + 60)} 0;${r1(figW + 60)} 0" keyTimes="0;.45;1"/>
  </linearGradient></defs>
  ${bar}
  ${at("pop", T.win, win(M, TOP, LW, H - M - TOP, true))}
  ${firstPrompt}
  ${logo}
  ${info}
  ${palette}
  ${lastPrompt}
  ${at("pop", T.out + 0.15, `${win(RX, TOP, RW, RT, false)}
  <text x="${RX + 14}" y="${TOP + 20}" fill="${t.label}" font-size="10">~/render</text>
  <text x="${W - M - 14}" y="${TOP + 20}" fill="${t.faint}" font-size="10" text-anchor="end">icosahedron.obj</text>
  ${solid(t, RX + RW / 2, TOP + RT / 2 + 6, 64)}`)}
  ${at("pop", T.out + 0.3, `${win(RX, RB, RW, H - M - RB, false)}
  <text x="${RX + 14}" y="${RB + 20}" fill="${t.label}" font-size="10">activity</text>
  <text x="${W - M - 14}" y="${RB + 20}" fill="${t.faint}" font-size="10" text-anchor="end">${weeks.reduce((a, b) => a + b, 0)} commits · 26w</text>
  ${bars}`)}`);
}

// SMIL attributes for a value that jumps at the given times ([seconds, value] pairs, relative to
// `begin`), either looping every `dur` seconds or playing once and holding the last value.
function discrete(pairs, { begin = 0, dur, loop = true }) {
  const sorted = [...pairs].sort((a, b) => a[0] - b[0]);
  const keyTimes = sorted.map(([time]) => Math.round((time / dur) * 10000) / 10000);
  return `begin="${r2(begin)}s" dur="${r2(dur)}s" ${loop ? `repeatCount="indefinite"` : `fill="freeze"`} calcMode="discrete" keyTimes="${keyTimes.join(";")}" values="${sorted.map(([, v]) => v).join(";")}"`;
}

// Contribution calendar filmed by a camera that tilts between top-down (the classic 2D graph) and
// a low 3D angle. Every day is a prism whose height is always there: from above it is just a
// square, and as the camera pitches down its walls come into view. All geometry follows a single
// camera track that is sampled into CSS keyframes, so 2D and 3D are one object, never a swap.
function skylineCard(t) {
  const P = 12, PITCH = 16, CW = 12, T = CW / PITCH;
  const MAXH = 90, MINH = 7, Y0 = 196;
  const NW = cal.weeks.length;
  const gx = r1((W - (NW * PITCH - 4) + 28) / 2); // room for weekday labels on the left
  const cx = r1(gx + (NW * PITCH - 4) / 2);
  const level = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 };
  const maxN = Math.max(0, ...days.map((d) => d.contributionCount));
  const st = stats();

  // Camera track: pitch 90deg is straight down. Heights show as cos(pitch), row depth as sin(pitch),
  // and a depth shear (also growing with cos) reveals the right-hand walls.
  const TILT = [1, 3], BACK = [7.6, 9.6], SWEEP = 3.6, LOW = 27, DRIFT = 7, SH = 0.5, SH2 = 0.32;
  const lerp = (a, b, x) => a + (b - a) * x;
  const ease = (x) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2);
  const sine = (x) => (1 - Math.cos(Math.PI * x)) / 2;
  const cos27 = Math.cos((LOW * Math.PI) / 180);
  function cam(time) {
    let pitch = 90, sh = SH;
    if (time > TILT[0] && time < TILT[1]) pitch = lerp(90, LOW, ease((time - TILT[0]) / (TILT[1] - TILT[0])));
    else if (time >= TILT[1] && time <= BACK[0]) {
      const u = sine((time - TILT[1]) / (BACK[0] - TILT[1]));
      pitch = LOW + DRIFT * u;
      sh = lerp(SH, SH2, u);
    } else if (time > BACK[0] && time < BACK[1]) {
      const u = ease((time - BACK[0]) / (BACK[1] - BACK[0]));
      pitch = lerp(LOW + DRIFT, 90, u);
      sh = lerp(SH2, SH, u);
    }
    const rad = (pitch * Math.PI) / 180;
    const ky = PITCH * Math.sin(rad), lam = Math.cos(rad), kx = PITCH * lam * sh;
    const s = lerp(1, 0.9, lam / cos27); // pull back a little so the city fits
    return { ky, kx, lam, s, tx: -3.375 * kx * s };
  }

  const times = [0];
  const step = (a, b, dt) => {
    for (let time = a; time < b - 1e-9; time += dt) times.push(r2(time));
  };
  step(TILT[0], TILT[1], 0.1);
  step(TILT[1], BACK[0], 0.25);
  step(BACK[0], BACK[1], 0.1);
  times.push(BACK[1], P);
  const n3 = (v) => Math.round(v * 1000) / 1000;
  const deg = (rad) => n3((rad * 180) / Math.PI);
  const track = (name, fn) =>
    `@keyframes ${name}{${times.map((time) => `${r2((time / P) * 100)}%{transform:${fn(cam(time))}}`).join("")}}`;
  const tracks = [
    track("sc", (c) => `translate(${r2(c.tx)}px,0px) scale(${n3(c.s)})`),
    track("tl", (c) => `skewX(${deg(-Math.atan2(c.kx, c.ky))}deg) scaleY(${n3(T * c.ky)})`),
    track("fw", (c) => `scaleY(${n3(c.lam)})`),
    track("sw", (c) => `skewY(${deg(-Math.atan2(c.ky, Math.max(c.kx, 0.001)))}deg) scale(${n3(Math.max(T * c.kx, 0.001))},${n3(c.lam)})`),
    track("lf", (c) => `translateY(${n3(-c.lam)}px)`),
    ...[1, 2, 3, 4, 5, 6].map((k) => track(`r${k}`, (c) => `translate(${r2(k * c.kx)}px,${r2(-k * c.ky)}px)`)),
  ].join("");

  // k = depth row: 0 is the front (Saturday), 6 the back (Sunday), so the 2D row is 6 - k.
  const rows = Array.from({ length: 7 }, () => []);
  cal.weeks.forEach((w, c) =>
    w.contributionDays.forEach((d) => rows[6 - new Date(d.date + "T00:00:00Z").getUTCDay()].push({ c, d })),
  );

  const tile = (x) => `<rect class="tl" x="${x}" y="${Y0 - 1}" width="${CW}" height="1" rx="2.5" ry=".21"/>`;
  // Painter's order: back rows first, left to right, so nearer faces cover farther ones.
  const scene = rows
    .map((cells, k) => ({ cells, k }))
    .reverse()
    .map(({ cells, k }) => {
      const body = cells
        .sort((a, b) => a.c - b.c)
        .map(({ c, d }) => {
          const x = r1(gx + c * PITCH), n = d.contributionCount;
          const lv = level[d.contributionLevel] ?? 0;
          // empty days are a faint veil, so they sit just off whatever glass shade is behind them
          if (!n || !maxN) return `<g fill="${t.empty.fill}" fill-opacity="${t.empty.opacity}">${tile(x)}</g>`;
          const z = r1(MINH + (MAXH - MINH) * Math.sqrt(n / maxN));
          // the peak label sits on a pill so it stays readable over the rooftops behind it
          const text = `${n} · ${fmtDate(d.date)}`, tw = text.length * 6, lx = r1(x + 8.5);
          const label =
            d === st.best
              ? `<g class="pk"><rect x="${r1(lx - tw / 2 - 7)}" y="${Y0 - 36}" width="${tw + 14}" height="16" rx="8" fill="${t.peak.bg}" stroke="${t.peak.stroke}"/><text x="${lx}" y="${Y0 - 24.5}" fill="${t.peak.text}" font-size="10" text-anchor="middle" textLength="${tw}" lengthAdjust="spacingAndGlyphs">${text}</text><path d="M${lx} ${Y0 - 20}V${Y0 - 15.5}" stroke="${t.peak.tick}"/><circle cx="${lx}" cy="${Y0 - 13}" r="2" fill="${t.peak.dot}"/></g>`
              : "";
          // Roof lift: translateY(-lambda px) inside scale(1 z) moves the roof exactly z*lambda. The scale
          // is anchored at the baseline and its inverse kept at full precision, or the roof drifts off the walls.
          // Walls run 2px into the roof so its rounded corners never show a notch at the seam.
          return `<g style="--d:${r2(c * 0.022 + k * 0.03)}s"><rect class="fw f${lv}" x="${x}" y="${r1(Y0 - z - 2)}" width="${CW}" height="${z + 2}"/><rect class="sw s${lv}" x="${x + CW}" y="${r1(Y0 - z - 2)}" width="1" height="${z + 2}"/><g transform="translate(0 ${Y0}) scale(1 ${z})"><g class="lf"><g class="t${lv}" transform="scale(1 ${+(1 / z).toPrecision(7)}) translate(0 ${-Y0})">${tile(x)}${label}</g></g></g></g>`;
        })
        .join("");
      return `<g class="r${k}">${body}</g>`;
    })
    .join("");

  // 2D labels, like GitHub's own graph: months on top, Mon/Wed/Fri on the left
  let labels = "", lastC = -9;
  cal.weeks.forEach((w, c) =>
    w.contributionDays.forEach((d) => {
      const [, m, day] = d.date.split("-").map(Number);
      if (day !== 1 || c - lastC < 3 || c > NW - 2) return;
      labels += `<text x="${r1(gx + c * PITCH)}" y="${Y0 - 116}">${MON[m - 1][0].toUpperCase() + MON[m - 1].slice(1)}</text>`;
      lastC = c;
    }),
  );
  [["Mon", 1], ["Wed", 3], ["Fri", 5]].forEach(([name, r]) => {
    labels += `<text x="${r1(gx - 6)}" y="${r1(Y0 - 16 * (6 - r) - 2.5)}" text-anchor="end">${name}</text>`;
  });

  const pct = (s) => `${r2((s / P) * 100)}%`;
  // rooftops carry the level colour; fronts and sides are shaded toward the theme's shadow tone
  const faces = t.ramp
    .map((col, i) => {
      const hot = mix(col, "#ffffff", t.hot);
      return `.t${i}{fill:${col};animation:s${i} ${P}s ease-in-out infinite;animation-delay:var(--d)}.f${i}{fill:${mix(col, t.shade.to, t.shade.front)}}.s${i}{fill:${mix(col, t.shade.to, t.shade.side)}}@keyframes s${i}{0%,${pct(SWEEP)}{fill:${col}}${pct(SWEEP + 0.4)}{fill:${hot}}${pct(SWEEP + 1)},100%{fill:${col}}}`;
    })
    .join("");
  // Base styles are the 2D view, so static renderers and reduced motion get the classic graph.
  const style = `${faces}${tracks}
    .sc, .tl, .fw, .sw, .lf, .r1, .r2, .r3, .r4, .r5, .r6 { animation-duration: ${P}s; animation-timing-function: linear; animation-iteration-count: infinite }
    .sc { transform-box: view-box; transform-origin: ${cx}px ${Y0}px; animation-name: sc }
    .tl { transform-box: fill-box; transform-origin: 0% 100%; transform: scaleY(${CW}); animation-name: tl }
    .fw { transform-box: fill-box; transform-origin: 50% 100%; transform: scaleY(0); animation-name: fw }
    .sw { transform-box: fill-box; transform-origin: 0% 100%; transform: scale(0, 0); animation-name: sw }
    .lf { animation-name: lf }
    ${[1, 2, 3, 4, 5, 6].map((k) => `.r${k} { transform: translate(0px, ${-k * PITCH}px); animation-name: r${k} }`).join("\n    ")}
    .lb { animation: lb ${P}s linear infinite }
    @keyframes lb { 0%, ${pct(TILT[0] - 0.2)} { opacity: 1 } ${pct(TILT[0] + 0.3)}, ${pct(BACK[1] - 0.3)} { opacity: 0 } ${pct(BACK[1] + 0.2)}, 100% { opacity: 1 } }
    .pk { opacity: 0; animation: pk ${P}s linear infinite }
    @keyframes pk { 0%, ${pct(TILT[1] - 0.2)} { opacity: 0 } ${pct(TILT[1] + 0.3)}, ${pct(BACK[0])} { opacity: 1 } ${pct(BACK[0] + 0.4)}, 100% { opacity: 0 } }
  `;

  const footY = Y0 + 40, H = footY + 26;
  // the calendar sits in a glass window, like the windows in the hero
  return frame(W, H, style, `
  <defs>${glassDefs(t)}</defs>
  ${glass(t, 8, 8, W - 16, H - 16, 12, t.glass.card)}
  <text x="24" y="29" fill="${t.label}" font-size="10">~/contributions</text>
  <text x="${W - 24}" y="29" fill="${t.faint}" font-size="10" text-anchor="end">calendar.3d</text>
  <g class="sc">${scene}</g>
  <g class="lb" fill="${t.key}" font-size="10">${labels}</g>
  <text x="${gx}" y="${footY}" fill="${t.title}" font-size="13" font-weight="700">${cal.totalContributions} contributions<tspan fill="${t.key}" font-weight="400"> in the last year</tspan></text>
  <text x="${r1(gx + NW * PITCH - 4)}" y="${footY}" fill="${t.key}" font-size="11" text-anchor="end">longest streak ${st.longest}d · current ${st.current}d</text>`);
}

await mkdir(new URL("assets/", root), { recursive: true });
await Promise.all(
  Object.entries(THEMES).flatMap(([name, theme]) => [
    writeFile(new URL(`assets/hero-${name}.svg`, root), heroCard(theme)),
    writeFile(new URL(`assets/skyline-${name}.svg`, root), skylineCard(theme)),
  ]),
);
console.log(`ok: ${cal.totalContributions} contributions`);
