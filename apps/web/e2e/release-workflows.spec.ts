import { expect, scenario, test } from './fixtures';

test.describe('release-critical creation workflows', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 700, 'mutating workflows run once');

  test('creates a client and hands it into the project wizard', async ({ app }) => {
    const run = Date.now().toString(36).toUpperCase();
    const clientName = `E2E Client ${run}`;
    const projectCode = `E2E-${run.slice(-8)}`;
    const projectName = `E2E Project ${run}`;

    await app.goto('/clients/new');
    await app.getByLabel('Name').fill(clientName);
    await app.getByLabel('Contact person').fill('Release QA');
    await app.getByLabel('Email').fill(`release.${run.toLowerCase()}@example.test`);
    await app.getByLabel('Default currency').selectOption('USD');
    await app.getByRole('button', { name: 'Create client' }).click();

    await app.waitForURL(/\/clients\/[^/]+$/);
    await expect(app.getByRole('heading', { level: 1 })).toContainText(clientName);

    await app.getByRole('link', { name: 'New project' }).click();
    await app.getByLabel('Project code').fill(projectCode);
    await app.getByLabel('Project name').fill(projectName);
    await expect(app.getByLabel('Client')).toHaveValue(clientName);
    await app.getByRole('button', { name: 'Next' }).click();
    await app.getByLabel('Start date').fill('2026-09-01');
    await app.getByLabel('Expected completion').fill('2027-03-31');
    await app.getByRole('button', { name: 'Review & create' }).click();
    await expect(app.getByText(projectCode)).toBeVisible();
    await app.getByRole('button', { name: 'Create project' }).click();

    await app.waitForURL(/\/projects\/[^/]+$/);
    await expect(app.getByRole('heading', { level: 1 })).toContainText(projectName);
    await expect(app.getByText('Project setup')).toBeVisible();
  });

  test('creates a payment application from the project workspace', async ({ app }) => {
    await app.goto(`/projects/${scenario.projectId}/ipc`);
    await app.getByRole('link', { name: 'New Application' }).click();
    await app.getByLabel('Period from').fill('2026-07-01');
    await app.getByLabel('Period to').fill('2026-07-31');
    await app.getByLabel('Notes').fill('Created by the Phase 6 release workflow');
    await app.getByRole('button', { name: 'Create application' }).click();

    await app.waitForURL(/\/contracts\/[^/]+\/applications\/[^/]+$/);
    await expect(app.getByText('Draft', { exact: true }).first()).toBeVisible();
    await expect(app.getByText('Created by the Phase 6 release workflow')).toBeVisible();
  });

  test('issues and supersedes certificates through the complete wizard', async ({ app }) => {
    test.slow();
    const applicationPath = `/contracts/${scenario.contractId}/applications/${scenario.certificationIpaId}`;

    const issueCertificate = async () => {
      await app.goto(`${applicationPath}/certificates/new`);
      await app.getByLabel('Certificate Outcome').selectOption('CERTIFIED');
      await app.getByRole('button', { name: 'Continue to Items' }).click();
      await app.getByRole('button', { name: 'Continue to Review' }).click();
      await app.getByRole('button', { name: 'Issue Certificate' }).click();
      await app.waitForURL(new RegExp(`${applicationPath}$`));
    };

    await issueCertificate();
    await expect(app.getByText('Effective', { exact: true }).first()).toBeVisible();

    await issueCertificate();
    await app
      .getByRole('link', { name: /^IPC-\d+/ })
      .first()
      .click();
    await app.getByRole('button', { name: 'Make This Certificate Effective' }).click();
    await app.getByLabel('Reason for supersession').fill('Corrected certification assessment');
    await app.getByRole('button', { name: 'Make Effective' }).click();

    await expect(app.getByText(/not yet effective/i)).toBeHidden();
    await expect(app.getByRole('button', { name: 'Make This Certificate Effective' })).toBeHidden();
  });
});
