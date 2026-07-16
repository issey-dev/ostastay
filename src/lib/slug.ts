// Minimal slugify — used wherever an Enterprise needs a url-safe slug derived from its
// name (e.g. /e/{slug}/login). Not guaranteed unique on its own; callers that insert a
// new Enterprise should retry with a numeric suffix on a unique-constraint collision.
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "enterprise";
}
