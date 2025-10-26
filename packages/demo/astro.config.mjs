// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import openapi from 'starlight-openapi-navigator';

// https://astro.build/config
export default defineConfig({
  site: 'https://bline.github.io',
  base: '/starlight-openapi-navigator/',
  vite: {
    build: {
      sourcemap: false,
    },
  },
	integrations: [
		starlight({
			title: 'My Docs',
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/withastro/starlight' }],
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
              groupLabel: 'Stripe',
              insertBefore: 'Resources',
              operationLabel: 'path',
              overviewItem: {
                label: 'Overview',
              },
            },
          },
          {
            instanceId: 'msgraph',
            specPath: 'https://raw.githubusercontent.com/microsoftgraph/msgraph-metadata/master/openapi/v1.0/openapi.yaml',
            navigation: {
              enabled: true,
              groupLabel: 'Microsoft Graph',
              insertBefore: 'Resources',
              operationLabel: 'path',
              overviewItem: {
                label: 'Overview',
              },
            },
          }
        ]),
      ]
		}),
	],
});
