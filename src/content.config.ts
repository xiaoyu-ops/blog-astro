import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD format")
  .refine((value) => !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()), "Use a valid date");

const requireReadyDescription = (
  value: { description: string; draft?: boolean },
  context: z.RefinementCtx,
) => {
  if (!value.draft && value.description.trim().startsWith("TODO")) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Published content needs a real description",
      path: ["description"],
    });
  }
};

const projects = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/projects" }),
  schema: z
    .object({
      title: z.string(),
      description: z.string().min(1),
      date: dateString.optional(),
      draft: z.boolean().optional(),
      order: z.number().optional(),
      tags: z.array(z.string()).optional(),
    })
    .superRefine(requireReadyDescription),
});

const blog = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/blog" }),
  schema: z
    .object({
      title: z.string(),
      description: z.string().min(1),
      date: dateString,
      draft: z.boolean().optional(),
      tags: z.array(z.string()).optional(),
    })
    .superRefine(requireReadyDescription),
});

export const collections = { projects, blog };
