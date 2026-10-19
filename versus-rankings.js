const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function accountId(value) {
  return UUID.test(String(value || '')) ? String(value).toLowerCase() : '';
}

export function recordLabel(stats) {
  return `${Number(stats?.wins || 0)}-${Number(stats?.losses || 0)}`;
}

const RATING_TIERS = [
  { name: 'Bronze', floor: 0, color: '#d7a878' },
  { name: 'Silver', floor: 1000, color: '#cbd5e1' },
  { name: 'Gold', floor: 1200, color: '#fbbf24' },
  { name: 'Platinum', floor: 1400, color: '#67e8f9' },
  { name: 'Diamond', floor: 1600, color: '#93c5fd' },
  { name: 'Master', floor: 1800, color: '#c4b5fd' },
  { name: 'Legend', floor: 2000, color: '#fda4af' }
];

export function ratingSummary(stats) {
  // Older installations can still play and display their existing Elo.
  if (stats?.rated_games == null) return null;
  const rating = Math.max(0, Number(stats.rating ?? stats.rating_after) || 0);
  const games = Math.max(0, Number(stats.rated_games) || 0);
  const provisional = games < 5;
  const tierIndex = RATING_TIERS.findLastIndex(tier => rating >= tier.floor);
  const tier = RATING_TIERS[tierIndex];
  const next = RATING_TIERS[tierIndex + 1];
  return {
    rating, games, provisional, tier: tier.name, color: provisional ? '#bfdbfe' : tier.color,
    label: provisional ? `Placements ${games}/5` : tier.name,
    progress: provisional ? games / 5 : next ? (rating - tier.floor) / (next.floor - tier.floor) : 1,
    detail: provisional ? `${5 - games} more rated ${games === 4 ? 'match' : 'matches'} to join the Elo Top 25.`
      : next ? `${next.floor - rating} Elo to ${next.name} · ${next.floor.toLocaleString()} Elo`
        : 'Highest rank reached. Keep climbing the Elo Top 25.'
  };
}

export function rankedResultText(result) {
  const delta = Number(result.rating_after) - Number(result.rating_before);
  const outcome = result.outcome === 'draw' ? 'Draw' : result.outcome === 'win' ? 'Win' : 'Loss';
  const rank = ratingSummary(result);
  let text = `${outcome} recorded · ${Number(result.rating_after).toLocaleString()} Elo (${delta >= 0 ? '+' : ''}${delta})`;
  if (rank) text += ` · ${rank.label}`;
  if (result.rating_reason === 'opponent_daily_limit') text += '. Daily Elo limit reached for this opponent; your record still counts.';
  else if (result.rating_reason === 'repeat_opponent') text += `. Half Elo for match ${Number(result.opponent_match_number)} against this opponent today.`;
  else if (result.rating_reason === 'no_correct_answers') text += '. No correct answers: record updated, Elo and placements unchanged.';
  return text;
}

export function resultSubmission(state, localId, userId) {
  userId = accountId(userId);
  if (state?.phase !== 'done' || state.questions?.length !== 5 || state.round !== 4) return null;
  const me = state.players?.find(player => player.id === localId);
  if (!me || !userId || accountId(me.userId) !== userId) return null;
  const solo = state.mode === 'practice';
  const ordered = state.players.map(player => ({ ...player, userId: accountId(player.userId) }))
    .sort((a,b) => a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0);
  if (!solo && (ordered.length !== 2 || ordered.some(player => !accountId(player.userId) || !player.username) || ordered[0].userId === ordered[1].userId)) return null;
  const answerFor = (round, player) => state.answers?.[round]?.[player.id];
  const elapsed = answer => answer ? Math.max(0, Math.min(12000, Math.round(Number(answer.elapsed) || 0))) : 12000;
  const choice = answer => answer?.choiceId == null ? null : String(answer.choiceId);
  const rounds = state.questions.map((question, round) => {
    const result = { tornado_id: String(question.answer.id) };
    if (solo) {
      const answer = answerFor(round, me);
      return { ...result, choice_id: choice(answer), elapsed_ms: elapsed(answer) };
    }
    const a = answerFor(round, ordered[0]);
    const b = answerFor(round, ordered[1]);
    return { ...result, choice_a: choice(a), elapsed_a_ms: elapsed(a), choice_b: choice(b), elapsed_b_ms: elapsed(b) };
  });
  return {
    rpc: solo ? 'versus_submit_practice' : 'versus_report_match',
    params: {
      p_match_key: String(state.matchId), p_display_name: String(me.name || 'Player').slice(0,24), p_rounds: rounds,
      ...(!solo ? { p_opponent_id: ordered.find(player => player.id !== localId).userId } : {})
    }
  };
}

export function createVersusRankings(supabase, onChange = () => {}) {
  const state = { user: null, profile: null, available: false, loading: true };
  const results = new Map();
  let outbox = [];
  let sending = null;
  let generation = 0;
  const notify = type => onChange({ type });
  const storagePrefix = userId => `utwx:versusResult:${userId}:`;
  const storageKey = (userId, key) => storagePrefix(userId) + encodeURIComponent(key);
  const persist = () => {
    if (!state.user) return;
    try {
      for (const entry of outbox) localStorage.setItem(storageKey(state.user.id,entry.params.p_match_key),JSON.stringify(entry));
    }
    catch (error) { console.warn('Could not keep a retry copy of Versus results:', error); }
  };
  const removeEntry = key => {
    outbox = outbox.filter(item => item.params.p_match_key !== key);
    try { localStorage.removeItem(storageKey(state.user.id,key)); } catch { /* The server also deduplicates retries. */ }
  };
  const message = (key, status, text, extra = {}) => {
    results.set(key, { status, text, ...extra });
    notify('result');
  };

  async function refreshProfile() {
    const userId = state.user?.id;
    if (!userId) return;
    const { data, error } = await supabase.rpc('versus_profile', { p_user_id: userId });
    if (state.user?.id !== userId) return;
    if (error) throw error;
    state.profile = data;
    state.available = true;
    notify('profile');
  }

  async function initialize() {
    const revision = ++generation;
    state.loading = true;
    notify('account');
    try {
      const { data, error } = await supabase.auth.getUser();
      if (revision !== generation) return;
      if (error && data?.user) throw error;
      state.user = data?.user || null;
      state.profile = null;
      state.available = false;
      outbox = [];
      if (state.user) {
        try {
          outbox = Object.keys(localStorage).filter(key => key.startsWith(storagePrefix(state.user.id)))
            .map(key => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } });
        }
        catch { outbox = []; }
        if (!Array.isArray(outbox)) outbox = [];
        outbox = outbox.filter(entry => entry?.params?.p_match_key && ['versus_submit_practice','versus_report_match'].includes(entry.rpc));
        try { await refreshProfile(); }
        catch (error) {
          console.warn('Shared Versus profile unavailable:', error);
          const { data: profile } = await supabase.from('profiles').select('username').eq('id',state.user.id).maybeSingle();
          if (revision !== generation) return;
          state.profile = profile ? { ...profile, user_id: state.user.id } : null;
        }
      }
    } catch (error) {
      if (revision === generation) { state.user = null; state.profile = null; state.available = false; outbox = []; }
      console.warn('Could not load Versus account:', error);
    }
    finally {
      if (revision === generation) {
        state.loading = false;
        notify('account');
        void flush();
      }
    }
  }

  async function flush() {
    if (sending || !state.user || !outbox.length) return sending;
    const userId = state.user.id;
    const entries = outbox.slice();
    sending = (async () => {
      for (const entry of entries) {
        if (state.user?.id !== userId) break;
        entry.attempted = true;
        const key = entry.params.p_match_key;
        message(key,'saving','Saving result…');
        try {
          const { data, error } = await supabase.rpc(entry.rpc, entry.params);
          if (error) throw error;
          if (state.user?.id !== userId) break;
          if (data?.status === 'pending') {
            entry.pending = true;
            message(key,'pending','Your result is submitted. Waiting for your opponent to confirm.');
          } else if (data?.status === 'conflict') {
            removeEntry(key);
            message(key,'conflict','The two match reports disagree. Record and Elo were not changed.');
          } else if (data?.status === 'saved') {
            removeEntry(key);
            const text = entry.rpc === 'versus_submit_practice'
              ? 'Score saved to the Solo Challenge leaderboard.'
              : rankedResultText(data);
            message(key,'saved',text,data);
            notify('saved');
          } else throw new Error('Unexpected result status');
          persist();
        } catch (error) {
          if (state.user?.id !== userId) break;
          entry.pending = false;
          console.warn('Could not save Versus result:', error);
          message(key,'error','Could not save your result. Retry when connected.');
          persist();
        }
      }
      if (state.user?.id === userId) {
        try { await refreshProfile(); } catch { /* The result remains saved if the profile refresh fails. */ }
      }
    })().finally(() => {
      sending = null;
      if (outbox.some(entry => !entry.attempted)) queueMicrotask(() => { void flush(); });
    });
    return sending;
  }

  function saveGame(game, localId) {
    const key = game?.matchId;
    if (!key || results.has(key)) return;
    if (!state.user || !state.profile?.username) {
      message(key,'guest','Sign in with a Tornado Database username before starting a game to save scores and ratings.');
      return;
    }
    const submission = resultSubmission(game,localId,state.user.id);
    if (!submission) {
      message(key,'unranked',game.mode === 'practice'
        ? 'This run is not linked to your current account.'
        : 'Unranked match. Both players need different signed-in accounts and Tornado Database usernames.');
      return;
    }
    const queued = outbox.find(entry => entry.params.p_match_key === key);
    if (!queued) outbox.push(submission);
    persist();
    message(key,'saving','Saving result…');
    void flush();
  }

  let ready = Promise.resolve().then(initialize);
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'INITIAL_SESSION') return;
    if (event === 'USER_UPDATED' || (session?.user?.id || null) !== (state.user?.id || null)) queueMicrotask(() => { ready = initialize(); });
  });
  window.addEventListener('online', () => { void flush(); });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { void flush(); if (state.user) void refreshProfile().catch(() => {}); }
  });
  setInterval(() => {
    if (!document.hidden && outbox.some(entry => entry.pending)) void flush();
  }, 5000);
  return {
    state, get ready() { return ready; }, saveGame, retry: flush, result: key => results.get(key),
    async leaderboard(mode) {
      const { data, error } = await supabase.rpc('versus_leaderboard', { p_mode: mode });
      if (error) throw error;
      return Array.isArray(data) ? data.slice(0,25) : [];
    }
  };
}
