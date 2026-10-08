'use client';
import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { Card, Gem, Noble, Observation, PlayerView } from '@/src/types';
import { CardBack, DevelopmentCard, GEMS, NobleTile, Token } from './pieces';

/**
 * A piece moving across the table, e.g. a gem from the bank to a player. `from` and `to`
 * name `data-fly` elements: `from` is looked up in the previous render, `to` in the new one.
 */
export type FlightPlan = { from: string; to: string } & (
  | { kind: 'token'; gem: Gem }
  | { kind: 'card'; card: Card }
  | { kind: 'back'; tier: number }
  | { kind: 'noble'; noble: Noble }
);

/** Every piece that moved between two consecutive views, in the order to show them. */
export function planFlights(a: Observation, b: Observation): FlightPlan[] {
  // A different game (new game, another replay): nothing moved, the table was reset.
  if (b.turn < a.turn || b.players.length !== a.players.length) return [];
  // A jump of more than a round (scrubbing a replay) would launch a long queue of pieces.
  if (b.turn - a.turn > b.players.length) return [];
  const out: FlightPlan[] = [];
  const nobles: FlightPlan[] = [];
  const ids = (p: PlayerView) => new Set(p.reserved.flatMap((r) => (r.card ? [r.card.id] : [])));
  b.players.forEach((q, seat) => {
    const p = a.players[seat];
    if (!p) return;
    // Cards first (bought or reserved), then the gems that paid for or came with them.
    const owned = new Set(p.cards.map((c) => c.id));
    for (const card of q.cards)
      if (!owned.has(card.id))
        out.push({
          kind: 'card',
          card,
          from: `card-${card.id}`,
          to: `bonus-${seat}-${card.bonus}`,
        });
    const held = ids(p);
    const newHidden = Math.max(0, q.reserved.length - p.reserved.length);
    q.reserved.forEach((r, i) => {
      if (r.card && !held.has(r.card.id)) {
        const onMarket = a.market.flat().some((c) => c.id === r.card!.id);
        out.push({
          kind: 'card',
          card: r.card,
          from: onMarket ? `card-${r.card.id}` : `deck-${r.tier}`,
          to: `card-${r.card.id}`,
        });
      } else if (!r.card && i >= q.reserved.length - newHidden) {
        out.push({ kind: 'back', tier: r.tier, from: `deck-${r.tier}`, to: `res-${seat}` });
      }
    });
    for (const g of GEMS) {
      const n = q.tokens[g] - p.tokens[g];
      for (let k = 0; k < Math.abs(n); k++)
        out.push(
          n > 0
            ? { kind: 'token', gem: g, from: `bank-${g}`, to: `tok-${seat}-${g}` }
            : { kind: 'token', gem: g, from: `tok-${seat}-${g}`, to: `bank-${g}` },
        );
    }
    const visited = new Set(p.nobles.map((n) => n.id));
    for (const noble of q.nobles)
      if (!visited.has(noble.id))
        nobles.push({ kind: 'noble', noble, from: `noble-${noble.id}`, to: `score-${seat}` });
  });
  return [...out, ...nobles];
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Flight {
  key: number;
  plan: FlightPlan;
  from: Box;
  to: Box;
  delay: number;
}
/** Page coordinates, so a scroll between two steps does not throw pieces off course. */
function measure(root: HTMLElement) {
  const boxes = new Map<string, Box>();
  root.querySelectorAll<HTMLElement>('[data-fly]').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width)
      boxes.set(el.dataset.fly!, {
        x: r.left + scrollX,
        y: r.top + scrollY,
        w: r.width,
        h: r.height,
      });
  });
  return boxes;
}

/**
 * Animates pieces from where they were to where they are now. Call on every render with
 * the plan for the latest change; `id` changes once per change.
 */
export function useFlights(
  root: RefObject<HTMLElement | null>,
  id: number | undefined,
  plans: FlightPlan[] | undefined,
  duration: number,
) {
  const [flights, setFlights] = useState<Flight[]>([]);
  const boxes = useRef(new Map<string, Box>());
  const flown = useRef(id);
  const seq = useRef(0);
  // Runs after every render: positions must be fresh for whichever render brings the next
  // change. It only sets state when `id` changes, so it cannot loop.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (!root.current) return;
    const now = measure(root.current);
    if (
      id !== flown.current &&
      plans?.length &&
      !matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      const stagger = Math.min(140, duration / 6);
      const added = plans.flatMap((plan) => {
        const from = boxes.current.get(plan.from);
        const to = now.get(plan.to);
        return from && to ? [{ plan, from, to }] : [];
      });
      setFlights((old) => [
        ...old,
        ...added.map((f, i) => ({ ...f, key: ++seq.current, delay: i * stagger })),
      ]);
    }
    flown.current = id;
    boxes.current = now;
  });
  const done = (key: number) => setFlights((old) => old.filter((f) => f.key !== key));
  return flights.length
    ? createPortal(
        <div className="gt-flights" aria-hidden="true">
          {flights.map((f) => (
            <FlyingPiece key={f.key} flight={f} duration={duration} onDone={() => done(f.key)} />
          ))}
        </div>,
        document.body,
      )
    : null;
}

function FlyingPiece({
  flight,
  duration,
  onDone,
}: {
  flight: Flight;
  duration: number;
  onDone: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { from, to, plan, delay } = flight;
  useLayoutEffect(() => {
    const el = ref.current!;
    const s = Math.min(to.w / from.w, to.h / from.h, 1.4);
    const tx = to.x + (to.w - from.w * s) / 2;
    const ty = to.y + (to.h - from.h * s) / 2;
    // Lift off the board, travel along an arc over the table, then drop into place.
    // The path is sampled by hand so the piece moves for the whole flight rather than
    // racing ahead under a single easing curve.
    const lift = 18;
    const sx = from.x;
    const sy = from.y - lift;
    const arc = Math.min(160, 40 + Math.hypot(tx - sx, ty - sy) * 0.3);
    const cx = (sx + tx) / 2;
    const cy = Math.min(sy, ty) - arc;
    const big = 1.3;
    const ease = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
    const at = (x: number, y: number, k: number) => `translate(${x}px, ${y}px) scale(${k})`;
    const frames: Keyframe[] = [
      { transform: at(from.x, from.y, 1), offset: 0 },
      { transform: at(sx, sy, big), offset: 0.14 },
    ];
    const steps = 24;
    for (let i = 1; i <= steps; i++) {
      const t = ease(i / steps);
      const u = 1 - t;
      frames.push({
        transform: at(
          u * u * sx + 2 * u * t * cx + t * t * tx,
          u * u * sy + 2 * u * t * cy + t * t * ty,
          big + (s * 1.15 - big) * t,
        ),
        offset: 0.14 + 0.72 * (i / steps),
      });
    }
    frames.push(
      { transform: at(tx, ty, s), opacity: 1, offset: 0.95 },
      { transform: at(tx, ty, s), opacity: 0, offset: 1 },
    );
    const anim = el.animate(frames, { duration, delay, easing: 'linear', fill: 'both' });
    anim.onfinish = () => {
      // Make the arrival felt: the spot the piece landed on pulses.
      document
        .querySelector<HTMLElement>(`[data-fly="${plan.to}"]`)
        ?.animate(
          [{ transform: 'scale(1)' }, { transform: 'scale(1.3)' }, { transform: 'scale(1)' }],
          { duration: 320, easing: 'ease-out' },
        );
      onDone();
    };
    return () => anim.cancel();
    // A flight is planned once; later renders must not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const style = { width: from.w, height: from.h, '--card-w': `${from.w}px` } as CSSProperties;
  return (
    <div ref={ref} className={`gt-flight ${plan.kind}`} style={style}>
      {plan.kind === 'token' ? (
        <Token gem={plan.gem} size={from.w > 40 ? 'lg' : 'md'} />
      ) : plan.kind === 'card' ? (
        <DevelopmentCard card={plan.card} />
      ) : plan.kind === 'back' ? (
        <CardBack tier={plan.tier} />
      ) : (
        <NobleTile noble={plan.noble} />
      )}
    </div>
  );
}
