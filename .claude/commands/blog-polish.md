Review and polish the blog draft at `$ARGUMENTS` using the marketing-editor checklist.

Steps:
1. Read the file at the given path
2. Run the following editorial checks and fix issues directly in the file:
   - **Facts**: Verify all numbers, dates, and source citations are present in `(출처: 기관명, YYYY.MM.DD)` format. Flag any claim without a source.
   - **Tone**: Ensure the writing is practical and clear for Korean shippers (화주/포워더). Remove overly academic or vague sentences.
   - **SEO**: Confirm the H1 title and at least two H2 headings contain target keywords. Title must be under 60 characters.
   - **Length**: Count characters (Korean, including spaces). Target is 1,400–1,600자. Trim or expand as needed.
   - **Legal**: No content from paid sources (Sea-Intelligence, Xeneta, Drewry paid reports). No rate promises or guarantees.
   - **CTAs**: Ensure the closing CTA links use real paths (not `#` placeholders).
3. Output a brief diff summary of what changed (3–5 bullet points max).
4. Update the frontmatter `status` field from `draft` to `reviewed`.

If the file has critical issues that require a full rewrite (missing sources for core data, fabricated numbers), stop and report — do not silently fix fabrications.
