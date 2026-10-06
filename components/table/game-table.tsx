'use client';
import { useState, type ReactNode } from 'react';
import { Bot, Clock3, Crown, Layers, Loader2, User } from 'lucide-react';
import type { Card, Color, Gem, Observation, PlayerView } from '@/src/types';
import { formatClock } from '../ui';
import { CardBack, DevelopmentCard, GEMS, GEM_NAMES, NobleTile, Token } from './pieces';
/** What the human may click right now. Omit for a read-only table (replays). */
export interface TableControls {
  bankSelection: Partial<Record<Gem, number>>;
  canTakeGem: (gem: Gem) => boolean;
  onBankGem: (gem: Gem) => void;
  selectedCard?: string;
  selectedDeck?: number;
  affordable: Set<string>;
  canReserve: boolean;
  onCard: (card: Card) => void;
  onDeck: (tier: number) => void;
  eligibleNobles: Set<string>;
  onNoble: (nobleId: string) => void;
  returnSelection: Partial<Record<Gem, number>>;
  canReturnGem: (gem: Gem) => boolean;
  onReturnGem: (gem: Gem) => void;
  /** Floating panel attached to the selected card or deck. */
  selectionPanel?: ReactNode;
  /** Floating panel attached to the bank while gems are being picked. */
  bankPanel?: ReactNode;
  /** Panel shown inside the player's own area, e.g. returning gems. */
  handPanel?: ReactNode;
}
export interface SeatLabel {
  name: string;
  kind: 'human' | 'bot';
}
type Placement = string;
/** Wraps a piece so a floating panel can sit right next to it. */
function Anchor({
  panel,
  placement,
  children,
}: {
  panel?: ReactNode;
  placement: Placement;
  children: ReactNode;
}) {
  return (
    <div className={`gt-anchor ${panel ? 'open' : ''}`}>
      {children}
      {panel && (
        <div className={`gt-pop ${placement}`} role="dialog" aria-label="Choose an action">
          {panel}
        </div>
      )}
    </div>
  );
}
type GemDelta = Partial<Record<Gem, number>>;
/** What changed between two consecutive views, so the table can animate who did what. */
interface Delta {
  id: number;
  bank: GemDelta;
  tokens: GemDelta[];
  bonuses: GemDelta[];
  points: number[];
  reserved: number[];
  nobles: number[];
  fresh: Set<string>;
  /** Cards that just arrived in a player's reserve. */
  newReserved: Set<string>;
}
function diffViews(a: Observation, b: Observation, id: number): Delta {
  const sub = (x: Partial<Record<Gem, number>>, y: Partial<Record<Gem, number>>) =>
    Object.fromEntries(
      GEMS.map((g) => [g, (y[g] ?? 0) - (x[g] ?? 0)]).filter(([, n]) => n),
    ) as GemDelta;
  const before = new Set(a.market.flat().map((c) => c.id));
  const per = <T,>(f: (p: PlayerView, q: PlayerView) => T) =>
    b.players.map((q, i) => (a.players[i] ? f(a.players[i], q) : f(q, q)));
  const reservedIds = (p: PlayerView) => p.reserved.flatMap((r) => (r.card ? [r.card.id] : []));
  return {
    id,
    bank: sub(a.bank, b.bank),
    tokens: per((p, q) => sub(p.tokens, q.tokens)),
    bonuses: per((p, q) => sub(p.bonuses, q.bonuses)),
    points: per((p, q) => q.points - p.points),
    reserved: per((p, q) => q.reserved.length - p.reserved.length),
    nobles: per((p, q) => q.nobles.length - p.nobles.length),
    fresh: new Set(
      b.market
        .flat()
        .map((c) => c.id)
        .filter((cid) => before.size && !before.has(cid)),
    ),
    newReserved: new Set(
      per((p, q) => reservedIds(q).filter((cid) => !reservedIds(p).includes(cid))).flat(),
    ),
  };
}
/** A floating +n / −n that rises and fades once per change. */
function DeltaBadge({ n, id, suffix = '' }: { n?: number; id?: number; suffix?: string }) {
  if (!n) return null;
  return (
    <span key={id} className={`gt-delta ${n > 0 ? 'up' : 'down'}`} aria-hidden="true">
      {n > 0 ? '+' : '−'}
      {Math.abs(n)}
      {suffix}
    </span>
  );
}
/** Market popovers open sideways, toward the board's centre, so they never leave the screen. */
const marketPlacement = (col: number, tier: number): Placement =>
  `${col <= 2 ? 'right' : 'left'} ${tier === 3 ? 'top' : tier === 2 ? 'middle' : 'bottom'}`;
export function GameTable({
  view,
  seats,
  controls,
  focusSeat,
  thinkingSeat = null,
  actingSeat = null,
  actingLabel,
  freshCards,
  timedSeats,
  aside,
}: {
  view: Observation;
  seats: SeatLabel[];
  controls?: TableControls;
  /** The seat played from this screen: drawn as a large area under the board. */
  focusSeat?: number;
  /** Seat whose decision is pending on the server. */
  thinkingSeat?: number | null;
  /** Seat whose last move is being shown. */
  actingSeat?: number | null;
  /** Short description of the move being shown, drawn as a bubble on the actor's panel. */
  actingLabel?: ReactNode;
  freshCards?: Set<string>;
  /** Seats that play on a clock; others show "untimed". */
  timedSeats?: Set<number>;
  aside?: ReactNode;
}) {
  // Diff against the previously drawn view (React's "adjust state during render" pattern).
  const [prev, setPrev] = useState(view);
  const [delta, setDelta] = useState<Delta>();
  if (prev !== view) {
    setPrev(view);
    const next = diffViews(prev, view, (delta?.id ?? 0) + 1);
    // A refill-only update (e.g. the server confirming an optimistic move) keeps the
    // running badges instead of cutting them short.
    const quiet =
      !Object.keys(next.bank).length &&
      next.tokens.every((t) => !Object.keys(t).length) &&
      next.points.every((n) => !n) &&
      next.reserved.every((n) => !n);
    setDelta(quiet && delta ? { ...delta, fresh: next.fresh } : next);
  }
  const me = view.players[view.you];
  const phase = view.phase;
  const mainTurn = Boolean(controls) && phase === 'main';
  const picking = mainTurn && GEMS.some((g) => controls!.bankSelection[g]);
  const surfaceState = controls ? 'my-turn' : focusSeat !== undefined ? 'waiting' : '';
  const panelProps = (i: number) => ({
    seat: i,
    player: view.players[i],
    label: seats[i] ?? { name: `Player ${i + 1}`, kind: 'bot' as const },
    view,
    thinking: thinkingSeat === i,
    acting: actingSeat === i,
    move: actingSeat === i ? actingLabel : undefined,
    timed: timedSeats?.has(i) ?? true,
    delta,
  });
  return (
    <div className="gt-layout">
      <div className="gt-play">
        <section className={`gt-surface ${surfaceState}`} aria-label="Game table">
          <div className="gt-nobles" aria-label="Nobles">
            {view.nobles.map((n) => {
              const eligible = controls?.eligibleNobles.has(n.id);
              return (
                <NobleTile
                  key={n.id}
                  noble={n}
                  eligible={eligible}
                  progress={focusSeat !== undefined ? me.bonuses : undefined}
                  onClick={
                    eligible && phase === 'noble' ? () => controls!.onNoble(n.id) : undefined
                  }
                />
              );
            })}
          </div>
          <div className="gt-board">
            <div className={`gt-bank ${picking ? 'picking' : ''}`} aria-label="Gem bank">
              {GEMS.map((g) => {
                const picked = controls?.bankSelection[g] ?? 0;
                const can = mainTurn && g !== 'gold' && controls!.canTakeGem(g);
                return (
                  <span className="gt-delta-host" key={g}>
                    <DeltaBadge n={delta?.bank[g]} id={delta?.id} />
                    <Token
                      gem={g}
                      size="lg"
                      count={view.bank[g] - picked}
                      selected={picked}
                      available={can}
                      onClick={mainTurn && g !== 'gold' ? () => controls!.onBankGem(g) : undefined}
                      disabled={mainTurn && g !== 'gold' && !can && !picked}
                      title={
                        g === 'gold'
                          ? `${view.bank.gold} gold · gained by reserving a card`
                          : `${view.bank[g]} ${GEM_NAMES[g]} in the bank${can ? ' · click to take' : ''}`
                      }
                    />
                  </span>
                );
              })}
              {controls?.bankPanel && (
                <div className="gt-pop side" role="dialog" aria-label="Take gems">
                  {controls.bankPanel}
                </div>
              )}
            </div>
            <div className="gt-market" aria-label="Development cards">
              {[2, 1, 0].map((t) => (
                <div className="gt-row" key={t}>
                  <Anchor
                    placement={marketPlacement(0, t + 1)}
                    panel={controls?.selectedDeck === t + 1 ? controls.selectionPanel : undefined}
                  >
                    <CardBack
                      tier={t + 1}
                      count={view.deckCounts[t]}
                      selected={controls?.selectedDeck === t + 1}
                      onClick={
                        mainTurn && controls!.canReserve && view.deckCounts[t]
                          ? () => controls!.onDeck(t + 1)
                          : undefined
                      }
                    />
                  </Anchor>
                  {view.market[t].map((card, col) => (
                    <Anchor
                      key={card.id}
                      placement={marketPlacement(col + 1, t + 1)}
                      panel={
                        controls?.selectedCard === card.id ? controls.selectionPanel : undefined
                      }
                    >
                      <DevelopmentCard
                        card={card}
                        state={{
                          affordable: mainTurn && controls!.affordable.has(card.id),
                          selected: controls?.selectedCard === card.id,
                          fresh: freshCards?.has(card.id) || delta?.fresh.has(card.id),
                          dimmed: picking,
                        }}
                        onClick={mainTurn ? () => controls!.onCard(card) : undefined}
                      />
                    </Anchor>
                  ))}
                  {Array.from({ length: 4 - view.market[t].length }, (_, i) => (
                    <div className="gt-card empty" key={`empty-${i}`} aria-hidden="true" />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </section>
        {focusSeat !== undefined && <MyArea {...panelProps(focusSeat)} controls={controls} />}
      </div>
      <aside className="gt-side">
        {focusSeat !== undefined && view.players.length > 1 && (
          <span className="gt-label">Opponents</span>
        )}
        {view.players.map((_, i) =>
          i === focusSeat ? null : <PlayerPanel key={i} {...panelProps(i)} />,
        )}
        {aside}
      </aside>
    </div>
  );
}
interface PanelProps {
  seat: number;
  player: PlayerView;
  label: SeatLabel;
  view: Observation;
  thinking: boolean;
  acting: boolean;
  timed: boolean;
  move?: ReactNode;
  delta?: Delta;
}
function MoveBubble({ move, id }: { move?: ReactNode; id?: number }) {
  if (!move) return null;
  return (
    <div className="gt-move" key={id} role="note">
      {move}
    </div>
  );
}
function SeatStatus({ seat, view, thinking, timed }: PanelProps) {
  if (thinking)
    return (
      <span className="gt-meta gt-thinking">
        <Loader2 size={12} className="spin" /> thinking…
      </span>
    );
  return (
    <span className="gt-meta">
      {seat === 0 && <em className="gt-chip">1st</em>}
      {timed && view.clock ? (
        <>
          <Clock3 size={12} /> {formatClock(view.clock.remainingMs[seat])}
        </>
      ) : (
        'untimed'
      )}
    </span>
  );
}
function Score({ points, change, id }: { points: number; change?: number; id?: number }) {
  return (
    <span className="gt-score gt-delta-host" title={`${points} prestige points`}>
      <DeltaBadge n={change} id={id} suffix="★" />
      {points}
      <small>★</small>
    </span>
  );
}
function panelClass(base: string, { seat, view, acting }: PanelProps) {
  const onTurn = view.status === 'playing' && view.currentPlayer === seat;
  const winner = view.status === 'finished' && view.winners.includes(seat);
  return [base, `seat-${seat}`, onTurn && 'on-turn', acting && 'acting', winner && 'winner']
    .filter(Boolean)
    .join(' ');
}
/** One column per color: owned cards (permanent discount) above held tokens. */
function Holdings({
  player,
  size,
  controls,
  seat,
  delta,
}: {
  player: PlayerView;
  size: 'sm' | 'md';
  controls?: TableControls;
  seat: number;
  delta?: Delta;
}) {
  const discarding = Boolean(controls);
  return (
    <div className={`gt-holdings ${size}`}>
      {GEMS.map((g) => {
        const c = g as Color;
        const picked = controls?.returnSelection[g] ?? 0;
        return (
          <div className={`gt-holding ${g === 'gold' ? 'gold' : ''}`} key={g}>
            {g === 'gold' ? (
              <span className="gt-bonus placeholder" />
            ) : (
              <span
                key={delta?.bonuses[seat]?.[c] ? `b-${delta.id}` : 'b'}
                className={`gt-bonus gem-${c} ${player.bonuses[c] ? '' : 'none'} ${delta?.bonuses[seat]?.[c] ? 'flash' : ''}`}
                title={`${player.bonuses[c]} ${GEM_NAMES[c]} cards (permanent discount)`}
              >
                <DeltaBadge n={delta?.bonuses[seat]?.[c]} id={delta?.id} />
                {player.bonuses[c]}
              </span>
            )}
            <span className="gt-delta-host">
              <DeltaBadge n={delta?.tokens[seat]?.[g]} id={delta?.id} />
              <Token
                gem={g}
                size={size === 'md' ? 'md' : 'sm'}
                count={player.tokens[g] - picked}
                selected={picked}
                empty={!player.tokens[g]}
                available={discarding && controls!.canReturnGem(g)}
                onClick={
                  discarding && player.tokens[g] ? () => controls!.onReturnGem(g) : undefined
                }
                disabled={discarding && !controls!.canReturnGem(g) && !picked}
                title={`${player.tokens[g]} ${GEM_NAMES[g]} tokens${discarding ? ' · click to return' : ''}`}
              />
            </span>
          </div>
        );
      })}
    </div>
  );
}
function Stats({ player }: { player: PlayerView }) {
  const held = GEMS.reduce((n, g) => n + player.tokens[g], 0);
  return (
    <div className="gt-stats">
      <span className={held > 10 ? 'over' : ''} title="Tokens held (limit 10)">
        <b>{held}</b>/10 gems
      </span>
      <span title="Development cards">
        <b>{player.cards.length}</b> cards
      </span>
      <span title="Reserved cards">
        <Layers size={12} /> <b>{player.reserved.length}</b>/3
      </span>
      <span title="Nobles">
        <Crown size={12} /> <b>{player.nobles.length}</b>
      </span>
    </div>
  );
}
/** The human's own seat: bigger, always under the board, with reserved cards inline. */
function MyArea(props: PanelProps & { controls?: TableControls }) {
  const { player, label, view, controls } = props;
  const mainTurn = Boolean(controls) && view.phase === 'main';
  const discarding = Boolean(controls) && view.phase === 'discard';
  return (
    <section
      className={panelClass('gt-me', props)}
      aria-label={`Your area: ${player.points} points`}
    >
      <header className="gt-me-head">
        <span className={`gt-avatar tone-${props.seat}`}>
          <User size={16} />
        </span>
        <div className="gt-player-name">
          <strong>{label.name}</strong>
          <SeatStatus {...props} />
        </div>
        <span className={`gt-turn-chip ${controls ? 'live' : ''}`}>
          {view.status === 'finished'
            ? 'Game over'
            : controls
              ? 'Your turn'
              : `Waiting for opponents`}
        </span>
        <Score
          points={player.points}
          change={props.delta?.points[props.seat]}
          id={props.delta?.id}
        />
      </header>
      <MoveBubble move={props.move} id={props.delta?.id} />
      {discarding && controls?.handPanel && <div className="gt-me-alert">{controls.handPanel}</div>}
      <div className="gt-me-body">
        <div className="gt-me-block">
          <span className="gt-label">Cards &amp; gems</span>
          <Holdings
            player={player}
            size="md"
            seat={props.seat}
            delta={props.delta}
            controls={discarding ? controls : undefined}
          />
          <Stats player={player} />
        </div>
        <div className="gt-me-block reserved">
          <span className="gt-label">
            Reserved <span className="gt-label-count">{player.reserved.length}/3</span>
          </span>
          <div className="gt-hand-cards">
            {player.reserved.map((r, i) =>
              r.card ? (
                <Anchor
                  key={r.card.id}
                  placement="above"
                  panel={controls?.selectedCard === r.card.id ? controls.selectionPanel : undefined}
                >
                  <DevelopmentCard
                    card={r.card}
                    state={{
                      affordable: mainTurn && controls!.affordable.has(r.card.id),
                      selected: controls?.selectedCard === r.card.id,
                      fresh: props.delta?.newReserved.has(r.card.id),
                    }}
                    onClick={mainTurn ? () => controls!.onCard(r.card!) : undefined}
                  />
                </Anchor>
              ) : (
                <CardBack key={i} tier={r.tier} />
              ),
            )}
            {Array.from({ length: 3 - player.reserved.length }, (_, i) => (
              <div className="gt-card empty slot" key={`slot-${i}`}>
                <span>Empty</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
function PlayerPanel(props: PanelProps) {
  const { seat, player, label, view } = props;
  return (
    <section
      className={panelClass('gt-player', props)}
      aria-label={`${label.name}: ${player.points} points`}
    >
      <header>
        <span className={`gt-avatar tone-${seat}`}>
          {label.kind === 'human' ? <User size={15} /> : <Bot size={15} />}
        </span>
        <div className="gt-player-name">
          <strong>{label.name}</strong>
          <SeatStatus {...props} />
        </div>
        <Score
          points={player.points}
          change={props.delta?.points[props.seat]}
          id={props.delta?.id}
        />
      </header>
      <MoveBubble move={props.move} id={props.delta?.id} />
      <Holdings player={player} size="sm" seat={seat} delta={props.delta} />
      <Stats player={player} />
      {player.reserved.length > 0 && (
        <div className="gt-player-reserved">
          {player.reserved.map((r, i) =>
            r.card ? (
              <DevelopmentCard
                key={r.card.id}
                card={r.card}
                state={{ fresh: props.delta?.newReserved.has(r.card.id) }}
              />
            ) : (
              <CardBack key={i} tier={r.tier} small />
            ),
          )}
        </div>
      )}
      {view.status === 'finished' && view.winners.includes(seat) && (
        <span className="gt-chip win">Winner</span>
      )}
    </section>
  );
}
