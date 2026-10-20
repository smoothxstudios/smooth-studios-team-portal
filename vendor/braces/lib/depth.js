'use strict';
const MAX_DEPTH = 128;
// Iterative validation also covers callers supplying their own AST. Parent and
// prev links are intentionally not traversed: they are parser back-references.
function checkDepth(ast) {
  const pending = [[ast, 0]];
  let visited = 0;
  while (pending.length) {
    const [node, depth] = pending.pop();
    if (depth >= MAX_DEPTH || ++visited > 131072) throw new SyntaxError('Brace pattern nesting exceeds limit');
    if (node && Array.isArray(node.nodes)) {
      for (const child of node.nodes) pending.push([child, depth + 1]);
    }
  }
}
module.exports = { MAX_DEPTH, checkDepth };
