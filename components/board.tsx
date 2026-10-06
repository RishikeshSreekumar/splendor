'use client';
import { Gem, Crown, Clock3 } from 'lucide-react';
import type { Card, Observation } from '@/src/types';
import { bagLabel, formatClock } from './ui';
const colors = ['white', 'blue', 'green', 'red', 'black', 'gold'] as const;
function CardTile({ card }: { card: Card }) {
  return (
    <div className={`development-card gem-border-${card.bonus}`}>
      <div className="card-top">
        <strong>
          {card.points}
          <small> VP</small>
        </strong>
        <span className={`gem-badge gem-${card.bonus}`}>
          <Gem size={17} />
        </span>
      </div>
      <div className={`card-art art-${card.bonus}`}>
        <Gem size={34} />
        <span>{card.bonus}</span>
      </div>
      <div className="card-bottom">
        <span className="card-id">{card.id}</span>
        <div className="cost-chips">
          {Object.entries(card.cost)
            .filter(([, v]) => v)
            .map(([c, n]) => (
              <span key={c} className={`cost-chip gem-${c}`} title={`${n} ${c}`}>
                <span>{c[0].toUpperCase()}</span>
                {n}
              </span>
            ))}
        </div>
      </div>
    </div>
  );
}
export function Board({
  view,
  names = ['You', 'Greedy'],
  humanSeat,
}: {
  view: Observation;
  names?: string[];
  humanSeat?: number;
}) {
  return (
    <div className="game-board">
      <div className="player-strip">
        {view.players.map((p, i) => (
          <div
            key={i}
            className={`player-summary ${view.currentPlayer === i && view.status === 'playing' ? 'on-turn' : ''}`}
          >
            <div className="player-summary-top">
              <strong>{names[i] ?? `Player ${i + 1}`}</strong>
              <span className="points-badge">
                {p.points}
                <small> / 15</small>
              </span>
            </div>
            <div className="player-clock">
              <Clock3 size={14} />
              {i === humanSeat
                ? 'Untimed practice'
                : formatClock(view.clock?.remainingMs[i] ?? 60000)}
            </div>
            <div className="holdings">
              {colors.map((c) => (
                <span key={c} title={`${p.tokens[c]} ${c} tokens`}>
                  <i className={`tiny-gem gem-${c}`} />
                  {p.tokens[c]}
                </span>
              ))}
            </div>
            <p className="fine-print">
              {p.cards.length} developments · {p.reserved.length} reserved · {p.nobles.length}{' '}
              nobles
            </p>
            <p className="bonus-line">Bonuses: {bagLabel(p.bonuses)}</p>
          </div>
        ))}
      </div>
      <div className="noble-row">
        <span className="board-label">
          <Crown size={17} /> NOBLES
        </span>
        {view.nobles.map((n) => (
          <div className="noble" key={n.id}>
            <strong>
              3 <small>VP</small>
            </strong>
            <span>
              {Object.entries(n.cost)
                .filter(([, v]) => v)
                .map(([c, count]) => (
                  <span className={`cost-chip gem-${c}`} key={c} title={`${count} ${c} bonuses`}>
                    <span>{c[0].toUpperCase()}</span>
                    {count}
                  </span>
                ))}
            </span>
          </div>
        ))}
      </div>
      <div className="market">
        {[2, 1, 0].map((t) => (
          <div className="market-row" key={t}>
            <div className="deck">
              <span>{'•'.repeat(t + 1)}</span>
              <strong>{view.deckCounts[t]}</strong>
              <small>TIER {t + 1}</small>
            </div>
            {view.market[t].map((card) => (
              <CardTile card={card} key={card.id} />
            ))}
          </div>
        ))}
      </div>
      <div className="bank">
        <span className="board-label">THE BANK</span>
        {colors.map((c) => (
          <span key={c} className="bank-stack">
            <span className={`token gem-${c}`}>
              <Gem size={17} />
              <strong>{view.bank[c]}</strong>
            </span>
            <small>{c}</small>
          </span>
        ))}
      </div>
      {view.players[view.you].reserved.length > 0 && (
        <div className="reserved-row">
          <h3>Your reserved cards</h3>
          <div>
            {view.players[view.you].reserved.map((r, i) =>
              r.card ? (
                <CardTile key={r.card.id} card={r.card} />
              ) : (
                <span key={i}>Hidden tier {r.tier}</span>
              ),
            )}
          </div>
        </div>
      )}
    </div>
  );
}
