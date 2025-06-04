import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';
import type {Options as DocsOptions} from '@docusaurus/plugin-content-docs';
import type {Options as BlogOptions} from '@docusaurus/plugin-content-blog';
import type {Options as ThemeOptions} from '@docusaurus/theme-classic';

const lightCodeTheme = require('prism-react-renderer/themes/github');
const darkCodeTheme = require('prism-react-renderer/themes/dracula');

const config: Config = {
  title: 'AI News Aggregator',
  tagline: 'A modular TypeScript-based news aggregator that collects, enriches, and analyzes AI-related content',
  url: 'https://m3-org.github.io',
  baseUrl: '/ai-news/',
  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',
  favicon: 'img/favicon.ico', // Assuming you will add a favicon here
  organizationName: 'm3-org',
  projectName: 'ai-news',

  markdown: {
    mermaid: true,
  },
  themes: ['@docusaurus/theme-mermaid'],
  plugins: [
    require.resolve('docusaurus-lunr-search'),
    [
      'docusaurus-plugin-typedoc',
      // Plugin / TypeDoc options
      {
        entryPoints: ['../src/index.ts'],
        tsconfig: '../tsconfig.json',
        // Consider adding an output directory like 'api' to keep it organized
        // out: 'api',
        // sidebar: {
        //   categoryLabel: 'API Reference',
        //   position: 5, // Adjust as needed to fit into your existing sidebar
        //   fullNames: true,
        // },
      },
    ],
  ],

  presets: [
    [
      '@docusaurus/preset-classic',
      {
        docs: {
          sidebarPath: require.resolve('./sidebars.ts'), // Updated to .ts
          editUrl: 'https://github.com/m3-org/ai-news/edit/main/docs/',
        } satisfies DocsOptions,
        blog: {
          showReadingTime: true,
          editUrl:
            'https://github.com/m3-org/ai-news/edit/main/docs/blog/',
        } satisfies BlogOptions,
        theme: {
          customCss: require.resolve('./src/css/custom.css'),
        } satisfies ThemeOptions,
      } satisfies Preset.Options,
    ],
  ],

  themeConfig:
    {
      navbar: {
        title: 'AI News Aggregator',
        logo: {
          alt: 'AI News Aggregator Logo', // TODO: Add your logo
          src: 'img/logo.svg', // Assuming you will add a logo
        },
        items: [
          {
            type: 'doc',
            docId: 'introduction',
            position: 'left',
            label: 'Documentation',
          },
          {to: '/blog', label: 'Blog', position: 'left'},
          {
            href: 'https://github.com/m3-org/ai-news',
            label: 'GitHub',
            position: 'right',
          },
        ],
      },
      footer: {
        style: 'dark',
        links: [
          {
            title: 'Docs',
            items: [
              {
                label: 'Documentation',
                to: '/docs/introduction',
              },
            ],
          },
          {
            title: 'More',
            items: [
              {
                label: 'Blog',
                to: '/blog',
              },
              {
                label: 'GitHub',
                href: 'https://github.com/m3-org/ai-news',
              },
            ],
          },
        ],
        copyright: `Copyright © ${new Date().getFullYear()} AI News Aggregator. Built with Docusaurus.`, // TODO: Update copyright if needed
      },
      prism: {
        theme: lightCodeTheme,
        darkTheme: darkCodeTheme,
      },
    } satisfies Preset.ThemeConfig,
};

export default config; 