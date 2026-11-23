window.__ModuleLoader__.load({
  id: '@local/dsh-time-ledger',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'time-ledger';
    const API = '/dsh-time-ledger/state';
    const DATA_VERSION = 1;
    const LS_KEY = 'dsh-time-ledger:v3';
    const CLEAN_KEY = 'dsh-time-ledger:clean-v3';
    const IDLE_MS = 60 * 1000;
    const CLOSE_AFTER_MS = 15 * 60 * 1000;
    const TICK_MS = 1000;
    const SAVE_MS = 10 * 1000;
    const MIN_RECORD_MS = 60 * 1000;

    let t = (key) => key;
    let localeService = null;
    let layoutService = null;
    let listeners = new Set();
    let windowFocused = true;
    let lastInteractionAt = 0;
    let pendingStart = false;

    let state = {
      ready: false,
      sessions: [],
      current: null,
      active: false,
      suspended: true,
      pauseReason: null,
      storage: 'local',
      storagePath: '',
      saveState: 'idle',
      lastSavedAt: 0,
      errorMessage: '',
      toast: null,
      lastTickAt: 0,
      dirtyMs: 0
    };

    function publish(patch) {
      state = patch ? Object.assign({}, state, patch) : Object.assign({}, state);
      for (const listener of [...listeners]) {
        try {
          listener();
        } catch (error) {
          console.error('[time-ledger] listener crashed:', error);
        }
      }
    }

    function subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }

    function getSnapshot() {
      return state;
    }

    function useStore() {
      return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    }

    function pad2(value) {
      return String(value).padStart(2, '0');
    }

    function dayKeyOf(date) {
      return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
    }

    function dayKeyAt(timestamp) {
      return dayKeyOf(new Date(timestamp));
    }

    function monthPrefixOf(date) {
      return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
    }

    function parseDayKey(key) {
      const [year, month, day] = String(key).split('-').map(Number);
      return new Date(year, month - 1, day);
    }

    function localeId() {
      try {
        return localeService?.getSnapshot?.().active || undefined;
      } catch {
        return undefined;
      }
    }

    function intlDate(date, options) {
      try {
        return new Intl.DateTimeFormat(localeId(), options).format(date);
      } catch {
        return date.toLocaleDateString();
      }
    }

    function fmtMonthName(year, month) {
      return intlDate(new Date(year, month, 1), { month: 'long' });
    }

    function fmtDateLabel(key) {
      return intlDate(parseDayKey(key), {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        weekday: 'short'
      });
    }

    function fmtShortDate(key) {
      return intlDate(parseDayKey(key), { month: 'short', day: 'numeric' });
    }

    function fmtClock(timestamp) {
      const date = new Date(timestamp);
      return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
    }

    function fmtHms(ms) {
      const total = Math.max(0, Math.floor(ms / 1000));
      const hours = Math.floor(total / 3600);
      const minutes = Math.floor((total % 3600) / 60);
      const seconds = total % 60;
      return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
    }

    function fmtDuration(ms, detailed = false) {
      if (!Number.isFinite(ms) || ms <= 0) return `0${t('unit.sec')}`;
      const total = Math.max(1, Math.round(ms / 1000));
      if (total < 60) return `${total}${t('unit.sec')}`;
      const minutes = Math.floor(total / 60);
      const seconds = total % 60;
      if (minutes < 60) {
        return detailed && seconds > 0
          ? `${minutes}${t('unit.min')}${seconds}${t('unit.sec')}`
          : `${minutes}${t('unit.min')}`;
      }
      const hours = Math.floor(minutes / 60);
      const rest = minutes % 60;
      return rest > 0
        ? `${hours}${t('unit.hour')}${rest}${t('unit.min')}`
        : `${hours}${t('unit.hour')}`;
    }

    function weekdayLabels() {
      // 2024-01-01 is Monday, which is the first column of the calendar.
      return Array.from({ length: 7 }, (_, index) =>
        intlDate(new Date(2024, 0, 1 + index), { weekday: 'short' })
      );
    }

    function daysInMonth(year, month) {
      return new Date(year, month + 1, 0).getDate();
    }

    function monthCells(year, month) {
      const first = new Date(year, month, 1);
      const offset = (first.getDay() + 6) % 7;
      const total = daysInMonth(year, month);
      const cells = [];
      for (let index = 0; index < offset; index += 1) cells.push(null);
      for (let day = 1; day <= total; day += 1) cells.push(new Date(year, month, day));
      while (cells.length % 7 !== 0) cells.push(null);
      while (cells.length < 42) cells.push(null);
      return cells;
    }

    function normalizeSession(raw) {
      if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !raw.id) return null;
      const startedAt = Number(raw.startedAt);
      if (!Number.isFinite(startedAt) || startedAt < 0) return null;
      const activeMs = Number(raw.activeMs);
      if (!Number.isFinite(activeMs) || activeMs < 0) return null;
      const days = {};
      if (raw.days && typeof raw.days === 'object' && !Array.isArray(raw.days)) {
        for (const [key, value] of Object.entries(raw.days)) {
          const ms = Number(value);
          if (/^\d{4}-\d{2}-\d{2}$/.test(key) && Number.isFinite(ms) && ms >= 0) {
            days[key] = Math.round(ms);
          }
        }
      }
      const endedAt = raw.endedAt === null || raw.endedAt === undefined
        ? null
        : Number.isFinite(Number(raw.endedAt))
          ? Number(raw.endedAt)
          : null;
      return {
        id: raw.id,
        startedAt,
        endedAt,
        lastActiveAt: Number.isFinite(Number(raw.lastActiveAt)) ? Number(raw.lastActiveAt) : startedAt,
        activeMs: Math.round(activeMs),
        days,
        finalized: raw.finalized === true,
        updatedAt: Number.isFinite(Number(raw.updatedAt)) ? Number(raw.updatedAt) : startedAt,
        pauseReason: typeof raw.pauseReason === 'string' ? raw.pauseReason : undefined
      };
    }

    function mergeSessionLists(...lists) {
      const byId = new Map();
      for (const list of lists) {
        for (const session of list) {
          const previous = byId.get(session.id);
          if (!previous || session.updatedAt >= previous.updatedAt) byId.set(session.id, session);
        }
      }
      return [...byId.values()].sort((left, right) => left.startedAt - right.startedAt);
    }

    function consumeCleanupFlag() {
      try {
        if (window.localStorage.getItem(CLEAN_KEY) === '1') return false;
        window.localStorage.setItem(CLEAN_KEY, '1');
        return true;
      } catch {
        return false;
      }
    }

    function readLocal() {
      try {
        const parsed = JSON.parse(window.localStorage.getItem(LS_KEY) || 'null');
        if (!parsed || parsed.version !== DATA_VERSION || !Array.isArray(parsed.sessions)) {
          return { version: 0, sessions: [] };
        }
        return {
          version: DATA_VERSION,
          sessions: parsed.sessions.map(normalizeSession).filter(Boolean)
        };
      } catch {
        return { version: 0, sessions: [] };
      }
    }

    function writeLocal() {
      try {
        window.localStorage.setItem(LS_KEY, JSON.stringify({
          version: DATA_VERSION,
          updatedAt: Date.now(),
          sessions: state.sessions
        }));
      } catch {
        // Quota or a privacy mode: the Host endpoint remains the primary store.
      }
    }

    function aggregateDays(sessions) {
      const totals = new Map();
      for (const session of sessions) {
        // A visit shorter than a minute is not a record: it contributes
        // neither to the calendar nor to the daily/monthly/yearly totals.
        if ((session.activeMs || 0) < MIN_RECORD_MS) continue;
        for (const [key, ms] of Object.entries(session.days || {})) {
          totals.set(key, (totals.get(key) || 0) + ms);
        }
      }
      return totals;
    }

    function sumPrefix(totals, prefix) {
      let sum = 0;
      for (const [key, ms] of totals) if (key.startsWith(prefix)) sum += ms;
      return sum;
    }

    function sumTotal(totals) {
      let sum = 0;
      for (const ms of totals.values()) sum += ms;
      return sum;
    }

    function countPrefixDays(totals, prefix, threshold = 1) {
      let count = 0;
      for (const [key, ms] of totals) if (key.startsWith(prefix) && ms >= threshold) count += 1;
      return count;
    }

    function sessionDayMs(session, key) {
      return session.days?.[key] || 0;
    }

    function sessionEnd(session, now) {
      return session.finalized ? (session.endedAt || session.lastActiveAt || session.startedAt) : now;
    }

    function isCrossDay(session, key) {
      if (dayKeyAt(session.startedAt) !== key) return true;
      const end = session.endedAt || session.lastActiveAt;
      return end ? dayKeyAt(end) !== key : false;
    }

    function makeId(now) {
      try {
        if (window.crypto?.randomUUID) return window.crypto.randomUUID();
      } catch {
        // Fall through to the timestamp form.
      }
      return `tl-${now}-${Math.random().toString(36).slice(2, 10)}`;
    }

    const GEOMETRY_KEY = 'dsh-time-ledger:overlay-geometry:v7';
    const MIN_OVERLAY_WIDTH = 170;
    const MIN_OVERLAY_HEIGHT = 58;

    function clamp(value, minimum, maximum) {
      return Math.min(Math.max(value, minimum), maximum);
    }

    /**
     * Electron can report a CSS viewport wider than the physical screen when
     * Windows scaling and devicePixelRatio disagree. `screen.avail*` is in
     * physical pixels there, so normalize it before clamping the float window.
     */
    function visibleViewportSize() {
      const ratio = window.devicePixelRatio || 1;
      const screenWidth = window.screen?.availWidth || window.innerWidth;
      const screenHeight = window.screen?.availHeight || window.innerHeight;
      const cssWidth = screenWidth > window.innerWidth * 1.05 ? screenWidth / ratio : screenWidth;
      const cssHeight = screenHeight > window.innerHeight * 1.05 ? screenHeight / ratio : screenHeight;
      // A window larger than the screen is clipped on the right/bottom; keep
      // the float inside the part of the window the user can actually see.
      const visibleWidth = cssWidth - Math.max(0, Number(window.screenX) || 0);
      const visibleHeight = cssHeight - Math.max(0, Number(window.screenY) || 0);
      return [
        Math.min(window.innerWidth, Math.max(320, visibleWidth)),
        Math.min(window.innerHeight, Math.max(240, visibleHeight))
      ];
    }

    function clampOverlayBox(box, viewportWidth = window.innerWidth, viewportHeight = window.innerHeight) {
      const availableWidth = Math.max(320, viewportWidth);
      const availableHeight = Math.max(240, viewportHeight);
      const width = clamp(box.w, MIN_OVERLAY_WIDTH, Math.max(MIN_OVERLAY_WIDTH, Math.min(460, availableWidth - 16)));
      const height = clamp(box.h, MIN_OVERLAY_HEIGHT, Math.max(MIN_OVERLAY_HEIGHT, Math.min(300, availableHeight - 16)));
      return {
        x: clamp(box.x, 8, Math.max(8, availableWidth - width - 8)),
        y: clamp(box.y, 8, Math.max(8, availableHeight - height - 8)),
        w: width,
        h: height
      };
    }

    function defaultOverlayBox(viewportWidth = window.innerWidth, viewportHeight = window.innerHeight) {
      return clampOverlayBox({
        x: viewportWidth - 210 - 26,
        y: viewportHeight - 82 - 26,
        w: 210,
        h: 82
      }, viewportWidth, viewportHeight);
    }

    function readSavedOverlayBox() {
      try {
        const saved = JSON.parse(window.localStorage.getItem(GEOMETRY_KEY) || 'null');
        if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)
          && Number.isFinite(saved.w) && Number.isFinite(saved.h)) {
          return saved;
        }
      } catch {
        // Ignore a corrupt preference.
      }
      return null;
    }

    function writeOverlayBox(box, manual = false) {
      try {
        window.localStorage.setItem(GEOMETRY_KEY, JSON.stringify({
          x: box.x,
          y: box.y,
          w: box.w,
          h: box.h,
          manual: Boolean(manual)
        }));
      } catch {
        // Geometry is a convenience; losing it must not break the timer.
      }
    }

    function addActiveTime(current, now, delta) {
      if (delta <= 0) return;
      const key = dayKeyAt(now);
      const value = Math.min(delta, 2000);
      current.activeMs += value;
      current.days[key] = (current.days[key] || 0) + value;
      current.lastActiveAt = now;
      current.updatedAt = now;
      state.dirtyMs += value;
    }

    function ensureSession(now) {
      if (state.current) return state.current;
      const session = {
        id: makeId(now),
        startedAt: now,
        endedAt: null,
        lastActiveAt: now,
        activeMs: 0,
        days: {},
        finalized: false,
        updatedAt: now
      };
      state.current = session;
      state.sessions = [...state.sessions, session];
      state.active = true;
      state.suspended = false;
      state.pauseReason = null;
      state.toast = null;
      state.lastTickAt = now;
      state.dirtyMs = 0;
      publish();
      writeLocal();
      return session;
    }

    function computeActive(now) {
      return Boolean(
        state.current
        && !state.suspended
        && document.visibilityState === 'visible'
        && windowFocused
        && now - lastInteractionAt < IDLE_MS
      );
    }

    function noteActivity() {
      const now = Date.now();
      if (document.visibilityState !== 'visible') return;
      windowFocused = true;
      lastInteractionAt = now;
      state.suspended = false;
      if (!state.ready) {
        pendingStart = true;
        return;
      }
      if (!state.current) {
        ensureSession(now);
        return;
      }
      if (!state.active) {
        state.active = true;
        state.pauseReason = null;
        state.lastTickAt = now;
        state.dirtyMs = 0;
        publish();
      }
    }

    function pause(reason) {
      state.suspended = true;
      if (!state.current) {
        if (state.active) {
          state.active = false;
          publish();
        }
        return;
      }
      const wasActive = state.active;
      state.active = false;
      state.pauseReason = reason;
      if (wasActive) {
        const now = Date.now();
        state.current.lastActiveAt = now;
        state.current.updatedAt = now;
        publish();
        void saveSession(state.current, false);
      }
    }

    function finalizeCurrent(reason, options = {}) {
      const current = state.current;
      if (!current) return;
      const now = Date.now();
      const wasActive = state.active;
      if (wasActive) addActiveTime(current, now, Math.min(now - (state.lastTickAt || now), 2000));
      current.endedAt = current.lastActiveAt || now;
      current.finalized = true;
      current.updatedAt = now;
      current.pauseReason = reason;
      state.current = null;
      state.active = false;
      state.suspended = true;
      state.pauseReason = reason;
      state.dirtyMs = 0;

      if (current.activeMs < MIN_RECORD_MS) {
        state.sessions = state.sessions.filter((session) => session.id !== current.id);
        state.toast = null;
        writeLocal();
        publish();
        return;
      }

      state.toast = { id: now, until: now + 4200, ms: current.activeMs };
      writeLocal();
      publish();
      saveSession(current, Boolean(options.beacon));
    }

    function saveSession(session, beacon) {
      if (!session) return;
      // Do not persist a visit until it has lasted a full minute. This also
      // keeps a short failed start out of the Host file, so a later hydrate
      // cannot resurrect it.
      if ((session.activeMs || 0) < MIN_RECORD_MS) return;
      writeLocal();
      const body = JSON.stringify({ session });
      if (beacon) {
        let sent = false;
        try {
          if (navigator.sendBeacon) {
            sent = navigator.sendBeacon(API, new Blob([body], { type: 'application/json' }));
          }
        } catch {
          sent = false;
        }
        if (!sent) {
          try {
            void fetch(API, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body,
              keepalive: true,
              credentials: 'same-origin'
            });
          } catch {
            // Nothing else can run during teardown.
          }
        }
        return;
      }

      state.saveState = 'saving';
      fetch(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        credentials: 'same-origin'
      })
        .then(async (response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const payload = await response.json().catch(() => null);
          state.saveState = 'saved';
          state.lastSavedAt = Date.now();
          state.storage = 'profile';
          if (payload?.storage) state.storagePath = payload.storage;
          state.errorMessage = '';
          publish();
        })
        .catch((error) => {
          state.saveState = 'error';
          state.errorMessage = String(error?.message || error);
          publish();
        });
    }

    function saveCurrent(beacon) {
      if (state.current) saveSession(state.current, beacon);
    }

    function uploadSessions(sessions) {
      if (!sessions.length) return;
      writeLocal();
      fetch(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessions }),
        credentials: 'same-origin'
      })
        .then(async (response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const payload = await response.json().catch(() => null);
          state.saveState = 'saved';
          state.lastSavedAt = Date.now();
          state.storage = 'profile';
          if (payload?.storage) state.storagePath = payload.storage;
          state.errorMessage = '';
          publish();
        })
        .catch((error) => {
          state.saveState = 'error';
          state.errorMessage = String(error?.message || error);
          publish();
        });
    }

    async function hydrate() {
      const cleanOnce = consumeCleanupFlag();
      const local = cleanOnce ? { version: 0, sessions: [] } : readLocal();
      let remote = null;
      try {
        const response = await fetch(API, { method: 'GET', cache: 'no-store', credentials: 'same-origin' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        if (!payload || !Array.isArray(payload.sessions)) throw new Error('invalid payload');
        remote = payload;
      } catch (error) {
        state.errorMessage = String(error?.message || error);
      }
      if (remote && (remote.version !== DATA_VERSION || cleanOnce)) remote = null;

      let merged = mergeSessionLists(local.sessions, remote?.sessions || [])
        .filter((session) => !session.id.startsWith('debug|'))
        .filter((session) => (session.activeMs || 0) >= MIN_RECORD_MS);
      const stale = [];
      const now = Date.now();
      merged = merged.filter((session) => {
        if (session.finalized) return true;
        if (session.activeMs < MIN_RECORD_MS) return false;
        session.finalized = true;
        session.endedAt = session.lastActiveAt || session.startedAt || now;
        session.updatedAt = now;
        session.pauseReason = 'stale';
        stale.push(session);
        return true;
      });

      state.sessions = merged;
      state.ready = true;
      state.storage = remote ? 'profile' : 'local';
      state.storagePath = remote?.storage || '';
      state.saveState = remote ? 'saved' : 'idle';
      publish();
      writeLocal();

      const remoteById = new Map((remote?.sessions || []).map((session) => [session.id, session]));
      const upload = merged.filter((session) => {
        if (!session.finalized) return false;
        const previous = remoteById.get(session.id);
        return !previous || session.updatedAt > previous.updatedAt;
      });
      if (upload.length) uploadSessions(upload);

      if (pendingStart && Date.now() - lastInteractionAt < IDLE_MS) {
        pendingStart = false;
        ensureSession(Date.now());
      }

      if (stale.length) {
        // The stale records are included in `upload` above.
      }
    }

    function tick() {
      const now = Date.now();
      if (!state.ready) return;
      if (state.toast && now > state.toast.until) {
        state.toast = null;
        publish();
      }

      const current = state.current;
      if (!current) {
        if (state.active) {
          state.active = false;
          publish();
        }
        return;
      }

      if (computeActive(now)) {
        const delta = Math.max(0, Math.min(now - (state.lastTickAt || now), 2000));
        addActiveTime(current, now, delta);
        state.active = true;
        state.pauseReason = null;
        state.lastTickAt = now;
        publish();
        if (state.dirtyMs >= SAVE_MS) {
          state.dirtyMs = 0;
          saveCurrent(false);
        }
        return;
      }

      if (state.active) {
        state.active = false;
        state.pauseReason = now - lastInteractionAt >= IDLE_MS ? 'idle' : 'blur';
        state.suspended = true;
        current.lastActiveAt = current.lastActiveAt || now;
        current.updatedAt = now;
        publish();
        saveCurrent(false);
      }

      if (now - (current.lastActiveAt || now) >= CLOSE_AFTER_MS) {
        finalizeCurrent('idle');
      }
    }

    function openPanel() {
      try {
        layoutService?.selectPanel?.('time-ledger');
      } catch (error) {
        console.warn('[time-ledger] cannot open panel:', error);
      }
    }

    function StatCard({ label, value, sub, accent }) {
      return h('div', { className: `tl-stat${accent ? ' is-accent' : ''}` },
        h('div', { className: 'tl-stat-label' }, label),
        h('div', { className: 'tl-stat-value' }, value),
        sub ? h('div', { className: 'tl-stat-sub' }, sub) : null
      );
    }

    function EmptyState({ title, body }) {
      return h('div', { className: 'tl-empty' },
        h('div', { className: 'tl-empty-mark', 'aria-hidden': true },
          h('svg', { width: 30, height: 30, viewBox: '0 0 24 24', fill: 'none' },
            h('rect', { x: 3.5, y: 4.5, width: 17, height: 16, rx: 3, stroke: 'currentColor', strokeWidth: 1.5 }),
            h('path', { d: 'M3.5 9h17M8 3v3M16 3v3', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }),
            h('path', { d: 'M12 12.5v3l2 1.2', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' })
          )
        ),
        h('div', { className: 'tl-empty-title' }, title),
        body ? h('div', { className: 'tl-empty-body' }, body) : null
      );
    }

    function YearView({ year, totals, sessions, onYear, onOpenMonth }) {
      const today = new Date();
      const months = Array.from({ length: 12 }, (_, index) => {
        const prefix = `${year}-${pad2(index + 1)}`;
        return {
          index,
          ms: sumPrefix(totals, prefix),
          count: sessions.filter((session) =>
            Object.keys(session.days || {}).some((key) => key.startsWith(prefix))
          ).length
        };
      });
      const max = Math.max(1, ...months.map((month) => month.ms));
      const yearPrefix = `${year}-`;
      const yearMs = sumPrefix(totals, yearPrefix);
      const activeDays = countPrefixDays(totals, yearPrefix);
      const yearSessions = sessions.filter((session) => dayKeyAt(session.startedAt).startsWith(yearPrefix)).length;

      return h('section', { className: 'tl-section' },
        h('div', { className: 'tl-section-head' },
          h('div', null,
            h('div', { className: 'tl-kicker' }, t('year.kicker')),
            h('h2', { className: 'tl-section-title' }, t('year.title', { year }))
          ),
          h('div', { className: 'tl-nav' },
            h('button', { type: 'button', className: 'tl-nav-btn', onClick: () => onYear(year - 1), 'aria-label': t('common.prev') }, '‹'),
            h('button', { type: 'button', className: 'tl-nav-btn', onClick: () => onYear(year + 1), 'aria-label': t('common.next') }, '›')
          )
        ),
        h('div', { className: 'tl-year-facts' },
          h('div', { className: 'tl-fact' }, h('span', null, t('stats.total')), h('strong', null, fmtDuration(yearMs))),
          h('div', { className: 'tl-fact' }, h('span', null, t('year.activeDays')), h('strong', null, String(activeDays))),
          h('div', { className: 'tl-fact' }, h('span', null, t('year.sessions')), h('strong', null, String(yearSessions)))
        ),
        h('div', { className: 'tl-year-grid' }, months.map((month) => {
          const isNow = today.getFullYear() === year && today.getMonth() === month.index;
          return h('button', {
            key: month.index,
            type: 'button',
            className: `tl-year-card${isNow ? ' is-current' : ''}`,
            onClick: () => onOpenMonth(month.index)
          },
            h('div', { className: 'tl-year-card-top' },
              h('span', { className: 'tl-year-month' }, fmtMonthName(year, month.index)),
              h('span', { className: 'tl-year-ms' }, fmtDuration(month.ms))
            ),
            h('div', { className: 'tl-year-bar', 'aria-hidden': true },
              h('i', { style: { width: `${month.ms > 0 ? Math.max(3, Math.round((month.ms / max) * 100)) : 0}%` } })
            ),
            h('div', { className: 'tl-year-card-foot' }, t('year.recordCount', { count: month.count }))
          );
        }))
      );
    }

    function MonthView({
      year,
      month,
      totals,
      sessions,
      selectedDay,
      onMonth,
      onToday,
      onSelectDay
    }) {
      const todayKey = dayKeyAt(Date.now());
      const prefix = `${year}-${pad2(month + 1)}`;
      const monthMs = sumPrefix(totals, prefix);
      const activeDays = countPrefixDays(totals, prefix);
      const cells = monthCells(year, month);
      const max = Math.max(1, ...cells.filter(Boolean).map((date) => totals.get(dayKeyOf(date)) || 0));
      const selectedMs = selectedDay ? (totals.get(selectedDay) || 0) : 0;
      const daySessions = selectedDay
        ? sessions
            .filter((session) => sessionDayMs(session, selectedDay) > 0)
            .filter((session) => (session.activeMs || 0) >= MIN_RECORD_MS)
            .sort((left, right) => left.startedAt - right.startedAt)
        : [];

      return h('section', { className: 'tl-section' },
        h('div', { className: 'tl-section-head' },
          h('div', null,
            h('div', { className: 'tl-kicker' }, t('month.kicker')),
            h('h2', { className: 'tl-section-title' }, t('month.title', { year, month: fmtMonthName(year, month) })),
            h('div', { className: 'tl-section-sub' },
              `${t('stats.total')} ${fmtDuration(monthMs)} · ${t('year.activeDays')} ${activeDays}`
            )
          ),
          h('div', { className: 'tl-nav' },
            h('button', { type: 'button', className: 'tl-nav-btn', onClick: () => onMonth(-1), 'aria-label': t('common.prev') }, '‹'),
            h('button', { type: 'button', className: 'tl-nav-btn', onClick: onToday }, t('month.today')),
            h('button', { type: 'button', className: 'tl-nav-btn', onClick: () => onMonth(1), 'aria-label': t('common.next') }, '›')
          )
        ),
        h('div', { className: 'tl-calendar' },
          weekdayLabels().map((label, index) => h('div', { key: `w-${index}`, className: 'tl-weekday' }, label)),
          cells.map((date, index) => {
            if (!date) return h('div', { key: `b-${index}`, className: 'tl-day-blank', 'aria-hidden': true });
            const key = dayKeyOf(date);
            const ms = totals.get(key) || 0;
            const isToday = key === todayKey;
            const isSelected = key === selectedDay;
            return h('button', {
              key,
              type: 'button',
              className: `tl-day${isToday ? ' is-today' : ''}${isSelected ? ' is-selected' : ''}${ms > 0 ? ' has-time' : ''}`,
              onClick: () => onSelectDay(key),
              'aria-label': `${fmtDateLabel(key)} ${fmtDuration(ms)}`,
              style: ms > 0
                ? {
                    background: `color-mix(in srgb, var(--dsw-alias-brand-primary, #2f6bff) ${8 + Math.round((ms / max) * 30)}%, var(--dsw-alias-bg-layer-1, #f7f8fa))`
                  }
                : undefined
            },
              h('span', { className: 'tl-day-num' }, String(date.getDate())),
              ms > 0 ? h('span', { className: 'tl-day-ms' }, fmtDuration(ms)) : null
            );
          })
        ),
        h('div', { className: 'tl-day-detail' },
          selectedDay
            ? h('div', { className: 'tl-detail-head' },
                h('div', null,
                  h('div', { className: 'tl-detail-date' }, fmtDateLabel(selectedDay)),
                  h('div', { className: 'tl-detail-total' }, `${t('stats.total')} ${fmtDuration(selectedMs)}`)
                ),
                h('span', { className: 'tl-detail-count' }, t('month.sessionCount', { count: daySessions.length }))
              )
            : null,
          selectedDay
            ? (daySessions.length
                ? h('div', { className: 'tl-detail-list' }, daySessions.map((session, index) =>
                    h('div', { key: session.id, className: 'tl-detail-row' },
                      h('span', { className: 'tl-detail-index' }, `${t('session.nth', { n: index + 1 })}`),
                      h('span', { className: 'tl-detail-time' },
                        `${fmtClock(session.startedAt)} – ${fmtClock(sessionEnd(session, Date.now()))}`
                      ),
                      isCrossDay(session, selectedDay)
                        ? h('span', { className: 'tl-chip' }, t('session.crossDay'))
                        : null,
                      !session.finalized ? h('span', { className: 'tl-chip is-live' }, t('session.live')) : null,
                      h('span', { className: 'tl-detail-duration' }, fmtDuration(sessionDayMs(session, selectedDay), true))
                    )
                  ))
                : h('div', { className: 'tl-detail-empty' }, t('month.emptyDay')))
            : h('div', { className: 'tl-detail-empty' }, t('month.pickDay'))
        )
      );
    }

    function SessionsView({ sessions, currentId }) {
      const sorted = [...sessions]
        .filter((session) => session.activeMs >= MIN_RECORD_MS)
        .sort((left, right) => right.startedAt - left.startedAt);
      const groups = [];
      let group = null;
      for (const session of sorted) {
        const key = dayKeyAt(session.startedAt);
        if (!group || group.key !== key) {
          group = { key, items: [] };
          groups.push(group);
        }
        group.items.push(session);
      }
      const totalMs = sumTotal(aggregateDays(sorted));

      return h('section', { className: 'tl-section' },
        h('div', { className: 'tl-section-head' },
          h('div', null,
            h('div', { className: 'tl-kicker' }, t('session.kicker')),
            h('h2', { className: 'tl-section-title' }, t('session.title')),
            h('div', { className: 'tl-section-sub' }, `${t('session.count', { count: sorted.length })} · ${fmtDuration(totalMs)}`)
          )
        ),
        sorted.length === 0
          ? h(EmptyState, { title: t('session.none'), body: t('session.noneHint') })
          : h('div', { className: 'tl-session-groups' }, groups.map((entry) => {
              const dayMs = entry.items.reduce((sum, session) => sum + session.activeMs, 0);
              return h('div', { key: entry.key, className: 'tl-session-group' },
                h('div', { className: 'tl-group-head' },
                  h('span', { className: 'tl-group-date' }, fmtDateLabel(entry.key)),
                  h('span', { className: 'tl-group-total' }, fmtDuration(dayMs))
                ),
                entry.items.map((session, index) =>
                  h('div', { key: session.id, className: 'tl-session-row' },
                    h('span', { className: 'tl-session-index' }, t('session.nth', { n: entry.items.length - index })),
                    h('span', { className: 'tl-session-time' },
                      `${fmtClock(session.startedAt)} – ${fmtClock(sessionEnd(session, Date.now()))}`
                    ),
                    isCrossDay(session, entry.key)
                      ? h('span', { className: 'tl-chip' }, t('session.crossDay'))
                      : null,
                    !session.finalized ? h('span', { className: 'tl-chip is-live' }, t('session.live')) : null,
                    h('span', { className: 'tl-session-duration' }, fmtDuration(session.activeMs, true))
                  )
                )
              );
            }))
      );
    }

    function TimeLedgerPage() {
      const snapshot = useStore();
      const [view, setView] = React.useState('month');
      const [cursor, setCursor] = React.useState(() => new Date());
      const [selectedDay, setSelectedDay] = React.useState(() => dayKeyAt(Date.now()));

      const totals = aggregateDays(snapshot.sessions);
      const todayKey = dayKeyAt(Date.now());
      const todayMs = totals.get(todayKey) || 0;
      const currentMonthPrefix = monthPrefixOf(new Date());
      const currentYearPrefix = `${new Date().getFullYear()}-`;
      const monthMs = sumPrefix(totals, currentMonthPrefix);
      const yearMs = sumPrefix(totals, currentYearPrefix);
      const totalMs = sumTotal(totals);
      const todayCount = snapshot.sessions.filter((session) => sessionDayMs(session, todayKey) > 0).length;
      const yearCount = snapshot.sessions.filter((session) => dayKeyAt(session.startedAt).startsWith(currentYearPrefix)).length;
      const totalDays = countPrefixDays(totals, '');

      const status = snapshot.active
        ? t('status.active')
        : snapshot.current
          ? t('status.paused')
          : t('status.idle');

      const exportJson = () => {
        const payload = {
          exportedAt: new Date().toISOString(),
          version: DATA_VERSION,
          sessions: snapshot.sessions
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `dsh-time-ledger-${todayKey}.json`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      };

      const openMonth = (index) => {
        setCursor(new Date(cursor.getFullYear(), index, 1));
        setSelectedDay(null);
        setView('month');
      };

      const shiftMonth = (delta) => {
        setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1));
        setSelectedDay(null);
      };

      const goToday = () => {
        const now = new Date();
        setCursor(now);
        setSelectedDay(dayKeyAt(now.getTime()));
      };

      return h('div', { className: 'tl-page' },
        h('div', { className: 'tl-inner' },
          h('header', { className: 'tl-head' },
            h('div', { className: 'tl-head-copy' },
              h('div', { className: 'tl-eyebrow' }, t('panel.eyebrow')),
              h('h1', { className: 'tl-title' }, t('panel.title')),
              h('p', { className: 'tl-subtitle' }, t('panel.subtitle'))
            ),
            h('div', { className: 'tl-head-actions' },
              h('span', { className: `tl-live${snapshot.active ? ' is-active' : ''}` },
                h('i', { className: 'tl-dot', 'aria-hidden': true }),
                status,
                snapshot.current
                  ? h('span', { className: 'tl-live-time' }, fmtHms(snapshot.current.activeMs))
                  : null
              ),
              h('button', { type: 'button', className: 'tl-btn', onClick: exportJson }, t('panel.export'))
            )
          ),

          h('div', { className: 'tl-stats' },
            h(StatCard, { label: t('stats.today'), value: fmtDuration(todayMs), sub: t('stats.sessions', { count: todayCount }), accent: true }),
            h(StatCard, { label: t('stats.month'), value: fmtDuration(monthMs), sub: t('stats.sessions', { count: snapshot.sessions.filter((session) => dayKeyAt(session.startedAt).startsWith(currentMonthPrefix)).length }) }),
            h(StatCard, { label: t('stats.year'), value: fmtDuration(yearMs), sub: t('stats.sessions', { count: yearCount }) }),
            h(StatCard, { label: t('stats.total'), value: fmtDuration(totalMs), sub: t('stats.days', { count: totalDays }) })
          ),

          h('div', { className: 'tl-toolbar' },
            h('div', { className: 'tl-tabs', role: 'tablist' },
              [['year', t('tabs.year')], ['month', t('tabs.month')], ['sessions', t('tabs.sessions')]].map(([id, label]) =>
                h('button', {
                  key: id,
                  type: 'button',
                  role: 'tab',
                  'aria-selected': view === id,
                  className: `tl-tab${view === id ? ' is-active' : ''}`,
                  onClick: () => setView(id)
                }, label)
              )
            ),
            !snapshot.ready
              ? h('span', { className: 'tl-loading-note' }, t('status.loading'))
              : null
          ),

          view === 'year'
            ? h(YearView, {
                year: cursor.getFullYear(),
                totals,
                sessions: snapshot.sessions,
                onYear: (year) => setCursor(new Date(year, 0, 1)),
                onOpenMonth: openMonth
              })
            : null,

          view === 'month'
            ? h(MonthView, {
                year: cursor.getFullYear(),
                month: cursor.getMonth(),
                totals,
                sessions: snapshot.sessions,
                selectedDay,
                onMonth: shiftMonth,
                onToday: goToday,
                onSelectDay: setSelectedDay
              })
            : null,

          view === 'sessions'
            ? h(SessionsView, {
                sessions: snapshot.sessions,
                currentId: snapshot.current?.id || null
              })
            : null,

          h('footer', { className: 'tl-footer' },
            h('div', { className: 'tl-storage' },
              h('span', {
                className: `tl-save-dot${snapshot.saveState === 'error' ? ' is-error' : snapshot.storage === 'profile' ? ' is-ok' : ''}`,
                'aria-hidden': true
              }),
              h('span', { className: 'tl-storage-text' },
                snapshot.saveState === 'error'
                  ? t('storage.error', { message: snapshot.errorMessage || 'unknown' })
                  : snapshot.storage === 'profile'
                    ? t('storage.profile')
                    : t('storage.local')
              ),
              snapshot.lastSavedAt > 0
                ? h('span', { className: 'tl-storage-time' }, t('storage.lastSaved', { time: fmtClock(snapshot.lastSavedAt) }))
                : null
            ),
            snapshot.storagePath
              ? h('div', { className: 'tl-storage-path', title: snapshot.storagePath },
                  h('span', null, t('storage.file')),
                  h('code', null, snapshot.storagePath)
                )
              : null
          )
        )
      );
    }

    const CSS = `
.tl-page {
  position: relative;
  height: 100%;
  min-height: 0;
  overflow: auto;
  box-sizing: border-box;
  color: var(--dsw-alias-label-primary, #111827);
  background:
    radial-gradient(circle at 88% -6%, color-mix(in srgb, var(--dsw-alias-brand-primary, #2f6bff) 11%, transparent), transparent 38%),
    var(--dsw-alias-bg-base, #ffffff);
}
.tl-inner {
  width: 100%;
  max-width: 1080px;
  margin: 0 auto;
  padding: 36px 40px 64px;
  box-sizing: border-box;
}
.tl-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  flex-wrap: wrap;
}
.tl-head-copy { min-width: 0; max-width: 680px; }
.tl-eyebrow {
  font-size: 10px;
  font-weight: 750;
  letter-spacing: .2em;
  color: var(--dsw-alias-brand-primary, #2f6bff);
  text-transform: uppercase;
  margin-bottom: 9px;
}
.tl-title {
  margin: 0;
  font-size: 30px;
  line-height: 1.18;
  font-weight: 680;
  letter-spacing: -.025em;
}
.tl-subtitle {
  margin: 9px 0 0;
  color: var(--dsw-alias-label-secondary, #667085);
  font-size: 13px;
  line-height: 1.65;
}
.tl-head-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding-top: 4px;
}
.tl-live {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 32px;
  padding: 0 11px;
  border: 1px solid var(--dsw-alias-border-l1, #e4e7ec);
  border-radius: 999px;
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-1, #f8fafc) 86%, transparent);
  color: var(--dsw-alias-label-secondary, #667085);
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}
.tl-live.is-active { color: var(--dsw-alias-state-success-primary, #15803d); }
.tl-live-time {
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-primary, #111827);
  border-left: 1px solid var(--dsw-alias-border-l1, #e4e7ec);
  margin-left: 1px;
  padding-left: 8px;
}
.tl-dot {
  width: var(--tl-dot-size, 6px);
  height: var(--tl-dot-size, 6px);
  border-radius: 50%;
  background: var(--dsw-alias-label-tertiary, #98a2b3);
  flex: 0 0 auto;
}
.tl-dot.is-active {
  background: var(--dsw-alias-state-success-primary, #16a34a);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-success-primary, #16a34a) 16%, transparent);
  animation: tl-pulse 1.9s ease-in-out infinite;
}
.tl-dot.is-paused { background: var(--dsw-alias-state-warn-primary, #d97706); }
.tl-btn {
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--dsw-alias-border-l1, #e4e7ec);
  border-radius: 9px;
  background: var(--dsw-alias-bg-layer-1, #f8fafc);
  color: var(--dsw-alias-label-primary, #111827);
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color .15s ease, background .15s ease, transform .15s ease;
}
.tl-btn:hover {
  border-color: var(--dsw-alias-brand-primary, #2f6bff);
  background: var(--dsw-alias-bg-base, #ffffff);
  transform: translateY(-1px);
}
.tl-btn:focus-visible, .tl-nav-btn:focus-visible, .tl-tab:focus-visible,
.tl-year-card:focus-visible, .tl-day:focus-visible, .tl-overlay:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--dsw-alias-brand-primary, #2f6bff) 64%, transparent);
  outline-offset: 2px;
}
.tl-stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-top: 26px;
}
.tl-stat {
  position: relative;
  overflow: hidden;
  min-height: 94px;
  padding: 15px 16px;
  box-sizing: border-box;
  border: 1px solid var(--dsw-alias-border-l1, #e4e7ec);
  border-radius: 14px;
  background: var(--dsw-alias-bg-layer-1, #f8fafc);
}
.tl-stat.is-accent {
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary, #2f6bff) 28%, var(--dsw-alias-border-l1, #e4e7ec));
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--dsw-alias-brand-primary, #2f6bff) 8%, transparent), transparent 60%),
    var(--dsw-alias-bg-layer-1, #f8fafc);
}
.tl-stat-label {
  color: var(--dsw-alias-label-secondary, #667085);
  font-size: 11px;
  font-weight: 600;
}
.tl-stat-value {
  margin-top: 7px;
  font-size: 24px;
  line-height: 1.1;
  font-weight: 680;
  letter-spacing: -.02em;
  font-variant-numeric: tabular-nums;
}
.tl-stat-sub {
  margin-top: 7px;
  color: var(--dsw-alias-label-tertiary, #98a2b3);
  font-size: 10px;
}
.tl-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 26px;
}
.tl-tabs {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--dsw-alias-border-l1, #e4e7ec);
  border-radius: 11px;
  background: var(--dsw-alias-bg-layer-2, #f2f4f7);
}
.tl-tab {
  min-width: 58px;
  height: 28px;
  padding: 0 14px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #667085);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background .15s ease, color .15s ease, box-shadow .15s ease;
}
.tl-tab:hover { color: var(--dsw-alias-label-primary, #111827); }
.tl-tab.is-active {
  color: var(--dsw-alias-label-primary, #111827);
  background: var(--dsw-alias-bg-base, #ffffff);
  box-shadow: 0 1px 3px rgba(16, 24, 40, .1);
}
.tl-loading-note {
  color: var(--dsw-alias-label-tertiary, #98a2b3);
  font-size: 11px;
}
.tl-section {
  margin-top: 18px;
  padding: 20px;
  border: 1px solid var(--dsw-alias-border-l1, #e4e7ec);
  border-radius: 16px;
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-1, #f8fafc) 78%, transparent);
}
.tl-section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}
.tl-kicker {
  color: var(--dsw-alias-label-tertiary, #98a2b3);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: .16em;
  text-transform: uppercase;
  margin-bottom: 5px;
}
.tl-section-title {
  margin: 0;
  font-size: 19px;
  line-height: 1.3;
  font-weight: 660;
  letter-spacing: -.015em;
}
.tl-section-sub {
  margin-top: 6px;
  color: var(--dsw-alias-label-secondary, #667085);
  font-size: 11px;
}
.tl-nav { display: inline-flex; align-items: center; gap: 5px; }
.tl-nav-btn {
  height: 29px;
  min-width: 29px;
  padding: 0 9px;
  border: 1px solid var(--dsw-alias-border-l1, #e4e7ec);
  border-radius: 8px;
  background: var(--dsw-alias-bg-base, #ffffff);
  color: var(--dsw-alias-label-primary, #111827);
  font: inherit;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}
.tl-nav-btn:hover {
  border-color: var(--dsw-alias-brand-primary, #2f6bff);
  color: var(--dsw-alias-brand-primary, #2f6bff);
}
.tl-year-facts {
  display: flex;
  gap: 26px;
  flex-wrap: wrap;
  padding: 11px 14px;
  margin-bottom: 14px;
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-2, #f2f4f7);
}
.tl-fact {
  display: flex;
  align-items: baseline;
  gap: 8px;
  color: var(--dsw-alias-label-secondary, #667085);
  font-size: 11px;
}
.tl-fact strong {
  color: var(--dsw-alias-label-primary, #111827);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
.tl-year-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
.tl-year-card {
  display: block;
  width: 100%;
  padding: 13px 14px;
  box-sizing: border-box;
  border: 1px solid var(--dsw-alias-border-l1, #e4e7ec);
  border-radius: 12px;
  background: var(--dsw-alias-bg-base, #ffffff);
  color: var(--dsw-alias-label-primary, #111827);
  text-align: left;
  font: inherit;
  cursor: pointer;
  transition: border-color .15s ease, transform .15s ease, box-shadow .15s ease;
}
.tl-year-card:hover {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary, #2f6bff) 50%, var(--dsw-alias-border-l1, #e4e7ec));
  box-shadow: 0 5px 16px rgba(16, 24, 40, .06);
}
.tl-year-card.is-current {
  border-color: var(--dsw-alias-brand-primary, #2f6bff);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--dsw-alias-brand-primary, #2f6bff) 26%, transparent);
}
.tl-year-card-top { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.tl-year-month { font-size: 13px; font-weight: 650; }
.tl-year-ms { color: var(--dsw-alias-label-secondary, #667085); font-size: 11px; font-variant-numeric: tabular-nums; }
.tl-year-bar {
  height: 4px;
  margin: 10px 0 8px;
  overflow: hidden;
  border-radius: 99px;
  background: var(--dsw-alias-bg-layer-2, #f2f4f7);
}
.tl-year-bar > i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--dsw-alias-brand-primary, #2f6bff), color-mix(in srgb, var(--dsw-alias-brand-primary, #2f6bff) 55%, #7c3aed));
  transition: width .3s ease;
}
.tl-year-card-foot { color: var(--dsw-alias-label-tertiary, #98a2b3); font-size: 10px; }
.tl-calendar {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 6px;
}
.tl-weekday {
  padding: 3px 0 5px;
  color: var(--dsw-alias-label-tertiary, #98a2b3);
  font-size: 10px;
  font-weight: 600;
  text-align: center;
}
.tl-day-blank { min-height: 70px; }
.tl-day {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: space-between;
  gap: 4px;
  min-height: 70px;
  padding: 8px 9px;
  box-sizing: border-box;
  border: 1px solid var(--dsw-alias-border-l1, #e4e7ec);
  border-radius: 10px;
  background: var(--dsw-alias-bg-base, #ffffff);
  color: var(--dsw-alias-label-primary, #111827);
  text-align: left;
  font: inherit;
  cursor: pointer;
  transition: border-color .15s ease, transform .15s ease, box-shadow .15s ease;
}
.tl-day:hover {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary, #2f6bff) 48%, var(--dsw-alias-border-l1, #e4e7ec));
}
.tl-day.is-today { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--dsw-alias-brand-primary, #2f6bff) 36%, transparent); }
.tl-day.is-selected {
  border-color: var(--dsw-alias-brand-primary, #2f6bff);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary, #2f6bff) 20%, transparent);
}
.tl-day-num { font-size: 12px; font-weight: 650; font-variant-numeric: tabular-nums; }
.tl-day-ms { color: var(--dsw-alias-label-secondary, #667085); font-size: 9px; font-variant-numeric: tabular-nums; }
.tl-day.has-time .tl-day-num { color: var(--dsw-alias-brand-primary, #2f6bff); }
.tl-day-detail {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--dsw-alias-border-l1, #e4e7ec);
}
.tl-detail-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}
.tl-detail-date { font-size: 13px; font-weight: 650; }
.tl-detail-total { margin-top: 4px; color: var(--dsw-alias-label-secondary, #667085); font-size: 10px; }
.tl-detail-count {
  color: var(--dsw-alias-label-tertiary, #98a2b3);
  font-size: 10px;
  padding-top: 2px;
}
.tl-detail-empty {
  padding: 18px 4px 6px;
  color: var(--dsw-alias-label-tertiary, #98a2b3);
  font-size: 11px;
  text-align: center;
}
.tl-detail-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 34px;
  padding: 4px 2px;
  border-bottom: 1px dashed var(--dsw-alias-border-l1, #e4e7ec);
  font-size: 11px;
}
.tl-detail-row:last-child { border-bottom: 0; }
.tl-detail-index { color: var(--dsw-alias-label-tertiary, #98a2b3); min-width: 52px; }
.tl-detail-time { font-variant-numeric: tabular-nums; }
.tl-detail-duration { margin-left: auto; font-weight: 600; font-variant-numeric: tabular-nums; }
.tl-chip {
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 6px;
  border-radius: 5px;
  background: var(--dsw-alias-bg-layer-2, #f2f4f7);
  color: var(--dsw-alias-label-tertiary, #98a2b3);
  font-size: 9px;
  white-space: nowrap;
}
.tl-chip.is-live {
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #16a34a) 12%, transparent);
  color: var(--dsw-alias-state-success-primary, #15803d);
}
.tl-session-groups { display: flex; flex-direction: column; gap: 18px; }
.tl-group-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 14px;
  padding: 0 2px 8px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, #e4e7ec);
}
.tl-group-date { font-size: 12px; font-weight: 650; }
.tl-group-total { color: var(--dsw-alias-label-secondary, #667085); font-size: 10px; font-variant-numeric: tabular-nums; }
.tl-session-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 38px;
  padding: 4px 2px;
  border-bottom: 1px solid color-mix(in srgb, var(--dsw-alias-border-l1, #e4e7ec) 55%, transparent);
  font-size: 11px;
}
.tl-session-row:last-child { border-bottom: 0; }
.tl-session-index { min-width: 52px; color: var(--dsw-alias-label-tertiary, #98a2b3); }
.tl-session-time { font-variant-numeric: tabular-nums; }
.tl-session-duration { margin-left: auto; font-weight: 600; font-variant-numeric: tabular-nums; }
.tl-empty {
  padding: 34px 20px;
  text-align: center;
  color: var(--dsw-alias-label-tertiary, #98a2b3);
}
.tl-empty-mark { color: color-mix(in srgb, var(--dsw-alias-brand-primary, #2f6bff) 58%, var(--dsw-alias-label-tertiary, #98a2b3)); }
.tl-empty-title { margin-top: 9px; color: var(--dsw-alias-label-primary, #111827); font-size: 13px; font-weight: 600; }
.tl-empty-body { max-width: 440px; margin: 6px auto 0; font-size: 11px; line-height: 1.6; }
.tl-footer {
  margin-top: 22px;
  padding-top: 13px;
  border-top: 1px solid var(--dsw-alias-border-l1, #e4e7ec);
  color: var(--dsw-alias-label-tertiary, #98a2b3);
  font-size: 10px;
}
.tl-storage { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.tl-save-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--dsw-alias-label-tertiary, #98a2b3);
  flex: 0 0 auto;
}
.tl-save-dot.is-ok { background: var(--dsw-alias-state-success-primary, #16a34a); }
.tl-save-dot.is-error { background: var(--dsw-alias-state-error-primary, #dc2626); }
.tl-storage-time { color: var(--dsw-alias-label-tertiary, #98a2b3); }
.tl-storage-path {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-top: 7px;
  min-width: 0;
}
.tl-storage-path code {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 9px;
  color: var(--dsw-alias-label-tertiary, #98a2b3);
}
.tl-overlay-wrap {
  position: absolute;
  z-index: 80;
  pointer-events: none;
  font-family: inherit;
}
.tl-overlay {
  position: relative;
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: var(--tl-pad-y, 9px) var(--tl-pad-x, 11px);
  box-sizing: border-box;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--dsw-alias-border-l1, #e4e7ec) 88%, transparent);
  border-radius: var(--tl-radius, 13px);
  background: color-mix(in srgb, var(--dsw-alias-bg-overlay, #ffffff) 92%, transparent);
  box-shadow: 0 10px 30px rgba(15, 23, 42, .14), 0 2px 6px rgba(15, 23, 42, .06);
  backdrop-filter: blur(14px);
  color: var(--dsw-alias-label-primary, #111827);
  text-align: left;
  font: inherit;
  cursor: grab;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  transition: border-color .16s ease, box-shadow .16s ease;
}
.tl-overlay:hover {
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary, #2f6bff) 42%, var(--dsw-alias-border-l1, #e4e7ec));
  box-shadow: 0 14px 34px rgba(15, 23, 42, .17), 0 2px 6px rgba(15, 23, 42, .06);
}
.tl-overlay:active { cursor: grabbing; }
.tl-resize-handle {
  position: absolute;
  right: 0;
  bottom: 0;
  width: var(--tl-handle-size, 18px);
  height: var(--tl-handle-size, 18px);
  cursor: nwse-resize;
  touch-action: none;
  opacity: .5;
  transition: opacity .15s ease;
}
.tl-resize-handle::after {
  content: "";
  position: absolute;
  right: 4px;
  bottom: 4px;
  width: 7px;
  height: 7px;
  border-right: 1.5px solid var(--dsw-alias-label-tertiary, #98a2b3);
  border-bottom: 1.5px solid var(--dsw-alias-label-tertiary, #98a2b3);
  border-bottom-right-radius: 1px;
}
.tl-overlay:hover .tl-resize-handle { opacity: .95; }
.tl-overlay-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.tl-overlay-label {
  color: var(--dsw-alias-label-secondary, #667085);
  font-size: var(--tl-label-size, 9px);
  font-weight: 650;
  letter-spacing: .1em;
  text-transform: uppercase;
}
.tl-overlay-status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--dsw-alias-label-tertiary, #98a2b3);
  font-size: var(--tl-label-size, 9px);
  font-weight: 600;
}
.tl-overlay-time {
  display: block;
  margin-top: 2px;
  overflow: hidden;
  font-size: var(--tl-time-size, 23px);
  line-height: 1.12;
  font-weight: 680;
  letter-spacing: .015em;
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tl-overlay-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin-top: 3px;
  color: var(--dsw-alias-label-tertiary, #98a2b3);
  font-size: var(--tl-foot-size, 9px);
  white-space: nowrap;
}
.tl-overlay-open { color: var(--dsw-alias-brand-primary, #2f6bff); font-weight: 600; }
.tl-toast {
  position: absolute;
  right: 0;
  bottom: calc(100% + 8px);
  pointer-events: none;
  max-width: 240px;
  padding: 8px 11px;
  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-success-primary, #16a34a) 22%, var(--dsw-alias-border-l1, #e4e7ec));
  border-radius: 9px;
  background: var(--dsw-alias-bg-overlay, #ffffff);
  box-shadow: 0 8px 22px rgba(15, 23, 42, .13);
  color: var(--dsw-alias-label-secondary, #667085);
  font-size: 10px;
  line-height: 1.5;
  text-align: right;
  animation: tl-toast-in .2s ease both;
}
@keyframes tl-pulse {
  0%, 100% { opacity: .55; transform: scale(.9); }
  50% { opacity: 1; transform: scale(1); }
}
@keyframes tl-toast-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
@media (max-width: 820px) {
  .tl-inner { padding: 26px 22px 50px; }
  .tl-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .tl-year-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 560px) {
  .tl-inner { padding: 20px 14px 44px; }
  .tl-title { font-size: 24px; }
  .tl-section { padding: 14px; }
  .tl-day, .tl-day-blank { min-height: 56px; }
  .tl-day { padding: 6px; }
  .tl-day-ms { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .tl-dot.is-active, .tl-toast { animation: none; }
  .tl-overlay, .tl-year-card, .tl-day, .tl-btn { transition: none; }
}
`;

    const ZH = {
      'nav.title': 'dstime',
      'panel.eyebrow': 'dstime',
      'panel.title': 'dstime',
      'panel.subtitle': '只记录真正活跃的时间：窗口可见、有实际操作时才计时，空闲自动暂停。',
      'panel.export': '导出 JSON',
      'status.active': '使用中',
      'status.paused': '已暂停',
      'status.idle': '待机',
      'status.loading': '正在读取记录…',
      'overlay.current': '本次使用',
      'overlay.today': '今日',
      'overlay.open': '查看日历',
      'overlay.hint': '操作后计时 · 满 1 分钟记录',
      'overlay.dragHint': '拖动移动 · 右下角拉动调整大小 · 点击打开日历',
      'toast.saved': '本次 {duration} 已保存，计时已清零',
      'stats.today': '今日',
      'stats.month': '本月',
      'stats.year': '今年',
      'stats.total': '累计',
      'stats.sessions': '{count} 次',
      'stats.days': '{count} 天',
      'tabs.year': '年',
      'tabs.month': '月',
      'tabs.sessions': '次',
      'year.kicker': 'Yearly overview',
      'year.title': '{year} 年',
      'year.activeDays': '活跃天数',
      'year.sessions': '使用次数',
      'year.recordCount': '{count} 次记录',
      'month.kicker': 'Monthly calendar',
      'month.title': '{year} 年 {month}',
      'month.today': '回到本月',
      'month.sessionCount': '{count} 次',
      'month.pickDay': '点击日历中的日期，查看当天每一次使用记录',
      'month.emptyDay': '这一天没有记录',
      'session.kicker': 'Every session',
      'session.title': '全部记录',
      'session.count': '共 {count} 次',
      'session.nth': '第 {n} 次',
      'session.crossDay': '跨天',
      'session.live': '进行中',
      'session.none': '还没有使用记录',
      'session.noneHint': '在 DeepSeek 里操作一下，计时会从第一次真实交互开始。',
      'storage.profile': '已自动保存到 dsh_common\\dstime_data',
      'storage.local': '服务未连接，暂存在浏览器本地',
      'storage.lastSaved': '最近保存 {time}',
      'storage.error': '保存失败：{message}',
      'storage.file': '数据文件',
      'common.prev': '上一个',
      'common.next': '下一个',
      'unit.hour': '小时',
      'unit.min': '分',
      'unit.sec': '秒'
    };

    const EN = {
      'nav.title': 'dstime',
      'panel.eyebrow': 'dstime',
      'panel.title': 'dstime',
      'panel.subtitle': 'Only genuinely active time is recorded: the window must be visible and receiving real input. Idle time pauses automatically.',
      'panel.export': 'Export JSON',
      'status.active': 'Active',
      'status.paused': 'Paused',
      'status.idle': 'Idle',
      'status.loading': 'Loading records…',
      'overlay.current': 'Current session',
      'overlay.today': 'Today',
      'overlay.open': 'Open calendar',
      'overlay.hint': 'Starts on input · saved at 1 min',
      'overlay.dragHint': 'Drag to move · pull the bottom-right corner to resize · click to open',
      'toast.saved': 'Saved {duration}. Live counter reset.',
      'stats.today': 'Today',
      'stats.month': 'This month',
      'stats.year': 'This year',
      'stats.total': 'All time',
      'stats.sessions': '{count} sessions',
      'stats.days': '{count} days',
      'tabs.year': 'Year',
      'tabs.month': 'Month',
      'tabs.sessions': 'Sessions',
      'year.kicker': 'Yearly overview',
      'year.title': '{year}',
      'year.activeDays': 'Active days',
      'year.sessions': 'Sessions',
      'year.recordCount': '{count} sessions',
      'month.kicker': 'Monthly calendar',
      'month.title': '{month} {year}',
      'month.today': 'Today',
      'month.sessionCount': '{count} sessions',
      'month.pickDay': 'Pick a date on the calendar to see every session that day',
      'month.emptyDay': 'No records on this day',
      'session.kicker': 'Every session',
      'session.title': 'All sessions',
      'session.count': '{count} total',
      'session.nth': 'Session {n}',
      'session.crossDay': 'Cross-day',
      'session.live': 'Live',
      'session.none': 'No usage records yet',
      'session.noneHint': 'Use DeepSeek normally — the timer starts on the first real interaction.',
      'storage.profile': 'Auto-saved to dsh_common\\dstime_data',
      'storage.local': 'Service offline — kept in browser storage',
      'storage.lastSaved': 'Saved {time}',
      'storage.error': 'Save failed: {message}',
      'storage.file': 'Data file',
      'common.prev': 'Previous',
      'common.next': 'Next',
      'unit.hour': 'h',
      'unit.min': 'm',
      'unit.sec': 's'
    };

    return {
      inject: ['slots', 'locale', 'layout'],
      apply(ctx) {
        localeService = ctx.locale;
        layoutService = ctx.layout;
        t = ctx.locale.bind(NS);

        ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'time-ledger: locale dictionaries');
        ctx.effect(
          () => ctx.locale.subscribe(() => publish()),
          'time-ledger: locale refresh'
        );

        ctx.effect(() => {
          const style = document.createElement('style');
          style.dataset.plugin = '@local/dsh-time-ledger';
          style.textContent = CSS;
          document.head.appendChild(style);
          return () => style.remove();
        }, 'time-ledger: styles');

        ctx.effect(() => {
          windowFocused = document.hasFocus();
          const cleanups = [];
          const onActivity = () => noteActivity();
          for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
            window.addEventListener(type, onActivity, { capture: true, passive: true });
            cleanups.push(() => window.removeEventListener(type, onActivity, { capture: true }));
          }

          const onFocus = () => {
            windowFocused = true;
          };
          const onBlur = () => {
            windowFocused = false;
            pause('blur');
          };
          const onVisibility = () => {
            if (document.visibilityState !== 'visible') {
              pause('hidden');
            } else {
              windowFocused = document.hasFocus();
            }
          };
          const onPageHide = () => {
            finalizeCurrent('exit', { beacon: true });
          };
          const onBeforeUnload = () => {
            if (state.current) finalizeCurrent('exit', { beacon: true });
          };

          window.addEventListener('focus', onFocus);
          window.addEventListener('blur', onBlur);
          document.addEventListener('visibilitychange', onVisibility);
          window.addEventListener('pagehide', onPageHide);
          window.addEventListener('beforeunload', onBeforeUnload);
          cleanups.push(() => window.removeEventListener('focus', onFocus));
          cleanups.push(() => window.removeEventListener('blur', onBlur));
          cleanups.push(() => document.removeEventListener('visibilitychange', onVisibility));
          cleanups.push(() => window.removeEventListener('pagehide', onPageHide));
          cleanups.push(() => window.removeEventListener('beforeunload', onBeforeUnload));

          const timer = window.setInterval(tick, TICK_MS);
          cleanups.push(() => window.clearInterval(timer));

          void hydrate();

          return () => {
            for (const cleanup of cleanups) {
              try {
                cleanup();
              } catch {
                // Teardown must not throw.
              }
            }
            if (state.current) {
              pause('unload');
              saveCurrent(false);
            }
          };
        }, 'time-ledger: activity detection and counter');

        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: 'time-ledger',
              order: 30,
              label: () => t('nav.title')
            },
            function TimeLedgerIcon({ size = 20, active = false }) {
              return h('svg', {
                width: size,
                height: size,
                viewBox: '0 0 24 24',
                fill: 'none',
                'aria-hidden': true,
                style: { display: 'block', opacity: active ? 1 : 0.82 }
              },
                h('rect', { x: 9.8, y: 1.6, width: 4.4, height: 2.4, rx: 0.6, stroke: 'currentColor', strokeWidth: 1.3 }),
                h('path', { d: 'M12 3.9v2.3', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }),
                h('rect', { x: 3.2, y: 7, width: 17.6, height: 14.8, rx: 4, stroke: 'currentColor', strokeWidth: 1.6 }),
                h('circle', { cx: 12, cy: 14.4, r: 5.6, stroke: 'currentColor', strokeWidth: 1.5 }),
                h('path', { d: 'M6.9 14.4h1.4M15.7 14.4h1.4M12 18.9v1.3', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' }),
                h('path', { d: 'M12 14.4V9.4', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }),
                h('path', { d: 'M12 14.4l3.4-3.2', stroke: '#1f73e8', strokeWidth: 1.6, strokeLinecap: 'round' }),
                h('circle', { cx: 12, cy: 14.4, r: 1.1, fill: '#ffffff', stroke: 'currentColor', strokeWidth: 1.1 })
              );
            }
          )
        );

        ctx.slots.inject('main', () =>
          ctx.slots.register(
            { name: 'main', key: 'time-ledger' },
            TimeLedgerPage
          )
        );

        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            {
              name: 'shell.overlay',
              id: 'time-ledger-overlay',
              order: 50
            },
            function LedgerOverlay() {
              const snapshot = useStore();
              const initialBox = readSavedOverlayBox();
              const [box, setBox] = React.useState(() => initialBox?.manual ? initialBox : defaultOverlayBox());
              const boxRef = React.useRef(box);
              const wrapRef = React.useRef(null);
              const hasManualRef = React.useRef(Boolean(initialBox?.manual));
              boxRef.current = box;

              const fullLayerSize = () => {
                const layer = wrapRef.current?.parentElement;
                return [
                  layer?.clientWidth || window.innerWidth,
                  layer?.clientHeight || window.innerHeight
                ];
              };

              const visibleLayerSize = () => {
                const [fullWidth, fullHeight] = fullLayerSize();
                const [screenWidth, screenHeight] = visibleViewportSize();
                return [
                  Math.min(fullWidth, screenWidth),
                  Math.min(fullHeight, screenHeight)
                ];
              };

              React.useEffect(() => {
                // The Electron zoom/scale settles after the first layout, so
                // measure again a moment later; a plain resize event can miss it.
                const settle = () => {
                  const [fullWidth, fullHeight] = fullLayerSize();
                  const [visibleWidth, visibleHeight] = visibleLayerSize();
                  const next = hasManualRef.current
                    ? clampOverlayBox(boxRef.current, fullWidth, fullHeight)
                    : defaultOverlayBox(visibleWidth, visibleHeight);
                  boxRef.current = next;
                  setBox(next);
                  writeOverlayBox(next, hasManualRef.current);
                };
                const first = window.setTimeout(settle, 250);
                const second = window.setTimeout(settle, 1200);
                window.addEventListener('resize', settle);
                window.addEventListener('move', settle);
                return () => {
                  window.clearTimeout(first);
                  window.clearTimeout(second);
                  window.removeEventListener('resize', settle);
                  window.removeEventListener('move', settle);
                };
              }, []);

              const beginDrag = (event) => {
                if (event.button !== 0) return;
                if (event.target instanceof Element && event.target.closest('.tl-resize-handle')) return;
                const startX = event.clientX;
                const startY = event.clientY;
                const base = boxRef.current;
                let moved = false;

                const onMove = (moveEvent) => {
                  const dx = moveEvent.clientX - startX;
                  const dy = moveEvent.clientY - startY;
                  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
                  const next = clampOverlayBox({
                    ...base,
                    x: base.x + dx,
                    y: base.y + dy
                  }, ...fullLayerSize());
                  boxRef.current = next;
                  setBox(next);
                };
                const finish = () => {
                  window.removeEventListener('pointermove', onMove);
                  window.removeEventListener('pointerup', finish);
                  window.removeEventListener('pointercancel', finish);
                  if (moved) {
                    hasManualRef.current = true;
                    writeOverlayBox(boxRef.current, true);
                  }
                  if (!moved) openPanel();
                };

                window.addEventListener('pointermove', onMove);
                window.addEventListener('pointerup', finish);
                window.addEventListener('pointercancel', finish);
                event.preventDefault();
              };

              const beginResize = (event) => {
                if (event.button !== 0) return;
                event.stopPropagation();
                event.preventDefault();
                const startX = event.clientX;
                const startY = event.clientY;
                const base = boxRef.current;

                const onMove = (moveEvent) => {
                  const dx = moveEvent.clientX - startX;
                  const dy = moveEvent.clientY - startY;
                  const [viewportWidth, viewportHeight] = fullLayerSize();
                  const maxWidth = Math.max(MIN_OVERLAY_WIDTH, Math.min(460, viewportWidth - base.x - 8));
                  const maxHeight = Math.max(MIN_OVERLAY_HEIGHT, Math.min(300, viewportHeight - base.y - 8));
                  const next = {
                    ...base,
                    w: clamp(base.w + dx, MIN_OVERLAY_WIDTH, maxWidth),
                    h: clamp(base.h + dy, MIN_OVERLAY_HEIGHT, maxHeight)
                  };
                  boxRef.current = next;
                  setBox(next);
                };
                const finish = () => {
                  window.removeEventListener('pointermove', onMove);
                  window.removeEventListener('pointerup', finish);
                  window.removeEventListener('pointercancel', finish);
                  hasManualRef.current = true;
                  writeOverlayBox(boxRef.current, true);
                };

                window.addEventListener('pointermove', onMove);
                window.addEventListener('pointerup', finish);
                window.addEventListener('pointercancel', finish);
              };

              const onKeyDown = (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  openPanel();
                }
              };

              const today = dayKeyAt(Date.now());
              const totals = aggregateDays(snapshot.sessions);
              const todayMs = totals.get(today) || 0;
              const active = snapshot.active && snapshot.current;
              const status = active
                ? t('status.active')
                : snapshot.current
                  ? t('status.paused')
                  : t('status.idle');
              const scale = Math.max(0.8, Math.min(1.9, Math.min(box.w / 210, box.h / 82)));
              return h('div', {
                className: 'tl-overlay-wrap',
                style: {
                  left: box.x,
                  top: box.y,
                  width: box.w,
                  height: box.h,
                  '--tl-time-size': `${(23 * scale).toFixed(1)}px`,
                  '--tl-label-size': `${Math.max(8, 9 * scale).toFixed(1)}px`,
                  '--tl-foot-size': `${Math.max(8, 9 * scale).toFixed(1)}px`,
                  '--tl-dot-size': `${Math.max(5, 6 * scale).toFixed(1)}px`,
                  '--tl-pad-y': `${Math.max(6, 9 * scale).toFixed(1)}px`,
                  '--tl-pad-x': `${Math.max(8, 11 * scale).toFixed(1)}px`,
                  '--tl-radius': `${Math.max(10, 13 * scale).toFixed(1)}px`,
                  '--tl-handle-size': `${Math.max(14, 18 * scale).toFixed(1)}px`
                }
              },
                snapshot.toast && snapshot.toast.until > Date.now()
                  ? h('div', { className: 'tl-toast', role: 'status' },
                      t('toast.saved', { duration: fmtDuration(snapshot.toast.ms) }))
                  : null,
                h('div', {
                  className: 'tl-overlay',
                  role: 'button',
                  tabIndex: 0,
                  onPointerDown: beginDrag,
                  onKeyDown,
                  title: t('overlay.dragHint'),
                  'aria-label': t('overlay.open')
                },
                  h('span', { className: 'tl-overlay-top' },
                    h('span', { className: 'tl-overlay-label' }, t('overlay.current')),
                    h('span', { className: 'tl-overlay-status' },
                      h('i', {
                        className: `tl-dot${active ? ' is-active' : snapshot.current ? ' is-paused' : ' is-idle'}`,
                        'aria-hidden': true
                      }),
                      status
                    )
                  ),
                  h('span', { className: 'tl-overlay-time' }, fmtHms(snapshot.current?.activeMs || 0)),
                  h('span', { className: 'tl-overlay-foot' },
                    h('span', null, `${t('overlay.today')} ${fmtDuration(todayMs)}`),
                    h('span', { className: 'tl-overlay-open' }, snapshot.current ? t('overlay.open') : t('overlay.hint'))
                  ),
                  h('span', {
                    className: 'tl-resize-handle',
                    onPointerDown: beginResize,
                    'aria-hidden': true
                  })
                )
              );
            }
          )
        );

      }
    };
  }
});
