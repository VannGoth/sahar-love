// Sahar — reglas de los juegos de tablero (las usan la app y el servidor)
// Tablero de 8×8 en un array de 64 casillas: índice = fila * 8 + columna.
// La fila 0 es la de arriba (lado de las negras); la 7, la de abajo (blancas).
(function (root) {
  const other = (c) => (c === 'w' ? 'b' : 'w');
  const on = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
  const RC = (i) => [i >> 3, i & 7];
  const clone = (st) => JSON.parse(JSON.stringify(st));

  // =====================================================================
  // AJEDREZ
  // Piezas: 'wK' 'wQ' 'wR' 'wB' 'wN' 'wP' y lo mismo con 'b'.
  // =====================================================================
  function chessInit() {
    const back = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];
    const board = Array(64).fill(null);
    for (let c = 0; c < 8; c++) {
      board[c] = 'b' + back[c]; board[8 + c] = 'bP';
      board[48 + c] = 'wP'; board[56 + c] = 'w' + back[c];
    }
    return { board, turn: 'w', castle: 'KQkq', ep: null, half: 0, seen: {} };
  }
  const KN = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
  const KG = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
  const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  const ORTH = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  // ¿La casilla i está atacada por el color «by»?
  function attacked(board, i, by) {
    const [r, c] = RC(i);
    const pr = by === 'w' ? r + 1 : r - 1; // los peones blancos atacan hacia arriba
    for (const dc of [-1, 1]) if (on(pr, c + dc) && board[pr * 8 + c + dc] === by + 'P') return true;
    for (const [dr, dc] of KN) if (on(r + dr, c + dc) && board[(r + dr) * 8 + c + dc] === by + 'N') return true;
    for (const [dr, dc] of KG) if (on(r + dr, c + dc) && board[(r + dr) * 8 + c + dc] === by + 'K') return true;
    for (const [dirs, kinds] of [[DIAG, 'BQ'], [ORTH, 'RQ']]) {
      for (const [dr, dc] of dirs) {
        let rr = r + dr, cc = c + dc;
        while (on(rr, cc)) {
          const p = board[rr * 8 + cc];
          if (p) { if (p[0] === by && kinds.includes(p[1])) return true; break; }
          rr += dr; cc += dc;
        }
      }
    }
    return false;
  }
  function kingAt(board, color) { return board.indexOf(color + 'K'); }
  function inCheck(st, color) { const k = kingAt(st.board, color || st.turn); return k >= 0 && attacked(st.board, k, other(color || st.turn)); }
  function pseudo(st) {
    const { board, turn } = st, out = [];
    const add = (from, to, extra) => out.push({ from, to, ...extra });
    for (let i = 0; i < 64; i++) {
      const p = board[i];
      if (!p || p[0] !== turn) continue;
      const [r, c] = RC(i), k = p[1];
      if (k === 'P') {
        const dir = turn === 'w' ? -1 : 1, start = turn === 'w' ? 6 : 1, last = turn === 'w' ? 0 : 7;
        const push = (to) => { if ((to >> 3) === last) for (const q of ['Q', 'R', 'B', 'N']) add(i, to, { promo: q }); else add(i, to); };
        const f = (r + dir) * 8 + c;
        if (on(r + dir, c) && !board[f]) {
          push(f);
          const f2 = (r + 2 * dir) * 8 + c;
          if (r === start && !board[f2]) add(i, f2, { double: true });
        }
        for (const dc of [-1, 1]) {
          if (!on(r + dir, c + dc)) continue;
          const t = (r + dir) * 8 + c + dc;
          if (board[t] && board[t][0] !== turn) push(t);
          else if (st.ep === t) add(i, t, { ep: true });
        }
      } else if (k === 'N' || k === 'K') {
        for (const [dr, dc] of k === 'N' ? KN : KG) {
          if (!on(r + dr, c + dc)) continue;
          const t = (r + dr) * 8 + c + dc;
          if (!board[t] || board[t][0] !== turn) add(i, t);
        }
        if (k === 'K') {
          const row = turn === 'w' ? 7 : 0, rights = turn === 'w' ? ['K', 'Q'] : ['k', 'q'];
          if (i === row * 8 + 4 && !attacked(board, i, other(turn))) {
            if (st.castle.includes(rights[0]) && board[row * 8 + 7] === turn + 'R' && !board[row * 8 + 5] && !board[row * 8 + 6]
              && !attacked(board, row * 8 + 5, other(turn)) && !attacked(board, row * 8 + 6, other(turn))) add(i, row * 8 + 6, { castle: 'K' });
            if (st.castle.includes(rights[1]) && board[row * 8] === turn + 'R' && !board[row * 8 + 1] && !board[row * 8 + 2] && !board[row * 8 + 3]
              && !attacked(board, row * 8 + 3, other(turn)) && !attacked(board, row * 8 + 2, other(turn))) add(i, row * 8 + 2, { castle: 'Q' });
          }
        }
      } else {
        const dirs = k === 'B' ? DIAG : k === 'R' ? ORTH : [...DIAG, ...ORTH];
        for (const [dr, dc] of dirs) {
          let rr = r + dr, cc = c + dc;
          while (on(rr, cc)) {
            const t = rr * 8 + cc;
            if (board[t]) { if (board[t][0] !== turn) add(i, t); break; }
            add(i, t); rr += dr; cc += dc;
          }
        }
      }
    }
    return out;
  }
  function chessDo(st, m) {
    const s = clone(st), b = s.board, p = b[m.from], color = p[0];
    const capture = !!b[m.to] || m.ep;
    b[m.to] = m.promo ? color + m.promo : p; b[m.from] = null;
    if (m.ep) b[m.to + (color === 'w' ? 8 : -8)] = null;
    if (m.castle) {
      const row = color === 'w' ? 7 : 0;
      if (m.castle === 'K') { b[row * 8 + 5] = color + 'R'; b[row * 8 + 7] = null; } else { b[row * 8 + 3] = color + 'R'; b[row * 8] = null; }
    }
    // Derechos de enroque
    const lose = (ch) => { s.castle = s.castle.replace(ch, ''); };
    if (p[1] === 'K') { if (color === 'w') { lose('K'); lose('Q'); } else { lose('k'); lose('q'); } }
    for (const [sq, ch] of [[63, 'K'], [56, 'Q'], [7, 'k'], [0, 'q']]) if (m.from === sq || m.to === sq) lose(ch);
    s.ep = m.double ? (m.from + m.to) / 2 : null;
    s.half = p[1] === 'P' || capture ? 0 : s.half + 1;
    s.turn = other(color);
    // Para el empate por repetición (3 veces la misma posición)
    const key = b.map((x) => x || '.').join('') + s.turn + s.castle + (s.ep ?? '');
    s.seen = p[1] === 'P' || capture ? {} : { ...(s.seen || {}) };
    s.seen[key] = (s.seen[key] || 0) + 1;
    s.rep = s.seen[key];
    return s;
  }
  function chessMoves(st) { return pseudo(st).filter((m) => !inCheck(chessDo(st, m), st.turn)); }
  function insufficient(board) {
    const pcs = board.map((p, i) => [p, i]).filter(([p]) => p && p[1] !== 'K');
    if (!pcs.length) return true;
    if (pcs.length === 1 && 'BN'.includes(pcs[0][0][1])) return true;
    // Solo alfiles del mismo color de casilla
    if (pcs.every(([p]) => p[1] === 'B')) { const sq = pcs.map(([, i]) => ((i >> 3) + (i & 7)) % 2); return sq.every((x) => x === sq[0]); }
    return false;
  }
  // Resultado: null (sigue), {winner:'w'|'b', reason:'mate'} o {winner:'draw', reason}
  function chessResult(st) {
    if (!chessMoves(st).length) return inCheck(st) ? { winner: other(st.turn), reason: 'mate' } : { winner: 'draw', reason: 'stalemate' };
    if (insufficient(st.board)) return { winner: 'draw', reason: 'material' };
    if (st.half >= 100) return { winner: 'draw', reason: 'fifty' };
    if ((st.rep || 0) >= 3) return { winner: 'draw', reason: 'repetition' };
    return null;
  }

  // =====================================================================
  // DAMAS (reglas españolas: las fichas avanzan y capturan hacia delante,
  // la dama vuela; capturar es obligatorio y se encadenan los saltos)
  // Piezas: 'w' 'b' fichas, 'W' 'B' damas.
  // =====================================================================
  function checkersInit() {
    const board = Array(64).fill(null);
    for (let i = 0; i < 64; i++) {
      const [r, c] = RC(i);
      if ((r + c) % 2 !== 1) continue;
      if (r < 3) board[i] = 'b'; else if (r > 4) board[i] = 'w';
    }
    return { board, turn: 'w', chain: null, quiet: 0 };
  }
  const colorOf = (p) => (p ? p.toLowerCase() : null);
  const isKing = (p) => !!p && p === p.toUpperCase();
  function ckPieceMoves(st, i, capturesOnly) {
    const { board } = st, p = board[i], color = colorOf(p), out = [];
    const [r, c] = RC(i), fwd = color === 'w' ? -1 : 1;
    if (isKing(p)) {
      for (const [dr, dc] of DIAG) {
        let rr = r + dr, cc = c + dc;
        while (on(rr, cc) && !board[rr * 8 + cc]) { if (!capturesOnly) out.push({ from: i, to: rr * 8 + cc }); rr += dr; cc += dc; }
        if (on(rr, cc) && colorOf(board[rr * 8 + cc]) === other(color)) {
          const cap = rr * 8 + cc;
          rr += dr; cc += dc;
          while (on(rr, cc) && !board[rr * 8 + cc]) { out.push({ from: i, to: rr * 8 + cc, cap }); rr += dr; cc += dc; }
        }
      }
    } else {
      for (const dc of [-1, 1]) {
        const r1 = r + fwd, c1 = c + dc;
        if (!on(r1, c1)) continue;
        const t = r1 * 8 + c1;
        if (!board[t]) { if (!capturesOnly) out.push({ from: i, to: t }); }
        else if (colorOf(board[t]) === other(color) && on(r1 + fwd, c1 + dc) && !board[(r1 + fwd) * 8 + c1 + dc]) out.push({ from: i, to: (r1 + fwd) * 8 + c1 + dc, cap: t });
      }
    }
    return out;
  }
  function checkersMoves(st) {
    if (st.chain != null) return ckPieceMoves(st, st.chain, true).filter((m) => m.cap != null);
    let all = [];
    for (let i = 0; i < 64; i++) if (colorOf(st.board[i]) === st.turn) all = all.concat(ckPieceMoves(st, i, false));
    const caps = all.filter((m) => m.cap != null);
    return caps.length ? caps : all;
  }
  function checkersDo(st, m) {
    const s = clone(st), b = s.board, p = b[m.from], color = colorOf(p);
    b[m.to] = p; b[m.from] = null;
    if (m.cap != null) b[m.cap] = null;
    const lastRow = color === 'w' ? 0 : 7;
    let crowned = false;
    if (!isKing(p) && (m.to >> 3) === lastRow) { b[m.to] = p.toUpperCase(); crowned = true; }
    s.quiet = m.cap != null || !isKing(p) ? 0 : s.quiet + 1;
    if (m.cap != null && !crowned && ckPieceMoves(s, m.to, true).some((x) => x.cap != null)) s.chain = m.to;
    else { s.chain = null; s.turn = other(color); }
    return s;
  }
  function checkersResult(st) {
    if (!checkersMoves(st).length) return { winner: other(st.turn), reason: st.board.some((p) => colorOf(p) === st.turn) ? 'blocked' : 'taken' };
    if (st.quiet >= 50) return { winner: 'draw', reason: 'quiet' };
    return null;
  }

  // =====================================================================
  // REVERSI (Othello): rodea las fichas del otro para darles la vuelta
  // =====================================================================
  function reversiInit() {
    const board = Array(64).fill(null);
    board[27] = 'w'; board[36] = 'w'; board[28] = 'b'; board[35] = 'b';
    return { board, turn: 'b', passed: false };
  }
  function rvFlips(board, i, color) {
    if (board[i]) return [];
    const [r, c] = RC(i), flips = [];
    for (const [dr, dc] of [...DIAG, ...ORTH]) {
      const line = [];
      let rr = r + dr, cc = c + dc;
      while (on(rr, cc) && board[rr * 8 + cc] === other(color)) { line.push(rr * 8 + cc); rr += dr; cc += dc; }
      if (line.length && on(rr, cc) && board[rr * 8 + cc] === color) flips.push(...line);
    }
    return flips;
  }
  function reversiMoves(st) {
    const out = [];
    for (let i = 0; i < 64; i++) if (!st.board[i] && rvFlips(st.board, i, st.turn).length) out.push({ from: null, to: i });
    return out;
  }
  function reversiDo(st, m) {
    const s = clone(st), flips = rvFlips(s.board, m.to, s.turn);
    s.board[m.to] = s.turn;
    for (const f of flips) s.board[f] = s.turn;
    s.flipped = flips;
    s.turn = other(s.turn); s.passed = false;
    // Si el otro no puede jugar, pasa y vuelve a tocar al mismo
    if (!reversiMoves(s).length) { s.turn = other(s.turn); s.passed = true; }
    return s;
  }
  const rvCount = (board) => ({ w: board.filter((x) => x === 'w').length, b: board.filter((x) => x === 'b').length });
  function reversiResult(st) {
    if (reversiMoves(st).length) return null;
    const n = rvCount(st.board);
    return { winner: n.w === n.b ? 'draw' : n.w > n.b ? 'w' : 'b', reason: 'count' };
  }

  // =====================================================================
  const GAMES = {
    chess: { init: chessInit, moves: chessMoves, apply: chessDo, result: chessResult, first: 'w', points: 5 },
    checkers: { init: checkersInit, moves: checkersMoves, apply: checkersDo, result: checkersResult, first: 'w', points: 3 },
    reversi: { init: reversiInit, moves: reversiMoves, apply: reversiDo, result: reversiResult, first: 'b', points: 3 },
  };
  const sameMove = (a, b) => a.to === b.to && (a.from ?? null) === (b.from ?? null) && (a.promo || null) === (b.promo || null);

  const api = { GAMES, other, inCheck, kingAt, rvCount, sameMove };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SaharBoards = api;
})(typeof self !== 'undefined' ? self : this);
