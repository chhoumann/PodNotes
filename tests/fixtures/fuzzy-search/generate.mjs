// Records fuse.js 7.5.0 results for the two searches src/utility/fuzzySearch.ts
// ported from it, with the options PodNotes passed to Fuse. fuse.js is not a
// dependency, so fetch it to regenerate:
//   npm pack fuse.js@7.5.0 && tar xzf fuse.js-7.5.0.tgz
//   node tests/fixtures/fuzzy-search/generate.mjs package/dist/fuse.mjs tests/fixtures/fuzzy-search/fuse-7.5.0.json
import fs from "node:fs";

const [fusePath, out] = process.argv.slice(2);
const { default: Fuse } = await import(fusePath);

let seed = 20261012;
const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = (list) => list[Math.floor(rand() * list.length)];

const titles = [
	"Should we all be getting tariff refunds right now?",
	"Charles Ponzi's scheme (plus a new scam)",
	"Where all those weird new drinks are coming from",
	"Who’s gonna pay for your Social Security?",
	"The Indicator from Planet Money",
	"Planet Money Summer School 1: Economics is everywhere",
	"Summer School 2: Supply and demand, explained with drinks",
	"Money",
	"#501 – DHH: Future of Programming, AI, Ruby on Rails, Productivity & Parenting",
	"Episode 12: Café crème and the économie of crêpes",
	"Ep. 7 — 東京 market report 📈",
	"Bonus episode:\ttabs and non-breaking spaces",
	"The Indicator from Planet Money: the economics of everything, explained in ten minutes about tariffs and the trade deficit",
	"The Indicator from Planet Money: the economics of everything, explained in ten minutes about housing and why rent keeps going up",
	"Why rent keeps going up",
	"Rents",
	"Rent",
	"RENT CONTROL, explained (again)",
	"Interest rates [part 1/3] (rates)",
	"Interest rates [part 2/3] (rates)",
	"Interest rates [part 3/3] (rates)",
	"A",
	"How the Fed sets interest rates and why it matters for your mortgage, your savings account, and the price of eggs",
	"Live Q&A: listener mailbag #42",
	"Money money money money money",
	"The Indicator from Planet Money: the economics of tariffs",
	"The Indicator from Planet Money: the economics of rent control in big cities",
	"The Indicator from Planet Money: the economics of everything",
];
const SHARED_PREFIX = "The Indicator from Planet Money: the economics of";
const tags =
	"artwork author chapters content currentdate date description duration episodeartwork episodelink episodenumber episodeurl feedartwork feedurl linksegment linktime podcast podcastlink safetitle segment stream time title transcript url".split(
		" ",
	);

const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

function typo(text, edits) {
	let s = text;
	for (let i = 0; i < edits && s.length > 1; i++) {
		const at = Math.floor(rand() * s.length);
		const op = Math.floor(rand() * 4);
		const ch = pick("abcdefghijklmnopqrstuvwxyz ");
		if (op === 0) s = s.slice(0, at) + ch + s.slice(at);
		else if (op === 1) s = s.slice(0, at) + s.slice(at + 1);
		else if (op === 2) s = s.slice(0, at) + ch + s.slice(at + 1);
		else if (at + 1 < s.length) s = s.slice(0, at) + s[at + 1] + s[at] + s.slice(at + 2);
	}
	return s;
}

function queriesFor(corpus, count) {
	const long = corpus.filter((text) => text.length > 64);
	const queries = new Set(
		[
			"new",
			"new s",
			"summer schol",
			"zzzz",
			"rent",
			"RATES",
			"  money ",
			"économie",
			"📈",
			"(part",
			"a",
			...long,
			...long.map((text) => typo(text, 2)),
			...long.map((text) => typo(text.toUpperCase(), 4)),
			...(corpus === titles
				? [
						SHARED_PREFIX,
						`${SHARED_PREFIX} rent`,
						typo(SHARED_PREFIX, 2),
						SHARED_PREFIX.toUpperCase(),
						"the indicator from planet money the economics of everything explained",
					]
				: []),
		].filter((q) => !LONE_SURROGATE.test(q)),
	);
	while (queries.size < count) {
		const text = pick(corpus);
		const start = Math.floor(rand() * Math.max(1, text.length - 3));
		const length =
			1 + Math.floor(rand() * Math.min(text.length - start, rand() < 0.3 ? 130 : 24));
		let q = text.slice(start, start + length);
		if (rand() < 0.5) q = typo(q, 1 + Math.floor(rand() * 3));
		if (rand() < 0.2) q = q.toUpperCase();
		if (q.trim() && !LONE_SURROGATE.test(q)) queries.add(q);
	}
	return [...queries];
}

const titleOptions = {
	shouldSort: true,
	findAllMatches: true,
	threshold: 0.4,
	isCaseSensitive: false,
	keys: ["title"],
};
const tagOptions = {
	shouldSort: true,
	findAllMatches: false,
	threshold: 0.4,
	isCaseSensitive: false,
};
const episodeFuse = new Fuse(
	titles.map((title) => ({ title })),
	titleOptions,
);
const tagFuse = new Fuse(tags, tagOptions);

const record = {
	fuse: "7.5.0",
	titleOptions,
	tagOptions,
	titles,
	tags,
	titleQueries: queriesFor(titles, 150).map((q) => [
		q,
		episodeFuse.search(q).map((r) => r.refIndex),
	]),
	tagQueries: queriesFor(tags, 80).map((q) => [q, tagFuse.search(q).map((r) => r.refIndex)]),
};
fs.writeFileSync(out, JSON.stringify(record));
const lens = record.titleQueries.map(([q]) => q.length);
console.log(
	`titles ${titles.length}, tags ${tags.length}, title queries ${record.titleQueries.length} (max length ${Math.max(...lens)}, over 64: ${lens.filter((l) => l > 64).length}), tag queries ${record.tagQueries.length}, empty results ${[...record.titleQueries, ...record.tagQueries].filter(([, r]) => r.length === 0).length}`,
);
