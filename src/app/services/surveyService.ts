/**
 * SurveyService — the data-driven question engine (RULES_SPEC §9, deviation B8).
 * Two question sets, same timing as legacy:
 *   - Registration / placement (lottery_question = 0) -> ChildExtra, grade-scoped,
 *     asked at offer acceptance.
 *   - Lottery / research (lottery_question = 1) -> ParentExtra, asked at
 *     new-parent confirmation (non-returning families).
 */
import { gradeInScope } from '../../domain/surveyScope.js';
import type {
  ChildRepo,
  ExtraOptionRecord,
  ExtraTitleRecord,
  SurveyInputType,
  SurveyRepo,
} from '../ports/repositories.js';

export interface Question {
  titleId: number;
  question: string;
  brief: string | null;
  /** Generic widget type so the client renders entirely from data (B8). */
  inputType: SurveyInputType;
  options: ExtraOptionRecord[];
}

const toQuestion = (t: ExtraTitleRecord, options: ExtraOptionRecord[]): Question => ({
  titleId: t.titleId,
  question: t.question,
  brief: t.brief,
  inputType: t.inputType,
  options,
});

export class SurveyService {
  constructor(private children: ChildRepo, private survey: SurveyRepo) {}

  /** Next unanswered registration question for a child's grade, or null. */
  async nextRegistrationQuestion(childId: number): Promise<Question | null> {
    const child = await this.children.findById(childId);
    if (!child) return null;
    const titles = await this.survey.listTitles(0);
    const answered = await this.survey.childAnsweredTitleIds(childId);
    for (const t of titles) {
      if (gradeInScope(t.grade, child.gradeNextYear) && !answered.has(t.titleId)) {
        return toQuestion(t, await this.survey.options(t.titleId));
      }
    }
    return null;
  }

  /** Record a registration answer: one or more chosen option ids (multi-select
   *  stores multiple ChildExtra rows — native to the join table). */
  async answerRegistration(childId: number, extraIds: number | number[]): Promise<void> {
    for (const id of Array.isArray(extraIds) ? extraIds : [extraIds]) {
      await this.survey.addChildAnswer(childId, id);
    }
  }

  async clearRegistrationAnswers(childId: number): Promise<void> {
    await this.survey.clearChildAnswers(childId);
  }

  /** Next unanswered lottery (research) question for a parent, or null. */
  async nextLotteryQuestion(parentId: number): Promise<Question | null> {
    const titles = await this.survey.listTitles(1);
    const answered = await this.survey.parentAnsweredTitleIds(parentId);
    for (const t of titles) {
      if (!answered.has(t.titleId)) return toQuestion(t, await this.survey.options(t.titleId));
    }
    return null;
  }

  /** Record a lottery answer. Free-text/single → one row; multi-select → one
   *  ParentExtra row per selected option value (Perl-compatible: existence check
   *  only, no unique constraint). */
  async answerLottery(parentId: number, titleId: number, answer: string | string[]): Promise<void> {
    for (const v of Array.isArray(answer) ? answer : [answer]) {
      await this.survey.addParentAnswer(parentId, titleId, v);
    }
  }

  /** ParentSurveyGate: are there unanswered lottery questions? (used by confirm) */
  async hasPending(parentId: number): Promise<boolean> {
    return (await this.nextLotteryQuestion(parentId)) !== null;
  }
}
