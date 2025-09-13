const sveltePreprocess = require('svelte-preprocess');

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Use sveltePreprocess for handling TypeScript
	preprocess: sveltePreprocess({
		typescript: true,
	}),
	
	compilerOptions: {
		// CSS is injected by esbuild
		css: 'injected',
		// Enable all warnings in development
		dev: process.env.NODE_ENV !== 'production',
		// Disable runes mode for gradual migration
		runes: false,
		// Enable compatibility mode for Svelte 5
		compatibility: {
			componentApi: 4
		}
	}
};

module.exports = config;