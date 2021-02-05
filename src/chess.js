const fs = require('fs');
const btoa = require('btoa'), atob = require('atob');
const chess_fns = require('../public/js/chess_fns');
const colStr = chess_fns.colStr;

const saves_path = "data/games/";
const rows = 8, cols = 8;

class ChessInstance {
  constructor(name, singleplayer, passwd) {
    this._singleplayer = !!singleplayer;
    this._name = name;
    this._passwd = passwd;
    this._allowSpectators = true;

    /**
     * Whose go is it?
     * @type {"w" | "b"}
     */
    this.go = '';

    this._data = "";
    this._moved = "";
    this._taken = "";
    all[name] = this;

    /**
     * Board History. Store board data {d} and moved data {m}
     * @type {{d: string, m: string}[]}
     */
    this._history = [];

    /** Lines of #game-log client-side
     * @type {Array<[string, string, number]>}
     * - [message, title, time_sent]
    */
    this._log = [];

    /** @type {"" | "w" | "b"} */
    this.winner = "";

    /**
     * Array of all connected Connection objects that are players
     * @type {Connection[]}
     */
    this.conns = [];

    /**
     * Array of all connected Connection objects that are spectators
     * @type {Connection[]}
     */
    this.conns_s = [];

    // Populate board and stuff
    this.reset();
  }

  get maxConnections() { return this._singleplayer ? 1 : 2; }

  // Is game full? (can we connect to it?)
  isFull() {
    return this.conns.length == this.maxConnections;
  }

  declareWinner(winner) {
    if (winner == " ") winner = "";
    this.winner = winner;
    if (winner != "") {
      this.writeLog('<span class=\'small-info\'>Winner: ' + colStr(winner) + '</span>');
      let loser = winner == 'w' ? 'b' : 'w';

      // "Kill" all of black's pieces
      let new_data = "";
      for (let i = 0; i < this._data.length; i++) {
        const piece = this._data[i];
        if (piece != pieces.empty && chess_fns.getPieceColour(piece) == loser) {
          let name = chess_fns.getPieceName(piece);
          new_data += pieces[winner][name];
        } else {
          new_data += piece;
        }
      }
      this._data = new_data;
      // this._moved = "1".repeat(rows * cols);
    }
  }

  /**
   * Toggle whose go it is
   */
  toggleGo() {
    this.go = this.go == 'w' ? 'b' : 'w';
  }

  /**
   * Attempt to move piece from src to dst
   * @param {Connection} conn - COnnection object requesting move
   * @param {[number, number]} src - Source
   * @param {[number, number]} dst - Destination
   * @return {{code: number, msg: string }} Response object (code: (0) OK (1) error (2) illegal move)
   */
  attempt_move(conn, src, dst) {
    // Game already won?
    if (this.winner != "") return { code: 1, msg: `This game has been won by ${colStr(this.winner)}` };

    // Is spectator?
    if (conn.spectator) return { code: 1, msg: 'Spectators cannot move pieces' };

    // Generate chess board analysis object
    const chessBoard = chess_fns.chessBoard(
      chess_fns.dataToArray(this._data, cols),
      chess_fns.dataToArray(this._moved, cols)
    );

    // Moving to same location?
    if (src[0] == dst[0] && src[1] == dst[1]) return { code: 1, msg: 'Must move to a different location' };

    const piece_src = chessBoard.getAt(...src), piece_dst = chessBoard.getAt(...dst);

    // Piece locations exist?
    if (piece_src == undefined || piece_dst == undefined) return { code: 1, msg: 'Invalid piece locations (out of bounds)' };

    // Moving a piece?
    if (!chess_fns.isPiece(piece_src)) return { code: 1, msg: 'Must be moving a piece' };

    // Are we allowed to be moving this piece? (are colours OK?)
    let src_colour = chess_fns.getPieceColour(piece_src);
    if (src_colour != this.go) return { code: 2, msg: `Trying to move ${colStr(src_colour)} piece on ${colStr(this.go)}'s go` };
    if (conn.colour != '*' && src_colour != conn.colour) return { code: 2, msg: `${colStr(conn.colour)} player trying to move ${colStr(src_colour)} piece` };

    // Cannot move onto self!
    let dst_colour = chess_fns.getPieceColour(piece_dst);
    if (src_colour == dst_colour) return { code: 2, msg: `Cannot take own piece (${colStr(dst_colour)})<br>(Castling not supported)` };

    // Check if dst is valid spot
    // let validSpots = chessBoard.getMoves(...src);
    let valid = conn.admin || chessBoard.isValidMove(src, dst);

    let movStr = `${colStr(src_colour)} ${chess_fns.getPieceName(piece_src)} from ${chessBoard.lbl(...src)} to ${chessBoard.lbl(...dst)}`;
    if (valid) {
      this.recordState();
      chessBoard.replace(...dst, piece_src);
      chessBoard.replace(...src, pieces.empty);
      this._data = chessBoard.getData();
      this._moved = chessBoard.getMoved();

      let logLine = `${piece_src} ${chessBoard.lbl(...src)} &rarr; ${chessBoard.lbl(...dst)}`;

      if (piece_dst != pieces.empty) {
        movStr += `, taking ${colStr(dst_colour)}'s ${chess_fns.getPieceName(piece_dst)}`;
        this._taken += piece_dst;
        logLine += ' ' + piece_dst;
      }
      this.writeLog(logLine, movStr);

      // Won game?
      if (chess_fns.isPieceA(piece_dst, 'king')) {
        this.declareWinner(this.go);
      }

      return { code: 0, msg: movStr };
    } else {
      movStr = "Cannot move " + movStr;
      return { code: 2, msg: movStr };
    }
  }

  /** Add state to history */
  recordState() {
    this._history.push(this.getDataString());
  }

  /**
   * Restore game to last state
   * @return {boolean} Restores game?
   */
  restore() {
    if (this._history.length > 0) {
      let ds = this._history.pop();
      this.loadDataString(ds);
      return true;
    } else {
      return false;
    }
  }

  /**
   * Write to this._log
   */
  writeLog(text, title = '') {
    this._log.push([text, title, Date.now()]);
    this.conns.forEach(conn => conn.updateLog());
    this.conns_s.forEach(conn => conn.updateLog());
  }

  /**
   * Return object which can be sent to clients, to represent this game's data
   */
  getGameData() {
    return {
      d: this._data,
      m: this._moved,
      t: this._taken,
      w: this.winner,
    };
  }

  /**
   * Return objects which can be sent to clients, to represent this game's stats
   */
  getGameStats() {
    return {
      ppl: this.conns.length,
      max: this.maxConnections,
      spec: this.conns_s.length,
    };
  }

  /**
   * Get data string
   */
  getDataString() {
    return assembleDataString(this._moved, this._data, this._taken, this.winner);
  }

  /**
   * Load data string
   * @param {string} ds - Data String
   */
  loadDataString(ds) {
    let parts = disassembleDataString(ds);
    this._moved = parts[0];
    this._data = parts[1];
    this._taken = parts[2];
    this.declareWinner(parts[3]);
  }

  /** Reset chess game */
  reset() {
    this._data = "";
    this._moved = "";
    this.winner = "";
    this._taken = "";
    this._history.length = 0;
    this.go = "w";

    this._data += pieces.b.rook + pieces.b.knight + pieces.b.bishop + pieces.b.queen + pieces.b.king + pieces.b.bishop + pieces.b.knight + pieces.b.rook;
    this._data += pieces.b.pawn.repeat(cols);
    this._moved += '0'.repeat(cols * 2);
    for (let i = 0; i < 4; i++) {
      this._data += pieces.empty.repeat(cols);
      this._moved += '0'.repeat(cols);
    }
    this._data += pieces.w.pawn.repeat(cols);
    this._data += pieces.w.rook + pieces.w.knight + pieces.w.bishop + pieces.w.queen + pieces.w.king + pieces.w.bishop + pieces.w.knight + pieces.w.rook;
    this._moved += '0'.repeat(cols * 2);
  }

  /**
   * =================================================================
   * = MANAGMENT
   */

  get filepath() { return saves_path + btoa(this._name) + '.json'; }
  get room_name() { return "game:" + this._name; }

  /**
   * Add Connection object
   * @param {Connection} conn
   */
  add_conn(conn) {
    if (this.isFull() && !conn.spectator) throw `Chess.add_conn: Chess game '${this._name}' is full`;
    if (conn.spectator) {
      this.conns_s.push(conn);
    } else {
      this.conns.push(conn);
      conn.colour = this._singleplayer ? '*' : (this.conns.length == 1 ? 'w' : 'b'); // Multiplayer: First player is white
    }
  }

  /**
   * Remove connection object
   */
  remove_conn(conn) {
    let arr = conn.spectator ? this.conns_s : this.conns;
    const i = arr.indexOf(conn);
    if (i !== -1) {
      arr.splice(i, 1);
      conn.socket.leave(this.room_name);
    }
  }

  saveToFile() {
    const data = JSON.stringify({
      s: this._singleplayer ? 1 : 0,
      p: btoa(this._passwd),
      go: this.go,
      d: this.getDataString(),
      as: +this._allowSpectators,
      h: this._history,
      l: this._log,
    });
    fs.writeFile(this.filepath, data, (e) => {
      if (e) {
        console.error(`[[!]] Game '${this._name}': could not save to file\n`, e);
      } else {
        console.log(`Game '${this._name}': saved to file`);
      }
    });
  }

  /** Delete game */
  del() {
    fs.unlink(this.filepath, () => console.log(`Chess.del: deleted file ${this.filepath} `));
    delete all[this._name];
  }
}

/**
 * Validate data - valid chess data?
 * @param {string} data - Data to validate
 * @return {true | string} Return true if valid, else return the bad character
 */
ChessInstance.isValidData = data => {
  if (typeof data != 'string') return false;
  const good = Object.values(pieces.w).concat(Object.values(pieces.b), pieces.empty);
  for (const c of data) {
    if (good.indexOf(c) === -1) return c;
  }
  return true;
};

/**
 * Validate data - valid moved data?
 * @param {string} data - Data to validate
 * @return {true | string} Return true if valid, else return the bad character
 */
ChessInstance.isValidMovedData = data => {
  if (typeof data != 'string') return false;
  for (const c of data) {
    if (c != "0" && c != "1") return c;
  }
  return true;
};

/**
 * Instantiate CheccInstance from data file
 * @param {string} name - data file path.
 * @param {boolean} b64 - is name in base64?
 * @return {ChessInstance}
 */
ChessInstance.fromFile = (name, b64) => {
  let filepath = saves_path + name + '.json';
  let data = JSON.parse(fs.readFileSync(filepath));

  let obj = new ChessInstance(b64 ? atob(name) : name, !!data.s, atob(data.p));
  obj.loadDataString(data.d);
  obj.declareWinner(obj.winner);
  obj.go = data.go;
  obj._allowSpectators = !!data.as;
  obj._history = data.h;
  if (Array.isArray(data.l)) obj._log = data.l;
  return obj;
};

ChessInstance.createNew = (name, singleplayer, passwd) => {
  if (name in all) throw `Game ${name} already exists`;

  let obj = new ChessInstance(name, singleplayer, passwd);
  obj.saveToFile();
  return obj;
};

/**
 * Assmble data string from components
 * @param {string} moved - Movment data
 * @param {string} data - Board data 
 * @param {string} taken - Taken data
 * @param {"" | "w" | "b"} winner - Who is the winner?
 * @return {string} Data string
 */
const assembleDataString = (moved, data, taken, winner) => {
  let data_string = "";
  for (let i = 0; i < data.length; i++) {
    data_string += moved[i].toString() + data[i].toString();
  }
  if (winner == "") winner = " ";
  data_string += '|' + taken + winner;
  return data_string;
};

/**
 * Disassemble data string into components
 * @param {string} string - Data string
 * @return {string[]} [moved, data, taken, winner]
 */
const disassembleDataString = string => {
  let parts = ["", ""], i, j;
  for (i = 0, j = rows * cols * 2; i < j; i += 2) {
    parts[0] += string[i];
    parts[1] += string[i + 1];
  }
  i++; // Skip '|'
  j = string.length - 1;
  parts.push(string.substring(i, j));
  i = j;
  parts.push(string[i++]);
  return parts;
};

/**
 * Object containing all chess games
 * @type {{[name: string]: ChessInstance}}
 */
const all = {};

const pieces = JSON.parse(fs.readFileSync('data/pieces.json'));
pieces.w.all = Object.values(pieces.w);
pieces.b.all = Object.values(pieces.b);
chess_fns.loadPieces(pieces);


module.exports = { ChessInstance, saves_path, all, pieces, rows, cols, };