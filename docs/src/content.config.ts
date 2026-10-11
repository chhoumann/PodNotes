import { defineCollection } from "astro:content";
import { z } from "astro/zod";
import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";

export const collections = {
	docs: defineCollection({
		loader: docsLoader(),
		schema: docsSchema({
			// Pins each page's URL. Without it Astro derives a lowercased slug
			// from the file name, which would silently change /QuickAdd/.
			extend: z.object({
				slug: z.string().min(1),
				// The id MkDocs gave this page's H1. PageTitle keeps it as an alias so
				// old links such as /api/#api still land on the title.
				legacyTitleId: z.string().min(1).optional(),
			}),
		}),
	}),
};
