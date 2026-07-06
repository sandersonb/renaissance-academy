/**
 * AdminSurveyService — the survey question-manager (deviation B8). Lets staff
 * add/edit/reorder/activate questions and their options without a deploy, which
 * is the #1 maintenance ask. Backed entirely by ExtraTitles/Extra (the same data
 * the parent/offer flows read), so edits take effect immediately.
 */
import type { ExtraOptionRecord, SurveyInputType, SurveyRepo } from '../ports/repositories.js';

export class AdminSurveyError extends Error {}

const INPUT_TYPES: SurveyInputType[] = ['text', 'textarea', 'single_select', 'multi_select', 'date'];

export interface QuestionAdminView {
  titleId: number;
  question: string;
  grade: string | null;
  lotteryQuestion: number;
  inputType: SurveyInputType;
  active: boolean;
  sortOrder: number;
  brief: string | null;
  options: ExtraOptionRecord[];
}

export interface CreateQuestionInput {
  question: string;
  lotteryQuestion: number; // 0 = registration, 1 = lottery
  grade?: string | null; // scope like "-6-7-8-9-" or null = all
  inputType: SurveyInputType;
  sortOrder?: number;
  brief?: string | null;
}

function validateType(t: unknown): SurveyInputType {
  if (!INPUT_TYPES.includes(t as SurveyInputType)) throw new AdminSurveyError(`Invalid input_type '${t}'`);
  return t as SurveyInputType;
}
function validateLottery(n: unknown): number {
  if (n !== 0 && n !== 1) throw new AdminSurveyError('lotteryQuestion must be 0 (registration) or 1 (lottery)');
  return n;
}

export class AdminSurveyService {
  constructor(private survey: SurveyRepo) {}

  async list(): Promise<QuestionAdminView[]> {
    const titles = await this.survey.listAllTitles();
    const out: QuestionAdminView[] = [];
    for (const t of titles) {
      out.push({ ...t, options: await this.survey.options(t.titleId) });
    }
    return out;
  }

  async createQuestion(input: CreateQuestionInput): Promise<number> {
    if (!input.question?.trim()) throw new AdminSurveyError('Question text is required');
    return this.survey.createTitle({
      question: input.question.trim(),
      grade: input.grade ?? null,
      lotteryQuestion: validateLottery(input.lotteryQuestion),
      brief: input.brief ?? null,
      inputType: validateType(input.inputType),
      active: true,
      sortOrder: input.sortOrder ?? 100,
    });
  }

  async updateQuestion(titleId: number, fields: Partial<CreateQuestionInput & { active: boolean }>): Promise<void> {
    const patch: Record<string, unknown> = {};
    if (fields.question !== undefined) patch.question = String(fields.question).trim();
    if (fields.grade !== undefined) patch.grade = fields.grade || null;
    if (fields.lotteryQuestion !== undefined) patch.lotteryQuestion = validateLottery(fields.lotteryQuestion);
    if (fields.inputType !== undefined) patch.inputType = validateType(fields.inputType);
    if (fields.sortOrder !== undefined) patch.sortOrder = Number(fields.sortOrder);
    if (fields.brief !== undefined) patch.brief = fields.brief || null;
    if (fields.active !== undefined) patch.active = Boolean(fields.active);
    await this.survey.updateTitle(titleId, patch);
  }

  /** Soft-delete: questions with answers should be deactivated, not removed. */
  async setActive(titleId: number, active: boolean): Promise<void> {
    await this.survey.updateTitle(titleId, { active });
  }

  async addOption(titleId: number, value: string): Promise<number> {
    if (!value?.trim()) throw new AdminSurveyError('Option value is required');
    return this.survey.addOption(titleId, value.trim());
  }

  async updateOption(extraId: number, value: string): Promise<void> {
    if (!value?.trim()) throw new AdminSurveyError('Option value is required');
    await this.survey.updateOption(extraId, value.trim());
  }

  async deleteOption(extraId: number): Promise<void> {
    await this.survey.deleteOption(extraId);
  }
}
