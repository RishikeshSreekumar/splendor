'use client';
import type { ReactNode } from 'react';
import { Bot, Clock3, Crown, Layers, Loader2, User } from 'lucide-react';
import type { Card, Color, Gem, Observation, PlayerView } from '@/src/types';
import { formatClock } from '../ui';
import { CardBack, COLORS, DevelopmentCard, GEMS, GEM_NAMES, NobleTile, Token } from './pieces';
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
}
export interface SeatLabel {
  name: string;
  kind: 'human' | 'bot';
}
export function GameTable({
  view,
  seats,
  controls,
  thinkingSeat = null,
  actingSeat = null,
  freshCards,
  timedSeats,
  aside,
}: {
  view: Observation;
  seats: SeatLabel[];
  controls?: TableControls;
  /** Seat whose decision is pending on the server. */
  thinkingSeat?: number | null;
  /** Seat whose last move is being shown. */
  actingSeat?: number | null;
  freshCards?: Set<string>;
  /** Seats that play on a clock; others show "untimed". */
  timedSeats?: Set<number>;
  aside?: ReactNode;
}) {
  const me = view.players[view.you];
  const phase = view.phase;
  const mainTurn = Boolean(controls) && phase === 'main';
  return (
    <div className="gt-layout">
      <div className="gt-play">
        <section className="gt-surface" aria-label="Game table">
          <div className="gt-nobles" aria-label="Nobles">
            {view.nobles.map((n) => {
              const eligible = controls?.eligibleNobles.has(n.id);
              return (
                <NobleTile
                  key={n.id}
                  noble={n}
                  eligible={eligible}
                  progress={me.bonuses}
                  onClick={
                    eligible && phase === 'noble' ? () => controls!.onNoble(n.id) : undefined
                  }
                />
              );
            })}
          </div>
          <div className="gt-board">
            <div className="gt-bank" aria-label="Gem bank">
              {GEMS.map((g) => {
                const picked = controls?.bankSelection[g] ?? 0;
                const can = mainTurn && g !== 'gold' && controls!.canTakeGem(g);
                return (
                  <Token
                    key={g}
                    gem={g}
                    size="lg"
                    count={view.bank[g] - picked}
                    selected={picked}
                    onClick={mainTurn && g !== 'gold' ? () => controls!.onBankGem(g) : undefined}
                    disabled={mainTurn && g !== 'gold' && !can && !picked}
                    title={
                      g === 'gold'
                        ? `${view.bank.gold} gold · gained by reserving a card`
                        : `${view.bank[g]} ${GEM_NAMES[g]} in the bank${can ? ' · click to take' : ''}`
                    }
                  />
                );
              })}
            </div>
            <div className="gt-market" aria-label="Development cards">
              {[2, 1, 0].map((t) => (
                <div className="gt-row" key={t}>
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
                  {view.market[t].map((card) => (
                    <DevelopmentCard
                      key={card.id}
                      card={card}
                      state={{
                        affordable: mainTurn && controls!.affordable.has(card.id),
                        selected: controls?.selectedCard === card.id,
                        fresh: freshCards?.has(card.id),
                      }}
                      onClick={mainTurn ? () => controls!.onCard(card) : undefined}
                    />
                  ))}
                  {Array.from({ length: 4 - view.market[t].length }, (_, i) => (
                    <div className="gt-card empty" key={`empty-${i}`} aria-hidden="true" />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </section>
        <HumanHand view={view} controls={controls} name={seats[view.you]?.name} />
      </div>
      <aside className="gt-side">
        {view.players.map((p, i) => (
          <PlayerPanel
            key={i}
            seat={i}
            player={p}
            label={seats[i] ?? { name: `Player ${i + 1}`, kind: 'bot' }}
            view={view}
            thinking={thinkingSeat === i}
            acting={actingSeat === i}
            timed={timedSeats?.has(i) ?? true}
            controls={i === view.you ? controls : undefined}
          />
        ))}
        {aside}
      </aside>
    </div>
  );
}
function HumanHand({
  view,
  controls,
  name,
}: {
  view: Observation;
  controls?: TableControls;
  name?: string;
}) {
  const me = view.players[view.you];
  if (!me.reserved.length && !controls) return null;
  return (
    <section className="gt-hand" aria-label="Your reserved cards">
      <div className="gt-hand-title">
        <Layers size={15} />{' '}
        {controls ? 'Your reserved cards' : `${name ?? 'Player'}'s reserved cards`}
        <span>{me.reserved.length}/3</span>
      </div>
      <div className="gt-hand-cards">
        {me.reserved.map((r, i) =>
          r.card ? (
            <DevelopmentCard
              key={r.card.id}
              card={r.card}
              state={{
                affordable: controls && view.phase === 'main' && controls.affordable.has(r.card.id),
                selected: controls?.selectedCard === r.card.id,
              }}
              onClick={
                controls && view.phase === 'main' ? () => controls.onCard(r.card!) : undefined
              }
            />
          ) : (
            <CardBack key={i} tier={r.tier} />
          ),
        )}
        {Array.from({ length: 3 - me.reserved.length }, (_, i) => (
          <div className="gt-card empty slot" key={`slot-${i}`}>
            <span>Reserve slot</span>
          </div>
        ))}
      </div>
    </section>
  );
}
function PlayerPanel({
  seat,
  player,
  label,
  view,
  thinking,
  acting,
  timed,
  controls,
}: {
  seat: number;
  player: PlayerView;
  label: SeatLabel;
  view: Observation;
  thinking: boolean;
  acting: boolean;
  timed: boolean;
  controls?: TableControls;
}) {
  const onTurn = view.status === 'playing' && view.currentPlayer === seat;
  const discarding = Boolean(controls) && view.phase === 'discard';
  const held = GEMS.reduce((n, g) => n + player.tokens[g], 0);
  const winner = view.status === 'finished' && view.winners.includes(seat);
  return (
    <section
      className={`gt-player ${onTurn ? 'on-turn' : ''} ${acting ? 'acting' : ''} ${seat === view.you ? 'is-you' : ''} ${winner ? 'winner' : ''}`}
      aria-label={`${label.name}: ${player.points} points`}
    >
      <header>
        <span className={`gt-avatar tone-${seat}`}>
          {label.kind === 'human' ? <User size={15} /> : <Bot size={15} />}
        </span>
        <div className="gt-player-name">
          <strong>{label.name}</strong>
          <span>
            {seat === 0 && <em className="gt-first">1st player</em>}
            {thinking ? (
              <span className="gt-thinking">
                <Loader2 size={12} className="spin" /> thinking
              </span>
            ) : timed && view.clock ? (
              <span className="gt-clock">
                <Clock3 size={12} /> {formatClock(view.clock.remainingMs[seat])}
              </span>
            ) : (
              <span className="gt-clock">untimed</span>
            )}
          </span>
        </div>
        <span className="gt-score" title={`${player.points} prestige points`}>
          {player.points}
          <small>★</small>
        </span>
      </header>
      <div className="gt-holdings">
        {COLORS.map((c: Color) => (
          <div className="gt-holding" key={c}>
            <span
              className={`gt-bonus gem-${c}`}
              title={`${player.bonuses[c]} ${GEM_NAMES[c]} cards (permanent discount)`}
            >
              {player.bonuses[c]}
            </span>
            <Token
              gem={c}
              size="sm"
              count={player.tokens[c] - (controls?.returnSelection[c] ?? 0)}
              selected={controls?.returnSelection[c]}
              onClick={discarding && player.tokens[c] ? () => controls!.onReturnGem(c) : undefined}
              disabled={discarding && !controls!.canReturnGem(c)}
              title={`${player.tokens[c]} ${GEM_NAMES[c]} tokens${discarding ? ' · click to return' : ''}`}
            />
          </div>
        ))}
        <div className="gt-holding gold">
          <span className="gt-bonus placeholder" />
          <Token
            gem="gold"
            size="sm"
            count={player.tokens.gold - (controls?.returnSelection.gold ?? 0)}
            selected={controls?.returnSelection.gold}
            onClick={
              discarding && player.tokens.gold ? () => controls!.onReturnGem('gold') : undefined
            }
            disabled={discarding && !controls!.canReturnGem('gold')}
            title={`${player.tokens.gold} gold tokens${discarding ? ' · click to return' : ''}`}
          />
        </div>
      </div>
      <footer>
        <span className={held > 10 ? 'over' : ''} title="Tokens held (limit 10)">
          {held}/10 gems
        </span>
        <span title="Reserved cards">
          <Layers size={12} /> {player.reserved.length}/3
        </span>
        <span title="Nobles">
          <Crown size={12} /> {player.nobles.length}
        </span>
        <span title="Development cards">{player.cards.length} cards</span>
      </footer>
      {seat !== view.you && player.reserved.length > 0 && (
        <div className="gt-player-reserved">
          {player.reserved.map((r, i) =>
            r.card ? (
              <DevelopmentCard key={r.card.id} card={r.card} />
            ) : (
              <CardBack key={i} tier={r.tier} small />
            ),
          )}
        </div>
      )}
    </section>
  );
}
