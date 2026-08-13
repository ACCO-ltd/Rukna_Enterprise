import { assertFourEyesPublication } from './workflow-publication.policy.js';

describe('workflow publication policy', () => {
  it('requires a known editor and a different publisher', () => {
    expect(() => assertFourEyesPublication(null, 'publisher')).toThrow(
      'WORKFLOW_EDITOR_IDENTITY_REQUIRED',
    );
    expect(() => assertFourEyesPublication('same-user', 'same-user')).toThrow(
      'WORKFLOW_FOUR_EYES_VIOLATION',
    );
    expect(() => assertFourEyesPublication('editor', 'publisher')).not.toThrow();
  });
});
