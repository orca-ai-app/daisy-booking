import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
        customElements: 'readonly',
        HTMLElement: 'readonly',
        HTMLDialogElement: 'readonly',
        HTMLInputElement: 'readonly',
        HTMLFormElement: 'readonly',
        ShadowRoot: 'readonly',
        FormData: 'readonly',
        KeyboardEvent: 'readonly',
        fetch: 'readonly',
        Intl: 'readonly',
        __SUPABASE_URL__: 'readonly',
        __SUPABASE_ANON_KEY__: 'readonly',
        console: 'readonly',
      },
    },
  },
);
