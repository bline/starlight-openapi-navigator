// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import openapi from 'starlight-openapi-navigator';

// https://astro.build/config
export default defineConfig({
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
        openapi({
          specPath: 'https://raw.githubusercontent.com/stripe/openapi/refs/heads/master/openapi/spec3.yaml',
          navigation: {
            enabled: true,
            replaceGroupLabel: 'API Explorer',
            insertBefore: 'Resources',
            operationLabel: 'path',
            overviewItem: {
              label: 'Overview',
              badge: { text: 'beta', variant: 'note' },
            },
          },
        }),
      ]
		}),
	],
});
