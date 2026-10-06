'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Bot,
  Check,
  Crown,
  Gauge,
  Minus,
  Play,
  Plus,
  RotateCcw,
  ScrollText,
  Settings2,
  Trophy,
  X,
} from 'lucide-react';
import type { StoredBot } from '@/src/server/store';
import type { PracticeSeat, PracticeStep, PracticeView, SeatOrder } from '@/src/practice/types';
import { MAX_OPPONENTS } from '@/src/practice/types';
import {
  bagAction,
  bagSize,
  buyOptions,
  canAddGem,
  findCard,
  nobleAction,
  reserveAction,
} from '@/src/practice/moves';
import type { Action, Card, Gem, Observation } from '@/src/types';
import { api, ErrorNotice, errorMessage } from './ui';
import { GameTable, type TableControls } from './table/game-table';
import { COLORS, GEMS, GEM_NAMES, Token } from './table/pieces';
import { StepText } from './table/step-text';
type Speed = 'fast' | 'normal' | 'slow';
const STEP_DELAY: Record<Speed, number> = { fast: 350, normal: 850, slow: 1500 };
const LEVELS: Record<string, { label: string; blurb: string; rank: number }> = {
  Random: { label: 'Beginner', blurb: 'Plays any legal move.', rank: 0 },
  Greedy: { label: 'Intermediate', blurb: 'Buys what it can, chases near cards.', rank: 1 },
  Strategist: {
    label: 'Advanced',
    blurb: 'Plans targets, nobles and blocks your winning card.',
    rank: 2,
  },
};
interface Settings {
  opponents: string[];
  order: SeatOrder;
  speed: Speed;
}
type Bag = Partial<Record<Gem, number>>;
interface LogEntry {
  key: string;
  step: PracticeStep;
}
const SETTINGS_KEY = 'splendor-practice-settings';
function loadSettings(): Partial<Settings> {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
  } catch {
    return {};
  }
}
function saveSettings(settings: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* settings are a convenience */
  }
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Public baselines first (easiest to strongest), then the player's own bots. */
function opponentChoices(bots: StoredBot[]) {
  const baselines = new Map<string, StoredBot>();
  for (const b of bots) if (b.baseline && !baselines.has(b.name)) baselines.set(b.name, b);
  const sorted = [...baselines.values()].sort(
    (a, b) => (LEVELS[a.name]?.rank ?? 9) - (LEVELS[b.name]?.rank ?? 9),
  );
  const own = bots.filter((b) => !b.baseline && (b.qualification ?? 'passed') === 'passed');
  return [...sorted, ...own];
}
export function Practice() {
  const [bots, setBots] = useState<StoredBot[]>([]);
  const [settings, setSettings] = useState<Settings>({
    opponents: [],
    order: 'first',
    speed: 'normal',
  });
  const [session, setSession] = useState<PracticeView>();
  const [shown, setShown] = useState<{
    view: Observation;
    acting: number | null;
    fresh: Set<string>;
  }>();
  const [caption, setCaption] = useState<PracticeStep | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [animating, setAnimating] = useState(false);
  const [notices, setNotices] = useState<string[]>([]);
  const [setupOpen, setSetupOpen] = useState(true);
  // Human selections.
  const [take, setTake] = useState<Bag>({});
  const [ret, setRet] = useState<Bag>({});
  const [selectedCard, setSelectedCard] = useState<string>();
  const [selectedDeck, setSelectedDeck] = useState<number>();
  const [paymentIndex, setPaymentIndex] = useState(0);
  const playToken = useRef(0);
  const choices = useMemo(() => opponentChoices(bots), [bots]);
  useEffect(() => {
    api<StoredBot[]>('/api/bots')
      .then((list) => {
        setBots(list);
        const options = opponentChoices(list);
        const saved = loadSettings();
        const valid = (saved.opponents ?? []).filter((id) => options.some((b) => b.id === id));
        const fallback = options.find((b) => b.name === 'Greedy' && b.baseline) ?? options[0];
        setSettings({
          opponents: valid.length ? valid : fallback ? [fallback.id] : [],
          order: saved.order ?? 'first',
          speed: saved.speed ?? 'normal',
        });
      })
      .catch((e) => setError(errorMessage(e)));
  }, []);
  const sessionId = session?.id;
  useEffect(
    () => () => {
      if (sessionId) void api('/api/play', { type: 'close', id: sessionId }).catch(() => {});
    },
    [sessionId],
  );
  const clearSelection = useCallback(() => {
    setTake({});
    setRet({});
    setSelectedCard(undefined);
    setSelectedDeck(undefined);
    setPaymentIndex(0);
  }, []);
  /** Shows each applied decision in turn, then settles on the server's final view. */
  const present = useCallback(
    async (next: PracticeView) => {
      const token = ++playToken.current;
      const delay = STEP_DELAY[settings.speed];
      setNotices(next.notices);
      setLog((old) => [
        ...next.steps.map((step) => ({ key: `${next.id}-${step.view.decision}`, step })).reverse(),
        ...old,
      ]);
      if (next.steps.length) setAnimating(true);
      let previous = shown?.view;
      for (const step of next.steps) {
        if (token !== playToken.current) return;
        const before = new Set((previous?.market ?? []).flat().map((c) => c.id));
        const fresh = new Set(
          step.view.market
            .flat()
            .map((c) => c.id)
            .filter((id) => !before.has(id)),
        );
        setShown({ view: step.view, acting: step.seat, fresh });
        setCaption(step);
        previous = step.view;
        if (step.seat !== next.humanSeat) await sleep(delay);
      }
      if (token !== playToken.current) return;
      setShown({ view: next.view, acting: null, fresh: new Set() });
      setAnimating(false);
    },
    [settings.speed, shown?.view],
  );
  async function start() {
    if (!settings.opponents.length) return;
    saveSettings(settings);
    setBusy(true);
    setError('');
    playToken.current++;
    try {
      if (session) await api('/api/play', { type: 'close', id: session.id }).catch(() => {});
      const next = await api<PracticeView>('/api/play', {
        type: 'new',
        clockConfig: { initialMs: 60000, incrementMs: 1000 },
        opponents: settings.opponents,
        order: settings.order,
      });
      clearSelection();
      setLog([]);
      setCaption(null);
      setSession(next);
      setShown(undefined);
      setSetupOpen(false);
      await present(next);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function play(action: Action) {
    if (!session) return;
    setBusy(true);
    setError('');
    clearSelection();
    try {
      const next = await api<PracticeView>('/api/play', {
        type: 'action',
        id: session.id,
        action,
        revision: session.revision,
      });
      setSession(next);
      await present(next);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const view = shown?.view ?? session?.view;
  const live = session?.view;
  const myTurn =
    !!live &&
    !busy &&
    !animating &&
    live.status === 'playing' &&
    live.currentPlayer === session!.humanSeat;
  const names = session?.seats.map((s) => s.name) ?? [];
  const seats = session?.seats ?? [];
  // Derived interaction state, only meaningful on the human's live turn.
  const options = myTurn && selectedCard ? buyOptions(live!, selectedCard) : [];
  const payment = options[Math.min(paymentIndex, options.length - 1)];
  const takeAction = myTurn ? bagAction(live!, 'take', take) : undefined;
  const returnAction = myTurn ? bagAction(live!, 'discard', ret) : undefined;
  const cardReserve =
    myTurn && selectedCard ? reserveAction(live!, { cardId: selectedCard }) : undefined;
  const deckReserve =
    myTurn && selectedDeck ? reserveAction(live!, { tier: selectedDeck }) : undefined;
  const controls: TableControls | undefined = myTurn
    ? {
        bankSelection: take,
        canTakeGem: (g) => canAddGem(live!, 'take', take, g),
        onBankGem: (g) => {
          setSelectedCard(undefined);
          setSelectedDeck(undefined);
          if (canAddGem(live!, 'take', take, g)) setTake({ ...take, [g]: (take[g] ?? 0) + 1 });
          else if (take[g]) {
            // Clicking a picked color again un-picks it when it cannot be doubled.
            const { [g]: _, ...rest } = take;
            setTake(rest);
          }
        },
        selectedCard,
        selectedDeck,
        affordable: new Set(
          live!.legalActions.flatMap((a) => (a.type === 'buy' ? [a.cardId] : [])),
        ),
        canReserve: live!.legalActions.some((a) => a.type === 'reserve'),
        onCard: (card: Card) => {
          setTake({});
          setSelectedDeck(undefined);
          setPaymentIndex(0);
          setSelectedCard(selectedCard === card.id ? undefined : card.id);
        },
        onDeck: (tier) => {
          setTake({});
          setSelectedCard(undefined);
          setSelectedDeck(selectedDeck === tier ? undefined : tier);
        },
        eligibleNobles: new Set(
          live!.legalActions.flatMap((a) => (a.type === 'noble' ? [a.nobleId] : [])),
        ),
        onNoble: (id) => {
          const action = nobleAction(live!, id);
          if (action) void play(action);
        },
        returnSelection: ret,
        canReturnGem: (g) => canAddGem(live!, 'discard', ret, g),
        onReturnGem: (g) => {
          if (canAddGem(live!, 'discard', ret, g)) setRet({ ...ret, [g]: (ret[g] ?? 0) + 1 });
        },
      }
    : undefined;
  // Keyboard: Enter confirms the obvious action, Escape clears the selection.
  const primary: Action | undefined =
    takeAction ?? returnAction ?? payment ?? deckReserve ?? undefined;
  useEffect(() => {
    if (!myTurn) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, select, textarea')) return;
      if (e.key === 'Escape') clearSelection();
      if (e.key === 'Enter' && primary) {
        e.preventDefault();
        void play(primary);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const thinkingSeat =
    busy && live && session
      ? live.currentPlayer === session.humanSeat
        ? nextBotSeat(session)
        : live.currentPlayer
      : null;
  const finished = live?.status === 'finished' && !animating;
  if (!session || !view || setupOpen)
    return (
      <>
        <div className="page-heading compact">
          <div>
            <div className="eyebrow">
              <span /> THE PRACTICE TABLE
            </div>
            <h1>Take a seat.</h1>
            <p>Play a full game of Splendor against one to three bots. Click to play — no menus.</p>
          </div>
        </div>
        <ErrorNotice error={error} />
        <Lobby
          choices={choices}
          settings={settings}
          onChange={setSettings}
          onStart={start}
          busy={busy}
          onResume={session ? () => setSetupOpen(false) : undefined}
        />
      </>
    );
  const human = session.humanSeat;
  return (
    <div className="gt-page">
      <StatusBar>
        {finished ? (
          <ResultLine view={live!} seats={seats} human={human} />
        ) : animating && caption ? (
          <span className="gt-status-text">
            <StepText step={caption} name={names[caption.seat]} />
          </span>
        ) : busy ? (
          <span className="gt-status-text">
            {thinkingSeat !== null ? (
              <>
                <strong>{names[thinkingSeat]}</strong> is thinking…
              </>
            ) : (
              'Setting up the table…'
            )}
          </span>
        ) : !myTurn ? (
          <span className="gt-status-text">Waiting…</span>
        ) : live!.phase === 'discard' ? (
          <>
            <span className="gt-status-text">
              <strong>Too many gems.</strong> Click your tokens to return{' '}
              {bagSize(live!.players[human].tokens) - 10 - bagSize(ret)} more.
            </span>
            <SelectedBag bag={ret} onRemove={(g) => setRet(dec(ret, g))} />
            <button
              className="gt-btn primary"
              disabled={!returnAction}
              onClick={() => returnAction && play(returnAction)}
            >
              <Check size={15} /> Return gems
            </button>
            {bagSize(ret) > 0 && (
              <button className="gt-btn" onClick={() => setRet({})}>
                Reset
              </button>
            )}
          </>
        ) : live!.phase === 'noble' ? (
          <span className="gt-status-text">
            <Crown size={16} /> <strong>Several nobles want to visit you.</strong> Click the one you
            want.
          </span>
        ) : bagSize(take) > 0 ? (
          <>
            <span className="gt-status-text">Take</span>
            <SelectedBag bag={take} onRemove={(g) => setTake(dec(take, g))} />
            <button
              className="gt-btn primary"
              disabled={!takeAction}
              onClick={() => takeAction && play(takeAction)}
            >
              <Check size={15} /> Take gems
            </button>
            <button className="gt-btn" onClick={clearSelection}>
              Cancel
            </button>
            {!takeAction && (
              <span className="gt-hint">
                {take[GEMS.find((g) => (take[g] ?? 0) >= 2) ?? 'gold']
                  ? 'Two of one color is a full take.'
                  : 'Pick three different colors, or click one color twice (needs 4 in the bank).'}
              </span>
            )}
          </>
        ) : selectedCard ? (
          <CardChoice
            card={findCard(live!, selectedCard)}
            view={live!}
            options={options}
            paymentIndex={paymentIndex}
            setPaymentIndex={setPaymentIndex}
            reserve={cardReserve}
            onPlay={play}
            onCancel={clearSelection}
          />
        ) : selectedDeck ? (
          <>
            <span className="gt-status-text">
              Reserve the top card of the <strong>tier {selectedDeck}</strong> deck
              {live!.bank.gold ? ' and take 1 gold' : ''}?
            </span>
            <button
              className="gt-btn primary"
              disabled={!deckReserve}
              onClick={() => deckReserve && play(deckReserve)}
            >
              <Check size={15} /> Reserve
            </button>
            <button className="gt-btn" onClick={clearSelection}>
              Cancel
            </button>
          </>
        ) : live!.legalActions.length === 0 ? (
          <span className="gt-status-text">You have no legal move. The game cannot continue.</span>
        ) : (
          <span className="gt-status-text">
            <strong>Your turn.</strong> Take gems from the bank, or click a card to buy or reserve
            it.
          </span>
        )}
      </StatusBar>
      <ErrorNotice error={error} />
      {notices.map((n) => (
        <div className="notice" key={n}>
          {n}
        </div>
      ))}
      <GameTable
        view={view}
        seats={seats}
        controls={controls}
        thinkingSeat={animating ? null : thinkingSeat}
        actingSeat={shown?.acting ?? null}
        freshCards={shown?.fresh}
        timedSeats={new Set(seats.flatMap((s, i) => (s.kind === 'bot' ? [i] : [])))}
        aside={
          <>
            <div className="gt-side-actions">
              <span>
                Round {Math.floor(view.turn / seats.length) + 1}
                {view.finalRound && <em className="gt-final"> · final round</em>}
              </span>
              <button
                className="gt-btn"
                onClick={() => setSetupOpen(true)}
                title="Change opponents or settings"
              >
                <Settings2 size={14} /> Setup
              </button>
              <button
                className="gt-btn"
                onClick={start}
                disabled={busy}
                title="Restart with the same opponents"
              >
                <RotateCcw size={14} /> New game
              </button>
            </div>
            <GameLog log={log} names={names} />
          </>
        }
      />
      {finished && (
        <GameOver
          view={live!}
          seats={seats}
          human={human}
          onRematch={start}
          onSetup={() => setSetupOpen(true)}
          busy={busy}
        />
      )}
    </div>
  );
}
function nextBotSeat(session: PracticeView): number {
  return (session.humanSeat + 1) % session.seats.length;
}
function dec(bag: Bag, g: Gem): Bag {
  const n = (bag[g] ?? 0) - 1;
  const { [g]: _, ...rest } = bag;
  return n > 0 ? { ...rest, [g]: n } : rest;
}
function StatusBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="gt-status" role="status" aria-live="polite">
      {children}
    </div>
  );
}
function SelectedBag({ bag, onRemove }: { bag: Bag; onRemove: (g: Gem) => void }) {
  return (
    <span className="gt-selected-bag">
      {GEMS.flatMap((g) =>
        Array.from({ length: bag[g] ?? 0 }, (_, i) => (
          <Token
            key={`${g}-${i}`}
            gem={g}
            size="md"
            onClick={() => onRemove(g)}
            title={`Remove ${GEM_NAMES[g]}`}
          />
        )),
      )}
    </span>
  );
}
function CardChoice({
  card,
  view,
  options,
  paymentIndex,
  setPaymentIndex,
  reserve,
  onPlay,
  onCancel,
}: {
  card?: Card;
  view: Observation;
  options: Extract<Action, { type: 'buy' }>[];
  paymentIndex: number;
  setPaymentIndex: (i: number) => void;
  reserve?: Action;
  onPlay: (a: Action) => void;
  onCancel: () => void;
}) {
  if (!card) return null;
  const me = view.players[view.you];
  const payment = options[Math.min(paymentIndex, options.length - 1)];
  const missing = COLORS.map((c) => ({
    c,
    n: Math.max(0, card.cost[c] - me.bonuses[c] - me.tokens[c]),
  })).filter((m) => m.n > 0);
  const short = Math.max(0, missing.reduce((n, m) => n + m.n, 0) - me.tokens.gold);
  return (
    <>
      {payment ? (
        <>
          <button className="gt-btn primary" onClick={() => onPlay(payment)}>
            <Check size={15} /> Buy
          </button>
          <span className="gt-status-text">paying</span>
          <span className="gt-selected-bag">
            {GEMS.every((g) => !payment.payment[g]) ? (
              <em>nothing — fully discounted</em>
            ) : (
              GEMS.filter((g) => payment.payment[g]).map((g) => (
                <span key={g} className="gt-inline-gem">
                  {payment.payment[g] > 1 && <b>{payment.payment[g]}×</b>}
                  <Token gem={g} size="sm" />
                </span>
              ))
            )}
          </span>
          {options.length > 1 && (
            <button
              className="gt-btn"
              onClick={() => setPaymentIndex((paymentIndex + 1) % options.length)}
              title="Choose a different way to pay, e.g. spending gold instead of colored gems"
            >
              Payment {Math.min(paymentIndex, options.length - 1) + 1}/{options.length}
            </button>
          )}
        </>
      ) : (
        <span className="gt-status-text">
          You need <strong>{short} more</strong>
          {missing.length > 0 && (
            <>
              {' '}
              (
              {missing.map((m, i) => (
                <span key={m.c}>
                  {i > 0 && ', '}
                  {m.n} {GEM_NAMES[m.c]}
                </span>
              ))}
              {me.tokens.gold > 0 &&
                `, gold covers ${Math.min(me.tokens.gold, short + me.tokens.gold)}`}
              )
            </>
          )}{' '}
          to buy this card.
        </span>
      )}
      {reserve && (
        <button className="gt-btn" onClick={() => onPlay(reserve)}>
          Reserve{view.bank.gold ? ' +1 gold' : ''}
        </button>
      )}
      <button className="gt-btn" onClick={onCancel}>
        <X size={14} /> Cancel
      </button>
    </>
  );
}
function ResultLine({
  view,
  seats,
  human,
}: {
  view: Observation;
  seats: PracticeSeat[];
  human: number;
}) {
  const won = view.winners.includes(human);
  return (
    <span className="gt-status-text">
      <Trophy size={16} />{' '}
      {view.winners.length > 1
        ? `Shared victory: ${view.winners.map((w) => seats[w].name).join(' & ')}`
        : won
          ? 'You won. Well played!'
          : `${seats[view.winners[0]]?.name ?? 'Nobody'} wins this game.`}
    </span>
  );
}
function GameOver({
  view,
  seats,
  human,
  onRematch,
  onSetup,
  busy,
}: {
  view: Observation;
  seats: PracticeSeat[];
  human: number;
  onRematch: () => void;
  onSetup: () => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  const ranking = view.players
    .map((p, i) => ({ p, i }))
    .sort((a, b) => b.p.points - a.p.points || a.p.cards.length - b.p.cards.length);
  const won = view.winners.includes(human);
  return (
    <div
      className="gt-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="game-over-title"
    >
      <div className="gt-modal">
        <span className="gt-modal-icon">{won ? <Trophy size={28} /> : <Crown size={28} />}</span>
        <h2 id="game-over-title">
          {view.winners.length > 1
            ? 'A shared victory'
            : won
              ? 'Victory!'
              : `${seats[view.winners[0]]?.name} wins`}
        </h2>
        <p className="muted">Ties go to the player with fewer development cards.</p>
        <ol className="gt-ranking">
          {ranking.map(({ p, i }) => (
            <li key={i} className={view.winners.includes(i) ? 'won' : ''}>
              <span className={`gt-avatar tone-${i}`}>
                {seats[i].kind === 'human' ? 'Y' : <Bot size={14} />}
              </span>
              <strong>{seats[i].name}</strong>
              <span>
                {p.cards.length} cards · {p.nobles.length} nobles
              </span>
              <b>{p.points}★</b>
            </li>
          ))}
        </ol>
        <div className="gt-modal-actions">
          <button className="button primary" onClick={onRematch} disabled={busy}>
            <RotateCcw size={16} /> Rematch
          </button>
          <button className="button secondary" onClick={onSetup}>
            <Settings2 size={16} /> Change setup
          </button>
          <button className="button secondary" onClick={() => setOpen(false)}>
            View board
          </button>
        </div>
      </div>
    </div>
  );
}
function GameLog({ log, names }: { log: LogEntry[]; names: string[] }) {
  return (
    <section className="gt-log" aria-label="Game log">
      <h3>
        <ScrollText size={14} /> Game log
      </h3>
      {log.length === 0 ? (
        <p className="muted">Moves will appear here.</p>
      ) : (
        <ol>
          {log.slice(0, 80).map(({ key, step }) => (
            <li key={key} className={`tone-border-${step.seat}`}>
              <StepText step={step} name={names[step.seat]} />
              {step.assisted && <em className="gt-assisted"> (fallback)</em>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
function Lobby({
  choices,
  settings,
  onChange,
  onStart,
  busy,
  onResume,
}: {
  choices: StoredBot[];
  settings: Settings;
  onChange: (s: Settings) => void;
  onStart: () => void;
  busy: boolean;
  onResume?: () => void;
}) {
  const set = (patch: Partial<Settings>) => onChange({ ...settings, ...patch });
  const level = (b?: StoredBot) => (b?.baseline ? LEVELS[b.name] : undefined);
  return (
    <div className="gt-lobby">
      <section className="panel">
        <span className="step-label">OPPONENTS · {settings.opponents.length + 1} PLAYERS</span>
        <h2>Who are you playing?</h2>
        <div className="gt-seats">
          {settings.opponents.map((id, slot) => {
            const bot = choices.find((b) => b.id === id);
            const info = level(bot);
            return (
              <div className="gt-seat-row" key={slot}>
                <span className={`gt-avatar tone-${slot + 1}`}>
                  <Bot size={15} />
                </span>
                <label className="sr-only" htmlFor={`opponent-${slot}`}>
                  Opponent {slot + 1}
                </label>
                <select
                  id={`opponent-${slot}`}
                  value={id}
                  onChange={(e) => {
                    const opponents = [...settings.opponents];
                    opponents[slot] = e.target.value;
                    set({ opponents });
                  }}
                >
                  {choices.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                      {level(b) ? ` — ${level(b)!.label}` : ' — your bot'}
                    </option>
                  ))}
                </select>
                <span className={`gt-level level-${info?.rank ?? 'custom'}`}>
                  {info?.label ?? 'Custom'}
                </span>
                <button
                  className="gt-btn icon"
                  aria-label={`Remove opponent ${slot + 1}`}
                  disabled={settings.opponents.length <= 1}
                  onClick={() =>
                    set({ opponents: settings.opponents.filter((_, i) => i !== slot) })
                  }
                >
                  <Minus size={14} />
                </button>
              </div>
            );
          })}
          {settings.opponents.length < MAX_OPPONENTS && choices.length > 0 && (
            <button
              className="gt-btn add"
              onClick={() =>
                set({
                  opponents: [...settings.opponents, settings.opponents.at(-1) ?? choices[0].id],
                })
              }
            >
              <Plus size={14} /> Add opponent
            </button>
          )}
        </div>
        <div className="gt-levels">
          {choices
            .filter((b) => level(b))
            .map((b) => (
              <p key={b.id}>
                <b>{b.name}</b>{' '}
                <span className={`gt-level level-${level(b)!.rank}`}>{level(b)!.label}</span>{' '}
                {level(b)!.blurb}
              </p>
            ))}
        </div>
      </section>
      <section className="panel">
        <span className="step-label">TABLE</span>
        <h2>Your seat</h2>
        <div className="segmented" role="group" aria-label="Turn order">
          {(
            [
              ['first', 'Go first'],
              ['random', 'Random'],
              ['last', 'Go last'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              className={settings.order === value ? 'current' : ''}
              onClick={() => set({ order: value })}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="step-label gt-spaced">
          <Gauge size={12} /> BOT MOVE SPEED
        </span>
        <div className="segmented" role="group" aria-label="Bot move speed">
          {(['fast', 'normal', 'slow'] as const).map((s) => (
            <button
              key={s}
              className={settings.speed === s ? 'current' : ''}
              onClick={() => set({ speed: s })}
            >
              {s[0].toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        <ul className="gt-rules">
          <li>
            <b>Take</b> 3 different gems, or 2 of one color if 4+ remain. Hold at most 10.
          </li>
          <li>
            <b>Buy</b> a card from the table or your reserve. Cards are permanent discounts.
          </li>
          <li>
            <b>Reserve</b> a card (max 3) and take 1 gold, a wildcard gem.
          </li>
          <li>
            <b>Nobles</b> visit automatically when your cards match them: +3★.
          </li>
          <li>
            At <b>15★</b> the round finishes; most points wins.
          </li>
        </ul>
        <div className="gt-lobby-actions">
          <button
            className="button primary wide"
            onClick={onStart}
            disabled={busy || !settings.opponents.length}
          >
            <Play size={16} /> {busy ? 'Starting…' : 'Start game'} <ArrowRight size={16} />
          </button>
          {onResume && (
            <button className="button secondary wide" onClick={onResume}>
              Back to current game
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
