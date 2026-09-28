/**
 * Programme query keys, in a module of their own so the progress hooks can invalidate milestones
 * (approving a report moves a milestone's `readyToVerify`) without importing `use-programme`,
 * which itself imports the progress keys.
 */
export const programmeKeys = {
  milestones: (projectId: string) => ['programme', projectId, 'milestones'] as const,
  activities: (projectId: string) => ['programme', projectId, 'activities'] as const,
};
