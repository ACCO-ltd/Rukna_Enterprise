/* Lets ts-node load sources that import siblings with `.js` specifiers (as tsc emits them). */
const Module = require('node:module');
const original = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  try {
    return original.call(this, request, parent, ...rest);
  } catch (err) {
    if (request.startsWith('.') && request.endsWith('.js')) {
      return original.call(this, request.slice(0, -3) + '.ts', parent, ...rest);
    }
    throw err;
  }
};
