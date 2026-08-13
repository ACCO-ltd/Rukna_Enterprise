export function assertFourEyesPublication(editorUserId: string | null, publisherUserId: string): void {
  if (!editorUserId) {
    throw new Error('WORKFLOW_EDITOR_IDENTITY_REQUIRED');
  }
  if (editorUserId === publisherUserId) {
    throw new Error('WORKFLOW_FOUR_EYES_VIOLATION');
  }
}
