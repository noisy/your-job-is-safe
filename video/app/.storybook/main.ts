import type { StorybookConfig } from '@storybook/html-vite';

const config: StorybookConfig = {
  stories: ['../src/stories/*.stories.ts'],
  framework: { name: '@storybook/html-vite', options: {} },
  // fonts from public/, the song and the analysis data from the project root
  staticDirs: ['../public', { from: '../../audio', to: '/audio' }, { from: '../../data', to: '/data' }],
  core: { disableTelemetry: true },
};
export default config;
