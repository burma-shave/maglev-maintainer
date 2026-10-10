// Public tool grouping is stable and independent of package branding.
export const MAGLEV_TOOL_NAMESPACE = {
	name: "maglev",
	description: "Maglev maintenance: Benches, PR triage and reviews, repositories, artifacts, and API runtimes.",
	instructions: "Use maglev_workspace_context for configured paths and capabilities. Lifecycle mutations default to plans and require explicit authorization to apply. PR review drafts are local and never submitted by the draft tools. Preserve tool-owned state and existing Bench identities.",
};
