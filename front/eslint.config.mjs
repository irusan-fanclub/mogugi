// Flat config for ESLint 10. Replaces the inherited src/.eslintrc.js, which
// the eslintrc format no longer supports.
import pluginVue from 'eslint-plugin-vue';
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript';

export default defineConfigWithVueTs(
    { files: ['src/**/*.{ts,js,vue}'] },
    { ignores: ['dist/**', 'node_modules/**', '.cache/**', 'public/**'] },
    pluginVue.configs['flat/essential'],
    vueTsConfigs.recommended,
    {
        rules: {
            // Carried over from the old src/.eslintrc.js.
            'no-console': 'off',
            'vue/multi-word-component-names': 'off',
            '@typescript-eslint/no-explicit-any': 'off',
            // A leading underscore marks a parameter kept for the signature of
            // an overridden method but deliberately unused in the body.
            '@typescript-eslint/no-unused-vars': ['error', {
                argsIgnorePattern: '^_',
                varsIgnorePattern: '^_',
                caughtErrorsIgnorePattern: '^_',
            }],
        },
    },
);
