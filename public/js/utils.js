String.prototype.replaceAt = function (index, replacement) {
  return this.substr(0, index) + replacement + this.substr(index + replacement.length);
};

/**
 * Get vertical index from row, col in chess board
 * @param {number} r - row
 * @param {number} c - col
 * @return {number} Vertical index
*/
const getVertIndex = (r, c) => (r * game.renderOpts.cols) + c;

/**
 * Get row, col from vertical index in chess board
 * @param {number} i - Vertical index
 * @return {[number, number]} [row, col]
*/
const getRowCol = i => ([parseInt(i / game.renderOpts.cols), i % game.renderOpts.cols]);

const formatDate = ms => {
  const D = new Date(ms);
  return `${D.getDate().toString().padStart(2, '0')}/${D.getMonth().toString().padStart(2, '0')}/${D.getFullYear()} ${D.getHours().toString().padStart(2, '0')}:${D.getMinutes().toString().padStart(2, '0')}:${D.getSeconds().toString().padStart(2, '0')
    }`;
};