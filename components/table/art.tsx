/**
 * Original, subtle scene art for cards and nobles, in the spirit of the board game's
 * Renaissance illustrations: mines for tier 1, trade for tier 2, cities for tier 3.
 * Every shape is drawn in translucent white or black, so the same scene tints itself to
 * whatever gem color sits behind it.
 */
import type React from 'react';

const L = (o: number) => ({ fill: '#fff', fillOpacity: o });
const D = (o: number) => ({ fill: '#000', fillOpacity: o });
const line = (o: number, w = 0.6) => ({
  fill: 'none',
  stroke: '#fff',
  strokeOpacity: o,
  strokeWidth: w,
  strokeLinecap: 'round' as const,
});

/** A tiny four-point sparkle, the recurring "gem" motif in every scene. */
const Sparkle = ({ x, y, r = 1.4, o = 0.5 }: { x: number; y: number; r?: number; o?: number }) => (
  <path
    d={`M${x} ${y - r}L${x + r * 0.35} ${y - r * 0.35}L${x + r} ${y}L${x + r * 0.35} ${y + r * 0.35}L${x} ${y + r}L${x - r * 0.35} ${y + r * 0.35}L${x - r} ${y}L${x - r * 0.35} ${y - r * 0.35}Z`}
    {...L(o)}
  />
);

// Scenes use a 50×70 canvas (the card's 5:7 shape); the top quarter sits under the header.
const SCENES: Record<number, React.ReactNode[]> = {
  1: [
    // A mine in the mountains: timber-framed entrance, rails running out of it.
    <g key="mine">
      <path d="M0 44L9 33l6 5 11-14 10 13 6-5 8 8v30H0z" {...L(0.1)} />
      <path d="M26 24l-3 4h6zM9 33l-2 2.5h4z" {...L(0.18)} />
      <path d="M0 53l13-9 9 5 12-8 16 9v20H0z" {...D(0.14)} />
      <path d="M19 70V59a6.5 6.5 0 0 1 13 0v11z" {...D(0.3)} />
      <path d="M18 70V58.5M33 70V58.5M17 58h17" {...line(0.3, 1.1)} />
      <path d="M22.5 70l2-6M28.5 70l-2-6M23.2 68h4.6M24 66h3" {...line(0.22, 0.5)} />
      <Sparkle x={9} y={62} />
      <Sparkle x={41} y={60} r={1.1} o={0.4} />
      <Sparkle x={38} y={48} r={0.9} o={0.35} />
    </g>,
    // Prospecting by the river: rolling hills, a hut, pines, a stream.
    <g key="river">
      <circle cx="38" cy="30" r="5" {...L(0.12)} />
      <path d="M0 47c8-6 15-6 23-1s16 4 27-3v27H0z" {...L(0.1)} />
      <path d="M0 56c10-5 20-4 30 0s14 2 20 0v14H0z" {...D(0.12)} />
      <path d="M14 70c4-5 12-6 12-10s-7-4-6-8" {...line(0.3, 2.2)} />
      <path d="M33 58v-5l4-3.5 4 3.5v5z" {...D(0.28)} />
      <path d="M32 53.5l5-4.5 5 4.5" {...line(0.3, 0.7)} />
      <path d="M6 58l3-8 3 8zM8.5 54l2.5-7 2.5 7zM44 60l2.2-6 2.2 6z" {...D(0.22)} />
      <Sparkle x={22} y={64} r={1.1} o={0.45} />
      <Sparkle x={28} y={47} r={0.9} o={0.35} />
    </g>,
  ],
  2: [
    // A merchant ship under sail.
    <g key="ship">
      <circle cx="12" cy="30" r="4" {...L(0.12)} />
      <path d="M33 31l2-1 2 1M39 34l1.5-.8 1.5.8" {...line(0.35, 0.5)} />
      <path d="M25 56V27" {...line(0.4, 0.8)} />
      <path d="M25.6 28c6 3 8 9 8 15l-8 .5z" {...L(0.26)} />
      <path d="M24.4 32c-5 3-6 8-6 12l6 .4z" {...L(0.18)} />
      <path d="M13 47h25l-3.5 7h-18z" {...D(0.32)} />
      <path d="M25 27l3 1.2-3 1.2" {...L(0.35)} />
      <path d="M0 58c4-2 8-2 12 0s8 2 12 0 8-2 13 0 9 2 13 0v12H0z" {...L(0.12)} />
      <path d="M0 63c5-1.6 9-1.6 13 0s9 1.6 13 0 8-1.6 12 0 8 1.6 12 0v7H0z" {...D(0.1)} />
      <Sparkle x={42} y={50} r={1} o={0.4} />
    </g>,
    // A stone bridge and gatehouse on a trade road.
    <g key="bridge">
      <path d="M0 50c10-4 18-3 25-1s15 1 25-3v24H0z" {...L(0.08)} />
      <path d="M35 49V33h3v-2h2v2h2v-2h2v2h3v16z" {...D(0.24)} />
      <path d="M39 42v-4a2 2 0 0 1 4 0v4z" {...L(0.22)} />
      <path d="M0 53h50v4H0z" {...D(0.24)} />
      <path
        d="M3 57h10v6a5 5 0 0 0-10 0zM17 57h16v7a8 8 0 0 0-16 0zM37 57h10v6a5 5 0 0 0-10 0z"
        {...D(0.2)}
      />
      <path d="M0 66c6-1.5 12-1.5 18 0s12 1.5 18 0 9-1.5 14 0v4H0z" {...L(0.14)} />
      <path d="M6 53v-3h3v3M12 53v-2.5h2.5V53" {...line(0.25, 0.5)} />
      <Sparkle x={10} y={40} r={1} o={0.4} />
      <Sparkle x={25} y={45} r={0.8} o={0.35} />
    </g>,
  ],
  3: [
    // A domed city skyline, like Florence at dusk.
    <g key="city">
      <circle cx="40" cy="28" r="4.5" {...L(0.14)} />
      <path d="M0 70V55h5v-4h4v4h3V48h4v7h3v-3h2" {...D(0.18)} />
      <path d="M18 70V52a8 8 0 0 1 16 0v18z" {...D(0.3)} />
      <path d="M25.2 44h1.6v-3h-1.6z" {...D(0.3)} />
      <path d="M20.5 51.5a5.5 6 0 0 1 11 0" {...line(0.28, 0.6)} />
      <path d="M36 70V40l2-3 2 3v30z" {...D(0.28)} />
      <path d="M40 70V56h4v-3h3v3h3v14z" {...D(0.2)} />
      <path
        d="M37.3 45h1.4v2h-1.4zM37.3 50h1.4v2h-1.4zM22 58h2v3h-2zM28 58h2v3h-2zM7 59h1.5v2H7z"
        {...L(0.32)}
      />
      <Sparkle x={12} y={36} r={1.1} o={0.45} />
      <Sparkle x={30} y={33} r={0.8} o={0.35} />
    </g>,
    // A palace arcade: columns and arches opening onto a courtyard.
    <g key="palace">
      <path d="M4 70V40l21-9 21 9v30z" {...L(0.08)} />
      <path d="M4 40l21-9 21 9z" {...D(0.14)} />
      <path d="M2 44h46v2H2z" {...L(0.2)} />
      <path
        d="M8 70V54a4 4 0 0 1 8 0v16zM21 70V54a4 4 0 0 1 8 0v16zM34 70V54a4 4 0 0 1 8 0v16z"
        {...D(0.28)}
      />
      <path d="M6 70V48M18.5 70V48M31.5 70V48M44 70V48" {...line(0.3, 1.2)} />
      <circle cx="25" cy="39" r="2.2" {...L(0.28)} />
      <path d="M0 68h50v2H0z" {...L(0.16)} />
      <Sparkle x={25} y={39} r={1} o={0.5} />
    </g>,
  ],
};

/** Stable small hash, so a card always shows the same scene. */
function pick(id: string, n: number) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % n;
}

export function CardArt({ tier, id }: { tier: number; id: string }) {
  const scenes = SCENES[tier] ?? SCENES[1];
  return (
    <svg
      className="gt-card-art"
      viewBox="0 0 50 70"
      preserveAspectRatio="xMidYMax slice"
      aria-hidden="true"
    >
      {scenes[pick(id, scenes.length)]}
    </svg>
  );
}

// Nobles: a portrait bust in silhouette, with a few different hats.
const HATS: React.ReactNode[] = [
  // Crown
  <path key="crown" d="M14 11l2-4 2.5 3L20 6l1.5 4L24 7l2 4z" />,
  // Beret with a feather
  <g key="beret">
    <ellipse cx="20" cy="10.5" rx="7.5" ry="2.8" />
    <path d="M24 9c3-4 6-5 8-5-2 2-4 4-7 6z" />
  </g>,
  // Tall merchant's hat
  <path key="tall" d="M15 11.5l1-7h8l1 7z" />,
  // Veil and circlet
  <path key="veil" d="M12.5 13c0-6 3.5-8.5 7.5-8.5s7.5 2.5 7.5 8.5l-2 9h-11z" />,
];

export function NobleArt({ id }: { id: string }) {
  return (
    <svg className="gt-noble-art" viewBox="0 0 40 40" aria-hidden="true">
      <g fill="currentColor">
        {HATS[pick(id, HATS.length)]}
        <ellipse cx="20" cy="15.5" rx="4.6" ry="5.4" />
        <path d="M8 40c0-9 5-14 12-14s12 5 12 14z" />
        <path d="M16.5 26.5l3.5 5 3.5-5" fill="none" stroke="#f6ecd7" strokeOpacity=".5" />
      </g>
    </svg>
  );
}

/** The emblem on deck backs: a cut gem inside an ornamental ring. */
export function DeckEmblem() {
  return (
    <svg className="gt-back-emblem" viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r="17" fill="none" stroke="#fff" strokeOpacity=".45" />
      <circle
        cx="20"
        cy="20"
        r="14.5"
        fill="none"
        stroke="#fff"
        strokeOpacity=".25"
        strokeDasharray="1.5 2"
      />
      <path d="M13 16h14l3.5 4.5L20 32 9.5 20.5z" fill="#fff" fillOpacity=".22" />
      <path
        d="M13 16h14l3.5 4.5L20 32 9.5 20.5zM9.5 20.5h21M16 16l-2 4.5L20 32l6-11.5-2-4.5M20 16l-3 4.5M20 16l3 4.5"
        fill="none"
        stroke="#fff"
        strokeOpacity=".7"
        strokeWidth=".8"
        strokeLinejoin="round"
      />
    </svg>
  );
}
