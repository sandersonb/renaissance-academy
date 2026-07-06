import { describe, it, expect } from 'vitest';
import { createMemoryRepositories, seedSurvey } from '../src/app/adapters/memory/index.js';
import { AdminSurveyService, AdminSurveyError } from '../src/app/services/adminSurveyService.js';
import { SurveyService } from '../src/app/services/surveyService.js';

function svc() {
  const repos = createMemoryRepositories();
  seedSurvey(repos.store);
  return { repos, admin: new AdminSurveyService(repos.survey) };
}

describe('AdminSurveyService', () => {
  it('lists all questions (incl. inactive) with their options', async () => {
    const { admin } = svc();
    const qs = await admin.list();
    expect(qs.length).toBeGreaterThan(0);
    const kSession = qs.find((q) => q.titleId === 6);
    expect(kSession?.options.length).toBeGreaterThan(0); // AM/PM
  });

  it('creates a question + options that the parent survey flow then serves', async () => {
    const { repos, admin } = svc();
    const id = await admin.createQuestion({ question: 'Favorite subject?', lotteryQuestion: 1, inputType: 'single_select', sortOrder: 5 });
    await admin.addOption(id, 'Math');
    await admin.addOption(id, 'Art');

    // The data-driven survey engine immediately sees the new question.
    const survey = new SurveyService(repos.children, repos.survey);
    const next = await survey.nextLotteryQuestion(123);
    expect(next?.titleId).toBe(id); // sortOrder 5 -> first
    expect(next?.options.map((o) => o.value)).toEqual(['Math', 'Art']);
  });

  it('edits and soft-deletes (deactivates) a question', async () => {
    const { repos, admin } = svc();
    await admin.updateQuestion(20, { question: 'How did you hear about us (2026)?' });
    await admin.setActive(20, false);
    const qs = await admin.list();
    expect(qs.find((q) => q.titleId === 20)?.active).toBe(false);
    // a deactivated question is no longer served to parents
    const survey = new SurveyService(repos.children, repos.survey);
    const served = await survey.nextLotteryQuestion(1);
    expect(served?.titleId).not.toBe(20);
  });

  it('edits and deletes options', async () => {
    const { repos, admin } = svc();
    const id = await admin.addOption(6, 'Full-day');
    await admin.updateOption(id, 'Full Day');
    expect((await repos.survey.options(6)).find((o) => o.extraId === id)?.value).toBe('Full Day');
    await admin.deleteOption(id);
    expect((await repos.survey.options(6)).find((o) => o.extraId === id)).toBeUndefined();
  });

  it('rejects invalid input type / lottery flag / empty text', async () => {
    const { admin } = svc();
    await expect(admin.createQuestion({ question: 'x', lotteryQuestion: 1, inputType: 'slider' as never })).rejects.toBeInstanceOf(AdminSurveyError);
    await expect(admin.createQuestion({ question: 'x', lotteryQuestion: 5 as never, inputType: 'text' })).rejects.toBeInstanceOf(AdminSurveyError);
    await expect(admin.createQuestion({ question: '  ', lotteryQuestion: 1, inputType: 'text' })).rejects.toThrow(/required/);
  });
});
