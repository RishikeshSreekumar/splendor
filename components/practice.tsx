'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Bookmark,
  Bot,
  Check,
  ChevronDown,
  Copy,
  Crown,
  Gauge,
  Minus,
  Play,
  Plus,
  RotateCcw,
  ScrollText,
  Settings2,
  Trophy,
  User,
  UserPlus,
  X,
} from 'lucide-react';
import type { StoredBot } from '@/src/server/store';
import type {
  PracticeSeat,
  PracticeStep,
  PracticeView,
  SeatOrder,
  SeatRating,
} from '@/src/practice/types';
import { humanSeats, INVITED_HUMAN, MAX_OPPONENTS } from '@/src/practice/types';
import {
  bagAction,
  bagSize,
  buyOptions,
  canAddGem,
  findCard,
  nobleAction,
  previewAction,
  reserveAction,
} from '@/src/practice/moves';
import type { Action, Card, Gem, Observation } from '@/src/types';
import { api, ApiRequestError, ErrorNotice, errorMessage } from './ui';
import { GameTable, type TableControls } from './table/game-table';
import { COLORS, GEMS, GEM_NAMES, Token } from './table/pieces';
import { StepText } from './table/step-text';
type Speed = 'fast' | 'normal' | 'slow';
const STEP_DELAY: Record<Speed, number> = { fast: 1300, normal: 2300, slow: 3400 };
/** Travel time for gems and cards moving between the board and a player. */
const FLIGHT_MS: Record<Speed, number> = { fast: 700, normal: 1100, slow: 1600 };
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
  /** Shown to friends at a shared table. */
  name: string;
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
/** How often a shared table checks for other players' moves while it waits. */
const POLL_MS = 2000;
/** Seat tokens of tables joined from an invite link, kept per game. */
const seatKey = (id: string) => `splendor-seat:${id}`;
function loadSeatToken(id: string): string | undefined {
  try {
    return localStorage.getItem(seatKey(id)) ?? undefined;
  } catch {
    return undefined;
  }
}
function saveSeatToken(id: string, token: string) {
  try {
    localStorage.setItem(seatKey(id), token);
  } catch {
    /* the seat lasts for this page only */
  }
}
const inviteLink = (id: string) => `${window.location.origin}/play?join=${id}`;
/** Puts the table in the address bar so a joined player's reload returns to it. */
function showTableUrl(id?: string) {
  window.history.replaceState(null, '', id ? `/play?game=${id}` : '/play');
}
/** The lobby's stand-in for an open seat; it is not a bot. */
const FRIEND = {
  id: INVITED_HUMAN,
  name: 'A friend',
  baseline: false,
} as StoredBot;
const isFriend = (b?: StoredBot) => b?.id === INVITED_HUMAN;
/** Public baselines first (easiest to strongest), then an invited friend, then own bots. */
function opponentChoices(bots: StoredBot[]) {
  const baselines = new Map<string, StoredBot>();
  for (const b of bots) if (b.baseline && !baselines.has(b.name)) baselines.set(b.name, b);
  const sorted = [...baselines.values()].sort(
    (a, b) => (LEVELS[a.name]?.rank ?? 9) - (LEVELS[b.name]?.rank ?? 9),
  );
  const own = bots.filter((b) => !b.baseline && (b.qualification ?? 'passed') === 'passed');
  return [...sorted, FRIEND, ...own];
}
export function Practice() {
  const [bots, setBots] = useState<StoredBot[]>([]);
  const [settings, setSettings] = useState<Settings>({
    opponents: [],
    order: 'first',
    speed: 'normal',
    name: '',
  });
  const [session, setSession] = useState<PracticeView>();
  /** Set while seated at someone else's table: authorizes this player's requests. */
  const [seatToken, setSeatToken] = useState<string>();
  /** A table opened from an invite link that this browser has not joined yet. */
  const [joining, setJoining] = useState<string>();
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
          name: saved.name ?? '',
        });
      })
      .catch((e) => setError(errorMessage(e)));
  }, []);
  const clearSelection = useCallback(() => {
    setTake({});
    setRet({});
    setSelectedCard(undefined);
    setSelectedDeck(undefined);
    setPaymentIndex(0);
  }, []);
  /** Shows each applied decision in turn, then settles on the server's final view. */
  const present = useCallback(
    async (next: PracticeView, from?: Observation) => {
      const token = ++playToken.current;
      const delay = STEP_DELAY[settings.speed];
      setNotices(next.notices);
      setLog((old) => [
        ...next.steps.map((step) => ({ key: `${next.id}-${step.view.decision}`, step })).reverse(),
        ...old,
      ]);
      if (next.steps.length) setAnimating(true);
      let previous = from ?? shown?.view;
      for (const [i, step] of next.steps.entries()) {
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
        // The human's move was already drawn optimistically, but only the server knows the
        // card dealt into the gap and which noble visits: hold that board before the bots move.
        else if (i < next.steps.length - 1) await sleep(FLIGHT_MS[settings.speed] + 350);
      }
      if (token !== playToken.current) return;
      setShown({ view: next.view, acting: null, fresh: new Set() });
      setAnimating(false);
    },
    [settings.speed, shown?.view],
  );
  async function start() {
    if (!settings.opponents.length) return;
    const live = session?.view;
    const hosting = Boolean(session) && !seatToken;
    if (
      hosting &&
      live?.status === 'playing' &&
      live.players[session!.humanSeat].turns >= 3 &&
      !window.confirm('Starting over abandons this game, which counts as a rated loss. Continue?')
    )
      return;
    saveSettings(settings);
    setBusy(true);
    setError('');
    playToken.current++;
    try {
      const request = (replace: boolean) =>
        api<PracticeView>('/api/play', {
          type: 'new',
          clockConfig: { initialMs: 60000, incrementMs: 1000 },
          opponents: settings.opponents,
          order: settings.order,
          name: settings.opponents.includes(INVITED_HUMAN)
            ? settings.name.trim() || 'Host'
            : undefined,
          replace,
        });
      let next: PracticeView;
      try {
        // Starting over from a table you host abandons the game it shows.
        next = await request(hosting);
      } catch (e) {
        if (
          !(e instanceof ApiRequestError && e.status === 409 && e.data.activeGameId) ||
          !window.confirm(
            'You have an unfinished game elsewhere. Abandon it (a rated loss after your third turn) and start this one?',
          )
        )
          throw e;
        next = await request(true);
      }
      clearSelection();
      setLog([]);
      setCaption(null);
      setSeatToken(undefined);
      setJoining(undefined);
      showTableUrl();
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
    // Show the human's own move right away; bot replies follow once the server answers.
    playToken.current++;
    setCaption(null);
    setShown({
      view: previewAction(session.view, action),
      acting: session.humanSeat,
      fresh: new Set(),
    });
    const landed = sleep(FLIGHT_MS[settings.speed] + 400);
    try {
      // The server applies the human's move alone and answers at once, so the board settles
      // (the card dealt into the gap, a visiting noble) without waiting for any bot.
      const mine = await api<PracticeView>('/api/play', {
        type: 'action',
        id: session.id,
        action,
        revision: session.revision,
        split: true,
        token: seatToken,
      });
      setSession(mine);
      await present(mine, session.view);
      if (mine.pending) await runBots(mine, mine.view, landed);
    } catch (e) {
      setShown(undefined);
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  /**
   * Asks the server for the bots' replies, starting at once so they compute while the
   * human's pieces are still landing, and plays them back after `ready`.
   */
  async function runBots(
    game: PracticeView,
    from: Observation,
    ready?: Promise<unknown>,
    token = seatToken,
  ) {
    const [next] = await Promise.all([
      api<PracticeView>('/api/play', {
        type: 'advance',
        id: game.id,
        revision: game.revision,
        token,
      }),
      ready,
    ]);
    setSession(next);
    await present(next, from);
  }
  /** Takes the open seat at the table from the invite link. */
  async function join(id: string) {
    setBusy(true);
    setError('');
    try {
      const name = settings.name.trim() || 'Guest';
      saveSettings({ ...settings, name });
      const game = await api<PracticeView>('/api/play', { type: 'join', id, name });
      if (game.seatToken) saveSeatToken(id, game.seatToken);
      setSeatToken(game.seatToken);
      setJoining(undefined);
      showTableUrl(id);
      setSession(game);
      setShown({ view: game.view, acting: null, fresh: new Set() });
      setSetupOpen(false);
      setNotices([`You joined as ${name}.`]);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  // One unfinished game per account: pick it up again, whether it began here or from an agent.
  // An invite link (`?join=`) or a joined table (`?game=`) opens that table instead.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const invited = params.get('join'),
      table = params.get('game') ?? invited;
    const token = table ? loadSeatToken(table) : undefined;
    if (invited && !token) {
      // Deferred like the fetch below: the server-rendered page shows the lobby first.
      void Promise.resolve(invited).then(setJoining);
      return;
    }
    const query = table
      ? `/api/play?${new URLSearchParams({ id: table, ...(token ? { token } : {}) })}`
      : '/api/play';
    if (table) showTableUrl(table);
    api<{ game: PracticeView | null }>(query)
      .then(({ game }) => {
        if (!game) return;
        setSeatToken(token);
        setSession(game);
        setShown({ view: game.view, acting: null, fresh: new Set() });
        setSetupOpen(false);
        setNotices([
          game.busy
            ? 'Resumed your unfinished game. A move is still finishing; reload in a moment.'
            : 'Resumed your unfinished game.',
        ]);
        // Left while the bots were due to move: play their replies now.
        if (game.pending && !game.busy) {
          setBusy(true);
          runBots(game, game.view, undefined, token)
            .catch((e) => setError(errorMessage(e)))
            .finally(() => setBusy(false));
        }
      })
      .catch((e) => {
        if (!table) return;
        showTableUrl();
        setError(errorMessage(e));
      });
    // Runs once on load; `runBots` only reads state through its arguments and setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // A shared table has other people at it: check for their moves (and joins) while idle.
  const shared = humanSeats(session?.seats ?? []).length > 1;
  const stalled = useRef<number>(undefined);
  useEffect(() => {
    if (!session || !shared || busy || animating || session.view.status !== 'playing') return;
    let stopped = false,
      timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const query = new URLSearchParams({
          id: session.id,
          since: String(session.revision),
          ...(seatToken ? { token: seatToken } : {}),
        });
        const { game } = await api<{ game: PracticeView | null }>(`/api/play?${query}`);
        if (stopped || !game) return;
        if (game.revision !== session.revision) {
          stalled.current = undefined;
          setSession(game);
          return void (await present(game, session.view));
        }
        if (JSON.stringify(game.seats) !== JSON.stringify(session.seats)) return setSession(game);
        if (game.pending && !game.busy) {
          // The player who moved left before the bots replied: play them from here.
          if (stalled.current === game.revision) {
            stalled.current = undefined;
            setBusy(true);
            return void (await runBots(game, game.view)
              .catch(() => {})
              .finally(() => setBusy(false)));
          }
          stalled.current = game.revision;
        }
      } catch (e) {
        if (e instanceof ApiRequestError && (e.status === 404 || e.status === 403)) {
          setError(e.status === 404 ? 'The host ended this game.' : e.message);
          return;
        }
      }
      if (!stopped) timer = setTimeout(poll, POLL_MS);
    };
    timer = setTimeout(poll, POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
    // `present` and `runBots` change identity with every shown board; the session drives this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, shared, busy, animating, seatToken]);
  const view = shown?.view ?? session?.view;
  const live = session?.view;
  const myTurn =
    !!live &&
    !busy &&
    !animating &&
    live.status === 'playing' &&
    live.currentPlayer === session!.humanSeat;
  // At a shared table every seat has a person's name; mark your own.
  const seats =
    session?.seats.map((s, i) =>
      shared && i === session.humanSeat ? { ...s, name: `${s.name} (you)` } : s,
    ) ?? [];
  const names = seats.map((s) => s.name);
  // Derived interaction state, only meaningful on the human's live turn.
  const options = myTurn && selectedCard ? buyOptions(live!, selectedCard) : [];
  const payment = options[Math.min(paymentIndex, options.length - 1)];
  const takeAction = myTurn ? bagAction(live!, 'take', take) : undefined;
  const returnAction = myTurn ? bagAction(live!, 'discard', ret) : undefined;
  const cardReserve =
    myTurn && selectedCard ? reserveAction(live!, { cardId: selectedCard }) : undefined;
  const deckReserve =
    myTurn && selectedDeck ? reserveAction(live!, { tier: selectedDeck }) : undefined;
  const discarding = myTurn && live!.phase === 'discard';
  const toReturn = discarding ? bagSize(live!.players[live!.you].tokens) - 10 - bagSize(ret) : 0;
  const selectionPanel = selectedCard ? (
    <CardPanel
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
    <ActionPanel title={`Tier ${selectedDeck} deck`} onCancel={clearSelection}>
      <p className="gt-pop-note">
        Reserve the hidden top card
        {live!.bank.gold ? ' and take 1 gold (wild).' : '. The bank has no gold left.'}
      </p>
      <div className="gt-pop-actions">
        <button
          className="gt-btn primary"
          disabled={!deckReserve}
          onClick={() => deckReserve && play(deckReserve)}
        >
          <Bookmark size={15} /> Reserve
          {live!.bank.gold > 0 && <GoldBadge />}
        </button>
      </div>
    </ActionPanel>
  ) : undefined;
  const bankPanel =
    bagSize(take) > 0 ? (
      <ActionPanel title="Take gems" onCancel={clearSelection}>
        <SelectedBag bag={take} onRemove={(g) => setTake(dec(take, g))} />
        <p className="gt-pop-note">
          {takeAction
            ? 'Ready. Click a gem again to put it back.'
            : take[GEMS.find((g) => (take[g] ?? 0) >= 2) ?? 'gold']
              ? 'Two of one color is a full take.'
              : 'Pick 3 different colors, or the same color twice (needs 4 in the bank).'}
        </p>
        <div className="gt-pop-actions">
          <button
            className="gt-btn primary"
            disabled={!takeAction}
            onClick={() => takeAction && play(takeAction)}
          >
            <Check size={15} /> Take gems <kbd>↵</kbd>
          </button>
        </div>
      </ActionPanel>
    ) : undefined;
  const handPanel = discarding ? (
    <>
      <span className="gt-status-text">
        <strong>Return {toReturn > 0 ? toReturn : 'no'} more</strong> — click your gems below.
      </span>
      <SelectedBag bag={ret} onRemove={(g) => setRet(dec(ret, g))} />
      <span className="gt-me-alert-actions">
        {bagSize(ret) > 0 && (
          <button className="gt-btn" onClick={() => setRet({})}>
            Reset
          </button>
        )}
        <button
          className="gt-btn primary"
          disabled={!returnAction}
          onClick={() => returnAction && play(returnAction)}
        >
          <Check size={15} /> Return gems
        </button>
      </span>
    </>
  ) : undefined;
  const controls: TableControls | undefined = myTurn
    ? {
        selectionPanel,
        bankPanel,
        handPanel,
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
  // While the server works, the seat to move in the shown (possibly optimistic) view is thinking.
  const thinkingSeat =
    busy && view && session && view.status === 'playing' && view.currentPlayer !== session.humanSeat
      ? view.currentPlayer
      : null;
  const finished = live?.status === 'finished' && !animating;
  if (joining && !session)
    return (
      <>
        <div className="page-heading compact">
          <div>
            <div className="eyebrow">
              <span /> A SHARED TABLE
            </div>
            <h1>You&apos;re invited.</h1>
            <p>A friend saved you a seat at their Splendor table. Pick a name and sit down.</p>
          </div>
        </div>
        <ErrorNotice error={error} />
        <form
          className="panel gt-join"
          onSubmit={(e) => {
            e.preventDefault();
            void join(joining);
          }}
        >
          <label>
            <span className="step-label">YOUR NAME</span>
            <input
              value={settings.name}
              maxLength={24}
              placeholder="Guest"
              autoFocus
              onChange={(e) => setSettings({ ...settings, name: e.target.value })}
            />
          </label>
          <button className="button primary wide" disabled={busy}>
            <UserPlus size={16} /> {busy ? 'Joining…' : 'Join the table'}
          </button>
          <button
            type="button"
            className="button secondary wide"
            onClick={() => {
              setJoining(undefined);
              showTableUrl();
            }}
          >
            Set up my own game instead
          </button>
        </form>
      </>
    );
  if (!session || !view || setupOpen)
    return (
      <>
        <div className="page-heading compact">
          <div>
            <div className="eyebrow">
              <span /> THE PRACTICE TABLE
            </div>
            <h1>Take a seat.</h1>
            <p>
              Play a full game of Splendor against bots, friends, or both. Click to play — no menus.
            </p>
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
  const tone = finished ? 'done' : myTurn ? 'mine' : 'waiting';
  const waitingFor = live && live.status === 'playing' ? session.seats[live.currentPlayer] : null;
  const openSeats = session.seats.filter((s) => s.kind === 'human' && s.open).length;
  const bannerSeat =
    animating && caption ? caption.seat : (thinkingSeat ?? (myTurn ? human : null));
  const round = Math.floor(view.turn / seats.length) + 1;
  // Re-keys the banner text whenever its message changes, so each new line eases in.
  const statusKey = [
    finished,
    animating && caption ? caption.view.decision : '',
    busy,
    thinkingSeat,
    myTurn,
    live?.phase,
    bagSize(take) > 0,
    Boolean(selectedCard || selectedDeck),
  ].join('-');
  return (
    <div className="gt-page">
      <div className={`gt-status ${tone}`} role="status" aria-live="polite">
        {bannerSeat !== null && !finished && (
          <span className={`gt-avatar tone-${bannerSeat}`} aria-hidden="true">
            <SeatAvatar seat={seats[bannerSeat]} size={15} />
          </span>
        )}
        <span className="gt-status-text" key={statusKey}>
          {finished ? (
            <ResultLine view={live!} seats={seats} human={human} />
          ) : animating && caption ? (
            <StepText step={caption} name={names[caption.seat]} />
          ) : busy ? (
            thinkingSeat !== null ? (
              <>
                <strong>{names[thinkingSeat]}</strong> is thinking
                <span className="gt-dots" aria-hidden="true" />
              </>
            ) : (
              'Setting up the table…'
            )
          ) : !myTurn ? (
            waitingFor?.kind === 'human' ? (
              waitingFor.open ? (
                <>
                  <strong>Waiting for a friend to join.</strong> Share the invite link below.
                </>
              ) : (
                <>
                  Waiting for <strong>{waitingFor.name}</strong> to move
                  <span className="gt-dots" aria-hidden="true" />
                </>
              )
            ) : (
              'Waiting…'
            )
          ) : discarding ? (
            <>
              <strong>Too many gems.</strong> Return {toReturn} from your area below.
            </>
          ) : live!.phase === 'noble' ? (
            <>
              <strong>Nobles are visiting.</strong> Pick the glowing noble you want.
            </>
          ) : bagSize(take) > 0 ? (
            <>
              <strong>Picking gems.</strong> Confirm next to the bank.
            </>
          ) : selectedCard || selectedDeck ? (
            <>
              <strong>Card selected.</strong> Choose buy or reserve next to it.
            </>
          ) : live!.legalActions.length === 0 ? (
            'You have no legal move. The game cannot continue.'
          ) : (
            <>
              <strong>Your turn.</strong> Take gems from the bank, or pick a card. Glowing cards are
              ones you can buy now.
            </>
          )}
        </span>
        <span className="gt-status-tools">
          <span className="gt-round">
            Round {round}
            {view.finalRound && <em> · final round</em>}
          </span>
          <button
            className="gt-btn ghost"
            onClick={() => setSetupOpen(true)}
            title="Change opponents or settings"
          >
            <Settings2 size={14} /> Setup
          </button>
          <button
            className="gt-btn ghost"
            onClick={start}
            disabled={busy}
            title="Restart with the same opponents"
          >
            <RotateCcw size={14} /> New game
          </button>
        </span>
      </div>
      <ErrorNotice error={error} />
      {openSeats > 0 && !finished && <InviteBar id={session.id} open={openSeats} />}
      {notices.map((n) => (
        <div className="notice" key={n}>
          {n}
        </div>
      ))}
      <GameTable
        view={view}
        seats={seats}
        focusSeat={human}
        controls={controls}
        thinkingSeat={animating ? null : thinkingSeat}
        actingSeat={shown?.acting ?? null}
        actingLabel={
          animating && caption ? <StepText step={caption} name={names[caption.seat]} /> : undefined
        }
        freshCards={shown?.fresh}
        timedSeats={new Set(seats.flatMap((s, i) => (s.kind === 'bot' ? [i] : [])))}
        flightMs={FLIGHT_MS[settings.speed]}
        aside={<GameLog log={log} names={names} />}
      />
      {finished && (
        <GameOver
          view={live!}
          seats={seats}
          human={human}
          ratings={session.ratings}
          onRematch={seatToken ? undefined : start}
          onSetup={() => setSetupOpen(true)}
          busy={busy}
        />
      )}
    </div>
  );
}
function dec(bag: Bag, g: Gem): Bag {
  const n = (bag[g] ?? 0) - 1;
  const { [g]: _, ...rest } = bag;
  return n > 0 ? { ...rest, [g]: n } : rest;
}
function GoldBadge() {
  return (
    <span className="gt-gold-badge">
      +1 <Token gem="gold" size="xs" />
    </span>
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
            title={`Put back ${GEM_NAMES[g]}`}
          />
        )),
      )}
    </span>
  );
}
function ActionPanel({
  title,
  onCancel,
  children,
}: {
  title: React.ReactNode;
  onCancel: () => void;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="gt-pop-head">
        <span>{title}</span>
        <button
          className="gt-pop-close"
          onClick={onCancel}
          aria-label="Cancel (Esc)"
          title="Cancel (Esc)"
        >
          <X size={14} />
        </button>
      </div>
      {children}
    </>
  );
}
/** Gems and counts in one line, e.g. 2× sapphire 1× gold. */
function GemLine({ bag, size = 'md' }: { bag: Partial<Record<Gem, number>>; size?: 'sm' | 'md' }) {
  return (
    <span className={`gt-gem-line ${size}`}>
      {GEMS.filter((g) => bag[g]).map((g) => (
        <span key={g} className="gt-gem-count" title={`${bag[g]} ${GEM_NAMES[g]}`}>
          <Token gem={g} size={size} />
          <b>{bag[g]}</b>
        </span>
      ))}
    </span>
  );
}
function CardPanel({
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
  const index = Math.min(paymentIndex, options.length - 1);
  const payment = options[index];
  const isMine = me.reserved.some((r) => r.card?.id === card.id);
  const discount = Object.fromEntries(
    COLORS.map((c) => [c, Math.min(card.cost[c], me.bonuses[c])]),
  ) as Partial<Record<Gem, number>>;
  const hasDiscount = COLORS.some((c) => discount[c]);
  const missing = Object.fromEntries(
    COLORS.map((c) => [c, Math.max(0, card.cost[c] - me.bonuses[c] - me.tokens[c])]),
  ) as Partial<Record<Gem, number>>;
  const missingTotal = COLORS.reduce((n, c) => n + (missing[c] ?? 0), 0);
  const short = Math.max(0, missingTotal - me.tokens.gold);
  const title = (
    <>
      Tier {card.tier} {GEM_NAMES[card.bonus]}
      {card.points > 0 && <b className="gt-pop-points"> · {card.points}★</b>}
    </>
  );
  return (
    <ActionPanel title={title} onCancel={onCancel}>
      {payment ? (
        <div className="gt-pay">
          <span className="gt-label">You pay</span>
          {GEMS.every((g) => !payment.payment[g]) ? (
            <p className="gt-pay-free">Nothing — your cards cover it all.</p>
          ) : (
            <GemLine bag={payment.payment} />
          )}
          {hasDiscount && (
            <span className="gt-pay-sub">
              Your cards save <GemLine bag={discount} size="sm" />
            </span>
          )}
          <button className="gt-btn primary block" onClick={() => onPlay(payment)}>
            <Check size={15} /> Buy{card.points > 0 ? ` · +${card.points}★` : ''} <kbd>↵</kbd>
          </button>
          {options.length > 1 && (
            <button
              className="gt-link"
              onClick={() => setPaymentIndex((index + 1) % options.length)}
              title="Choose a different way to pay, e.g. spending gold instead of colored gems"
            >
              Pay another way ({index + 1}/{options.length})
            </button>
          )}
        </div>
      ) : (
        <div className="gt-pay short">
          <span className="gt-label">
            Short by {short} gem{short === 1 ? '' : 's'}
          </span>
          <GemLine bag={missing} />
          {me.tokens.gold > 0 && (
            <span className="gt-pay-sub">
              Your {me.tokens.gold} gold covers {Math.min(me.tokens.gold, missingTotal)} of these.
            </span>
          )}
        </div>
      )}
      {!isMine && (
        <div className="gt-pop-actions">
          {reserve ? (
            <button
              className={`gt-btn ${payment ? '' : 'primary'} block`}
              onClick={() => onPlay(reserve)}
            >
              <Bookmark size={15} /> Reserve
              {view.bank.gold > 0 && <GoldBadge />}
            </button>
          ) : (
            <p className="gt-pop-note">You already hold 3 reserved cards.</p>
          )}
        </div>
      )}
    </ActionPanel>
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
    <>
      <Trophy size={16} />{' '}
      {view.winners.length > 1
        ? `Shared victory: ${view.winners.map((w) => seats[w].name).join(' & ')}`
        : won
          ? 'You won. Well played!'
          : `${seats[view.winners[0]]?.name ?? 'Nobody'} wins this game.`}
    </>
  );
}
function GameOver({
  view,
  seats,
  human,
  ratings,
  onRematch,
  onSetup,
  busy,
}: {
  view: Observation;
  seats: PracticeSeat[];
  human: number;
  ratings?: SeatRating[];
  /** Absent for a joined player: the host starts the next game. */
  onRematch?: () => void;
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
                <SeatAvatar seat={seats[i]} size={14} />
              </span>
              <strong>{seats[i].name}</strong>
              <span>
                {p.cards.length} cards · {p.nobles.length} nobles
              </span>
              <b>{p.points}★</b>
              <EloChange rating={ratings?.find((r) => r.seat === i)} />
            </li>
          ))}
        </ol>
        {!ratings && <p className="muted gt-elo-note">Ratings will update shortly.</p>}
        <div className="gt-modal-actions">
          {onRematch && (
            <button className="button primary" onClick={onRematch} disabled={busy}>
              <RotateCcw size={16} /> Rematch
            </button>
          )}
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
/** A person's initial, or a bot icon. */
function SeatAvatar({ seat, size }: { seat?: PracticeSeat; size: number }) {
  if (seat?.kind !== 'human') return <Bot size={size} />;
  if (seat.open) return <UserPlus size={size} />;
  return <>{seat.name.trim()[0]?.toUpperCase() ?? <User size={size} />}</>;
}
/** The link that seats a friend at this table, with a copy button. */
function InviteBar({ id, open }: { id: string; open: number }) {
  const [copied, setCopied] = useState(false);
  const link = inviteLink(id);
  return (
    <div className="notice gt-invite">
      <UserPlus size={15} />
      <span>
        {open === 1 ? 'One seat is' : `${open} seats are`} open. Send this link to a friend:
      </span>
      <code>{link}</code>
      <button
        className="gt-btn"
        onClick={() =>
          navigator.clipboard
            .writeText(link)
            .then(() => setCopied(true))
            .catch(() => {})
        }
      >
        {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy link'}
      </button>
    </div>
  );
}
/** Rating after the game with the change, counting up from the old rating like chess.com. */
function EloChange({ rating }: { rating?: SeatRating }) {
  const after = rating ? Math.round(rating.after) : 0;
  const before = rating ? Math.round(rating.before) : 0;
  const [shown, setShown] = useState(before);
  useEffect(() => {
    if (!rating) return;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start - 400) / 900);
      setShown(Math.round(before + (after - before) * Math.max(0, 1 - (1 - t) ** 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [rating, before, after]);
  if (!rating) return <span className="gt-elo none" />;
  const d = after - before;
  return (
    <span className="gt-elo" title={`Elo ${before} → ${after}`}>
      <strong>{shown}</strong>
      <em className={d > 0 ? 'up' : d < 0 ? 'down' : 'even'}>
        {d > 0 ? '+' : d < 0 ? '−' : '±'}
        {Math.abs(d)}
      </em>
    </span>
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
const levelOf = (b?: StoredBot) => (b?.baseline ? LEVELS[b.name] : undefined);
function LevelChip({ bot }: { bot?: StoredBot }) {
  const info = levelOf(bot);
  if (isFriend(bot)) return <span className="gt-level level-human">Human</span>;
  return (
    <span className={`gt-level level-${info?.rank ?? 'custom'}`}>{info?.label ?? 'Your bot'}</span>
  );
}
/** A listbox styled like the rest of the table, with each bot's level and play style. */
function OpponentSelect({
  label,
  value,
  choices,
  onChange,
}: {
  label: string;
  value: string;
  choices: StoredBot[];
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const listId = `${label.replace(/\W+/g, '-').toLowerCase()}-list`;
  const current = choices.find((b) => b.id === value);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const show = () => {
    setActive(
      Math.max(
        0,
        choices.findIndex((b) => b.id === value),
      ),
    );
    setOpen(true);
  };
  const pick = (i: number) => {
    if (choices[i]) onChange(choices[i].id);
    setOpen(false);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') return setOpen(false);
    if (!open && ['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
      e.preventDefault();
      return show();
    }
    if (!open) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((active + step + choices.length) % choices.length);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      pick(active);
    } else if (e.key === 'Tab') setOpen(false);
  };
  const firstOwn = choices.findIndex((b) => !b.baseline);
  return (
    <div className={`gt-select ${open ? 'open' : ''}`} ref={root}>
      <button
        type="button"
        className="gt-select-button"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKey}
      >
        <span className="gt-select-name">{current?.name ?? 'Choose an opponent'}</span>
        <LevelChip bot={current} />
        <ChevronDown size={16} className="gt-select-chevron" />
      </button>
      {open && (
        <ul className="gt-select-list" role="listbox" id={listId} aria-label={label}>
          {choices.map((b, i) => (
            <li
              key={b.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={b.id === value}
              className={`${i === active ? 'active' : ''} ${i === firstOwn && i > 0 ? 'divided' : ''}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(i)}
            >
              <span className="gt-select-row">
                <strong>{b.name}</strong>
                <LevelChip bot={b} />
                {b.id === value && <Check size={15} className="gt-select-check" />}
              </span>
              <span className="gt-select-blurb">
                {isFriend(b) ? (
                  'An open seat. Share the invite link once the game starts.'
                ) : (
                  <>
                    {levelOf(b)?.blurb ?? 'A bot you built in the workshop.'}{' '}
                    <span className="bot-elo">Elo {Math.round(b.elo ?? 1200)}</span>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
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
  return (
    <div className="gt-lobby">
      <section className="panel">
        <span className="step-label">OPPONENTS · {settings.opponents.length + 1} PLAYERS</span>
        <h2>Who are you playing?</h2>
        <p className="muted">Add bots, or choose “A friend” to leave a seat for a person.</p>
        <div className="gt-seats">
          {settings.opponents.map((id, slot) => {
            return (
              <div className="gt-seat-row" key={slot}>
                <span className={`gt-avatar tone-${slot + 1}`}>
                  {id === INVITED_HUMAN ? <User size={15} /> : <Bot size={15} />}
                </span>
                <OpponentSelect
                  label={`Opponent ${slot + 1}`}
                  value={id}
                  choices={choices}
                  onChange={(value) => {
                    const opponents = [...settings.opponents];
                    opponents[slot] = value;
                    set({ opponents });
                  }}
                />
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
      </section>
      <section className="panel">
        <span className="step-label">TABLE</span>
        <h2>Your seat</h2>
        {settings.opponents.includes(INVITED_HUMAN) && (
          <label className="gt-name">
            <span className="step-label">YOUR NAME</span>
            <input
              value={settings.name}
              maxLength={24}
              placeholder="Host"
              onChange={(e) => set({ name: e.target.value })}
            />
          </label>
        )}
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
