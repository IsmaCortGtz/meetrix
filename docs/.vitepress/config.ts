import process from 'node:process';
import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Meetrix',
  description: 'Extensible WebRTC Video Conferencing Framework & SFU',
  base: process.env.VITEPRESS_BASE || '/meetrix/',

  head: [
    ['link', { rel: 'icon', href: '/icon.svg' }],
    ['meta', { name: 'theme-color', content: '#3b82f6' }],
    ['meta', { name: 'og:type', content: 'website' }],
    ['meta', { name: 'og:title', content: 'Meetrix - WebRTC Framework & SFU' }],
    ['meta', { name: 'og:description', content: 'Extensible WebRTC video conferencing framework with Go SFU, embedded STUN/TURN, and TypeScript SDK.' }],
  ],

  themeConfig: {
    siteTitle: 'Meetrix',
    logo: '/logo.svg',

    nav: [
      { text: 'Guide', link: '/guide/introduction' },
      { text: 'API Reference', link: '/api/server-config' },
      { text: 'Examples', link: '/examples/web-demo' },
      {
        text: 'v0.1.0',
        items: [
          { text: 'Changelog', link: 'https://github.com/IsmaCortGtz/meetrix/releases' },
          { text: 'Roadmap', link: 'https://github.com/IsmaCortGtz/meetrix/blob/main/ROADMAP.md' },
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
      { icon: 'github', link: 'https://github.com/IsmaCortGtz/meetrix' },
    ],

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2026 Meetrix Contributors',
    },

    search: {
      provider: 'local',
    },

    outline: {
      level: [2, 3],
    },
  },
});
