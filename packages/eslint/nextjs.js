/** @type {import("eslint").Linter.Config} */
module.exports = {
  ...require('./index'),
  extends: [...(require('./index').extends || []), 'next/core-web-vitals'],
  rules: {
    ...require('./index').rules,
    'react/react-in-jsx-scope': 'off',
    'react/prop-types': 'off',
  },
};
