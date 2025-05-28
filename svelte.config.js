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
	}
};

module.exports = config;