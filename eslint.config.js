import tseslint from 'typescript-eslint';

export default tseslint.config(
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // The bookmarklet runs in a hostile, unversioned DOM. Defensive `any` at the
      // boundary is intentional; we narrow immediately after.
      '@typescript-eslint/no-explicit-any': 'off',
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'loopmark makes zero network requests. See SECURITY.md.' },
        { name: 'XMLHttpRequest', message: 'loopmark makes zero network requests. See SECURITY.md.' },
        { name: 'WebSocket', message: 'loopmark makes zero network requests. See SECURITY.md.' },
        { name: 'EventSource', message: 'loopmark makes zero network requests. See SECURITY.md.' },
      ],
    },
  },
  { ignores: ['dist/**', 'node_modules/**', 'spikes/**'] },
);
