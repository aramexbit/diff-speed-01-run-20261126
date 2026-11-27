// diff-speed-01: a faster drop-in for makefun-diff 1.0.0 (make.fun's own line diff).
//
// The task: for an input { old, new }, two texts, return exactly the patch makefun-diff
// 1.0.0 returns, as one JSON string. The patch format and the edit script's rule are the
// ones makefun-diff's own header states: lines are cut after every "\n" (a last line with
// no "\n" is a line too); the common prefix is kept, then the common suffix of what is
// left; between them Myers's greedy search runs, keeping on each diagonal the path that
// reaches furthest into the old text and, when a deletion and an insertion reach the same
// point, the deletion's; it never moves past either text's end, prunes no edge diagonal,
// and follows every run of equal lines as far as it goes; the first path to reach both
// ends is the script. The patch then lists hunks with up to 3 kept lines of context,
// deletions before insertions in each change run, and a "%" line after a line that ends
// its text with no newline.
//
// Why the house baseline is slow, and what this file does differently:
// The baseline walks the search with one small linked-list object per diagonal step
// (a path object per (d, k), plus a component object per run), so a case with a few
// thousand edits allocates millions of objects and the garbage collector dominates.
// This file keeps the search's state in flat typed arrays instead: lines are interned
// to integer ids once per case (a shared map for both texts, so equal lines share one
// id and every comparison is an int compare), the search keeps only the furthest x per
// diagonal in a compact Int32Array per d (stored x + 2, so 0 means "no path"), and the
// edit script is recovered afterwards by walking those stored arrays backwards and
// re-applying the same tie-break. No object is allocated inside the search loop, and
// the patch is built as pieces in one array joined once, without a concatenation per
// printed line. The search itself is the same greedy rule, so the script it finds is
// the same script; only the bookkeeping is cheaper.
//
// Nothing is cached from one case to the next: every map and array here is created
// fresh inside run().

/** The run kinds inside an edit script. */
const KEEP = 0;
const DELETE = 1;
const INSERT = 2;

/** The kept lines a hunk shows before and after each change run. */
const CONTEXT = 3;

/** The patch's first word. */
const FORMAT = 'makefun-diff/1';

// ---------------------------------------------------------------- tokenize + intern

/**
 * One text, cut into lines and interned: parts is text.split('\n'), last its last
 * index, count the line count, ids the line ids. A line is parts[i] with a "\n" for
 * i < last, and parts[last] with no "\n" when it is not empty (the text then ends
 * with no newline). Two maps keep the two shapes apart, so a bare last line never
 * shares an id with a line of the same content that ends with "\n": the two are
 * different lines, and the search must not treat them as equal.
 */
function splitLines(text, mapW, mapB, next) {
  const parts = text.split('\n');
  const last = parts.length - 1;
  const count = last + (parts[last] !== '' ? 1 : 0);
  const ids = new Int32Array(count);
  for (let i = 0; i < last; i++) {
    const s = parts[i];
    let id = mapW.get(s);
    if (id === undefined) {
      id = next.v++;
      mapW.set(s, id);
    }
    ids[i] = id;
  }
  if (parts[last] !== '') {
    const s = parts[last];
    let id = mapB.get(s);
    if (id === undefined) {
      id = next.v++;
      mapB.set(s, id);
    }
    ids[last] = id;
  }
  return { parts, last, count, ids };
}

// ---------------------------------------------------------------- Myers's search

/**
 * The edit script between two slices of interned line ids, as forward-order runs
 * [{ kind, count }]. a and b are Int32Array views of the slices, of lengths n and m.
 *
 * The search stores one compact array per d: Vs[d][j] holds the furthest old index
 * reached on diagonal k = 2j - d, stored as x + 2 so 0 means "no path on that
 * diagonal". Only the diagonals with the right parity exist, so Vs[d] has d + 1
 * entries and all of them together take about D^2 / 2 integers. The step from
 * level d - 1 follows the header's rule exactly: the deletion's candidate is the
 * path on diagonal k - 1 one old line further (Vs[d-1][j-1]), the insertion's is
 * the path on diagonal k + 1 at the same old index (Vs[d-1][j]); a candidate is
 * only a candidate when its step stays inside its text; the further into the old
 * text wins, and the deletion wins a tie. The snake then follows every run of
 * equal lines as far as it goes. The first (d, k) to reach both ends wins, in the
 * same k order the header's loop uses.
 *
 * Backtracking re-applies the same rule from the stored arrays: at (d, k) the
 * predecessor is the one the forward step would have picked, the step itself is
 * one deletion or insertion, and the lines between the step and the stored x are
 * the snake's kept lines. Runs are collected backwards and reversed, merging
 * neighbours of the same kind (a zero-length snake between two steps of one kind
 * is one run, as the header's path-merging does).
 */
function myersRuns(a, b, n, m) {
  if (n === 0 && m === 0) return [];
  const Vs = [];
  // d = 0: the initial snake from (-1, -1).
  let x = -1;
  while (x + 1 < n && x + 1 < m && a[x + 1] === b[x + 1]) x++;
  const v0 = new Int32Array(1);
  v0[0] = x + 2;
  Vs.push(v0);
  let D = 0;
  let kF = 0;
  if (x + 1 < n || x + 1 < m) {
    let found = false;
    for (let d = 1; d <= n + m && !found; d++) {
      const V = new Int32Array(d + 1);
      const Vp = Vs[d - 1];
      for (let j = 0; j <= d; j++) {
        const k = 2 * j - d;
        const delS = j - 1 >= 0 ? Vp[j - 1] : 0;
        const insS = j <= d - 1 ? Vp[j] : 0;
        const canDel = delS !== 0 && delS - 1 < n;
        const canIns = insS !== 0 && insS - 2 - k < m;
        if (!canDel && !canIns) continue;
        // The deletion's x after its step is delS - 1, the insertion's stays insS - 2.
        const byDel = canDel ? delS - 1 : -2;
        const byIns = canIns ? insS - 2 : -2;
        let xx;
        if (byDel >= byIns) xx = delS - 1;
        else xx = insS - 2;
        let y = xx - k;
        while (xx + 1 < n && y + 1 < m && a[xx + 1] === b[y + 1]) {
          xx++;
          y++;
        }
        V[j] = xx + 2;
        if (xx + 1 >= n && y + 1 >= m) {
          D = d;
          kF = k;
          found = true;
          break;
        }
      }
      Vs.push(V);
    }
  }
  // Backtrack from (D, kF), collecting runs in reverse.
  const rev = [];
  let d = D;
  let k = kF;
  while (d > 0) {
    const j = (k + d) >> 1;
    const xx = Vs[d][j] - 2;
    const Vp = Vs[d - 1];
    const delS = j - 1 >= 0 ? Vp[j - 1] : 0;
    const insS = j <= d - 1 ? Vp[j] : 0;
    const canDel = delS !== 0 && delS - 1 < n;
    const canIns = insS !== 0 && insS - 2 - k < m;
    const byDel = canDel ? delS - 1 : -2;
    const byIns = canIns ? insS - 2 : -2;
    if (byDel >= byIns) {
      const keep = xx - (delS - 1);
      if (keep > 0) rev.push({ kind: KEEP, count: keep });
      rev.push({ kind: DELETE, count: 1 });
      k--;
    } else {
      const keep = xx - (insS - 2);
      if (keep > 0) rev.push({ kind: KEEP, count: keep });
      rev.push({ kind: INSERT, count: 1 });
      k++;
    }
    d--;
  }
  // d = 0: the initial snake kept lines 0 .. Vs[0][0] - 2.
  const first = Vs[0][0] - 2;
  if (first + 1 > 0) rev.push({ kind: KEEP, count: first + 1 });
  const runs = [];
  for (let i = rev.length - 1; i >= 0; i--) {
    const r = rev[i];
    const last = runs[runs.length - 1];
    if (last !== undefined && last.kind === r.kind) last.count += r.count;
    else runs.push({ kind: r.kind, count: r.count });
  }
  return runs;
}

// ---------------------------------------------------------------- the patch

/** One patch line, as pieces: its op, the line's text, and its ending. */
function pushLine(out, op, parts, last, i) {
  out.push(op);
  out.push(parts[i]);
  if (i < last) out.push('\n');
  else out.push('\n%\n');
}

/** make.fun's own patch of the two texts, from their lines and the full runs. */
function buildPatch(a, b, runs, n, m) {
  // The change runs: each a stretch of deletions and insertions between two kept
  // lines, at old line o and new line p.
  const changes = [];
  let o = 0;
  let p = 0;
  let deleted = 0;
  let inserted = 0;
  for (const r of runs) {
    if (r.kind === KEEP) {
      o += r.count;
      p += r.count;
      continue;
    }
    let c = changes[changes.length - 1];
    if (c === undefined || c.o + c.dels !== o || c.p + c.ins !== p) {
      c = { o, p, dels: 0, ins: 0 };
      changes.push(c);
    }
    if (r.kind === DELETE) {
      c.dels += r.count;
      o += r.count;
      deleted += r.count;
    } else {
      c.ins += r.count;
      p += r.count;
      inserted += r.count;
    }
  }
  // The hunks: change runs at most 2 * CONTEXT kept lines apart share one.
  const hunks = [];
  for (const c of changes) {
    const h = hunks[hunks.length - 1];
    const prev = h !== undefined ? h[h.length - 1] : undefined;
    if (prev !== undefined && c.o - (prev.o + prev.dels) <= 2 * CONTEXT) h.push(c);
    else hunks.push([c]);
  }
  const out = [`${FORMAT} old=${n} new=${m} hunks=${hunks.length} deleted=${deleted} inserted=${inserted}\n`];
  for (const h of hunks) {
    const first = h[0];
    const last = h[h.length - 1];
    const oldStart = Math.max(0, first.o - CONTEXT);
    const newStart = first.p - (first.o - oldStart);
    const after = Math.min(CONTEXT, n - (last.o + last.dels));
    const oldEnd = last.o + last.dels + after;
    const newEnd = last.p + last.ins + after;
    out.push(`@ ${oldStart + 1} ${oldEnd - oldStart} ${newStart + 1} ${newEnd - newStart}\n`);
    let at = oldStart;
    for (const c of h) {
      for (; at < c.o; at++) pushLine(out, '=', a.parts, a.last, at);
      for (let i = 0; i < c.dels; i++) pushLine(out, '-', a.parts, a.last, c.o + i);
      for (let i = 0; i < c.ins; i++) pushLine(out, '+', b.parts, b.last, c.p + i);
      at = c.o + c.dels;
    }
    for (; at < oldEnd; at++) pushLine(out, '=', a.parts, a.last, at);
  }
  return out.join('');
}

// ---------------------------------------------------------------- the entry point

/** makefun-diff 1.0.0's answer for one case's input. */
export function run(input) {
  if (input === null || typeof input !== 'object' || typeof input.old !== 'string' || typeof input.new !== 'string') {
    throw new TypeError('makefun-diff: the input is { old, new }, two strings');
  }
  const mapW = new Map();
  const mapB = new Map();
  const next = { v: 0 };
  const a = splitLines(input.old, mapW, mapB, next);
  const b = splitLines(input.new, mapW, mapB, next);
  const n = a.count;
  const m = b.count;
  const ai = a.ids;
  const bi = b.ids;
  // The common prefix, then the common suffix of what is left.
  let prefix = 0;
  while (prefix < n && prefix < m && ai[prefix] === bi[prefix]) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && ai[n - 1 - suffix] === bi[m - 1 - suffix]) suffix++;
  const middle = myersRuns(
    ai.subarray(prefix, n - suffix),
    bi.subarray(prefix, m - suffix),
    n - prefix - suffix,
    m - prefix - suffix,
  );
  const runs = [];
  if (prefix > 0) runs.push({ kind: KEEP, count: prefix });
  for (const r of middle) runs.push(r);
  if (suffix > 0) runs.push({ kind: KEEP, count: suffix });
  return buildPatch(a, b, runs, n, m);
}
