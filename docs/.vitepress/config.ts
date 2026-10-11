import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Connected',
  description: 'Extensible WebRTC Video Conferencing Framework & SFU',
  base: process.env.VITEPRESS_BASE || '/connected/',

  head: [
    ['link', { rel: 'icon', href: '/favicon.ico' }],
    ['meta', { name: 'theme-color', content: '#3b82f6' }],
    ['meta', { name: 'og:type', content: 'website' }],
    ['meta', { name: 'og:title', content: 'Connected - WebRTC Framework & SFU' }],
    ['meta', { name: 'og:description', content: 'Extensible WebRTC video conferencing framework with Go SFU, embedded STUN/TURN, and TypeScript SDK.' }],
  ],

  themeConfig: {
    siteTitle: 'Connected',
    logo: undefined,

    nav: [
      { text: 'Guide', link: '/guide/introduction' },
      { text: 'API Reference', link: '/api/server-config' },
      { text: 'Examples', link: '/examples/web-demo' },
      {
        text: 'v0.1.0',
        items: [
          { text: 'Changelog', link: 'https://github.com/connected-framework/connected/releases' },
          { text: 'Roadmap', link: 'https://github.com/connected-framework/connected/blob/main/ROADMAP.md' },
        ],
      },
    ],

    sidebar: [
      {
        text: 'Getting Started',
        collapsed: false,
        items: [
          { text: 'Introduction', link: '/guide/introduction' },
          { text: 'Quickstart', link: '/guide/quickstart' },
          { text: 'Architecture & Media Plane', link: '/guide/architecture' },
        ],
      },
      {
        text: 'Core Guides',
        collapsed: false,
        items: [
          { text: 'Authentication Modes', link: '/guide/authentication' },
          { text: 'Permissions & Moderation', link: '/guide/permissions-moderation' },
          { text: 'Production Deployment', link: '/guide/deployment' },
        ],
      },
      {
        text: 'API Reference',
        collapsed: false,
        items: [
          { text: 'Go Server Configuration', link: '/api/server-config' },
          { text: 'Signaling Wire Protocol', link: '/api/signaling-protocol' },
          { text: 'TypeScript Core SDK', link: '/api/client-core-sdk' },
        ],
      },
      {
        text: 'Reference Examples',
        collapsed: false,
        items: [
          { text: 'Web Demo UI', link: '/examples/web-demo' },
          { text: 'Auth Webhook (Node.js)', link: '/examples/auth-webhook' },
          { text: 'Native Go Server Extension', link: '/examples/native-go-server' },
        ],
      },
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/connected-framework/connected' },
    ],

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2026 Connected Contributors',
    },

    search: {
      provider: 'local',
    },

    outline: {
      level: [2, 3],
    },
  },
});
