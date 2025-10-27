// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import openapi from 'starlight-openapi-navigator';

const mode = process.env.NODE_ENV ?? "development";

// https://astro.build/config
export default defineConfig({
  site: mode === 'production' ? 'https://bline.github.io' : undefined,
  base: '/starlight-openapi-navigator/',
  vite: {
    build: {
      sourcemap: false,
    },
  },
	integrations: [
		starlight({
			title: 'My Docs',
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/bline/starlight-openapi-navigator' }],
			sidebar: [
				{
					label: 'Guides',
					items: [
						// Each item here is one entry in the navigation menu.
						{ label: 'Example Guide', slug: 'guides/example' },
					],
				},
				{
					label: 'Reference',
					autogenerate: { directory: 'reference' },
				},
			],
      plugins: [
        openapi([
          {
            instanceId: 'stripe',
            specPath: 'https://raw.githubusercontent.com/stripe/openapi/refs/heads/master/openapi/spec3.yaml',
            navigation: {
              enabled: true,
              groupLabel: 'Stripe Full',
              insertBefore: 'Resources',
            },
          },
          {
            instanceId: 'msgraph',
            specPath: 'https://raw.githubusercontent.com/microsoftgraph/msgraph-metadata/master/openapi/v1.0/openapi.yaml',
            operations: {
              include: [
                { pathStartsWith: '/users' },
              ]
            },
            navigation: {
              enabled: true,
              groupLabel: 'MS Graph /users',
              insertBefore: 'Resources',
            },
          }
        ]),
      ]
		}),
	],
});
