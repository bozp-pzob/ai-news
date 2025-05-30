import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

/**
 * Creating a sidebar enables you to:
 - create an ordered group of docs
 - render a sidebar for each doc of that group
 - provide next/previous navigation

The sidebars can be generated from the filesystem, or explicitly defined here.

 Create as many sidebars as you want.
 */
const sidebars: SidebarsConfig = {
  // By default, Docusaurus generates a sidebar from the docs folder structure.
  // We will use this for the main documentation.
  projectSidebar: [
    {
      type: 'doc',
      id: 'introduction',
      // label: 'Introduction', // Docusaurus infers from frontmatter
    },
    {
      type: 'category',
      label: 'Getting Started',
      collapsed: false,
      items: [
        'getting-started/installation',    // Will use sidebar_label from file
        'getting-started/configuration', 
        'getting-started/running-the-app',
      ],
    },
    {
      type: 'category',
      label: 'Core Concepts',
      collapsed: true,
      items: [
        'core-concepts/project-structure',
        'core-concepts/data-flow',
        'core-concepts/key-data-structures',
      ],
    },
    {
      type: 'category',
      label: 'Plugins',
      collapsed: true,
      items: [
        'plugins/overview', 
        'plugins/sources',
        'plugins/ai',
        'plugins/enrichers',
        'plugins/generators',
        'plugins/storage',
      ],
    },
    {
      type: 'doc',
      id: 'contributing',
      // label: 'Contributing', // Docusaurus infers from frontmatter
    },
    // {
    //   type: 'doc',
    //   id: 'license', // license.md was deleted
    //   label: 'License',
    // },
  ],

  // Example of how you could define a manual sidebar if needed in the future:
  /*
  manualSidebar: [
    {
      type: 'doc',
      id: 'introduction', // Assuming introduction.md exists
      label: 'Manual Intro',
    },
    {
      type: 'category',
      label: 'Manual Category',
      items: [
        // Assuming a doc with id 'manual-doc1' exists in your docs folder
        {type: 'doc', id: 'manual-doc1', label: 'My Manual Doc'}
      ],
    },
  ],
  */
};

export default sidebars; 