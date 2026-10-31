/**
 * OfferService — the post-lottery parent lifecycle: offer materialization,
 * accept (with the registration-survey gate), decline (cleanup_and_coalesce),
 * the re-enrollment language-preference step, and delete.
 * (enroll.pl, acceptOffer.pl, declineOffer.pl, reenrollChild.pl, deleteChild.pl.)
 */
import { RegStatus } from '../../domain/regStatus.js';
import { declineChild } from '../../domain/declineChild.js';
import { buildLanguagePreference } from '../../domain/languagePreference.js';
import type { Child } from '../../domain/types.js';
import type { AppConfig } from '../config.js';
import type { ChildRecord, ChildRepo, CurrentStudentRepo } from '../ports/repositories.js';
import { addDays, today } from '../util/dates.js';
import type { Question, SurveyService } from './surveyService.js';

export class OfferError extends Error {}

const toDomain = (c: ChildRecord): Child => ({
  childId: c.childId,
  parentId: c.parentId,
  grade: c.gradeNextYear,
  regStatus: c.regStatus,
  considerations: c.lotteryConsiderations,
  position: c.position,
});

export interface AcceptResult {
  needsSurvey: boolean;
  question?: Question;
  status: RegStatus;
}

export class OfferService {
  constructor(
    private children: ChildRepo,
    private currentStudents: CurrentStudentRepo,
    private survey: SurveyService,
    private config: AppConfig,
  ) {}

  private async owned(parentId: number, childId: number): Promise<ChildRecord> {
    const child = await this.children.findById(childId);
    if (!child || child.parentId !== parentId) throw new OfferError('Invalid Child_ID');
    return child;
  }

  /** PEND_OFFER -> OFFER + expiration; HTTP invokes this only on explicit parent refresh. */
  async extendOffers(parentId: number): Promise<number> {
    const kids = await this.children.findByParent(parentId);
    let n = 0;
    for (const c of kids) {
      if (c.regStatus === RegStatus.PEND_OFFER) {
        await this.children.updateStatus(c.childId, RegStatus.OFFER);
        await this.children.setExpiration(c.childId, addDays(today(), this.config.offerExpirationDays));
        n++;
      }
    }
    return n;
  }

  /** acceptOffer.pl: move to IP_OFFER, then gate on registration questions. */
  async acceptOffer(parentId: number, childId: number): Promise<AcceptResult> {
    const child = await this.owned(parentId, childId);
    if (child.regStatus !== RegStatus.OFFER && child.regStatus !== RegStatus.IP_OFFER) {
      throw new OfferError(`There is no offer for ${child.firstName} to accept.`);
    }
    if (child.regStatus !== RegStatus.IP_OFFER) await this.children.updateStatus(childId, RegStatus.IP_OFFER);
    return this.continueAccept(childId);
  }

  async answerAccept(parentId: number, childId: number, extraIds: number | number[]): Promise<AcceptResult> {
    const child = await this.owned(parentId, childId);
    if (child.regStatus !== RegStatus.IP_OFFER) throw new OfferError('No acceptance in progress.');
    await this.survey.answerRegistration(childId, extraIds);
    return this.continueAccept(childId);
  }

  private async continueAccept(childId: number): Promise<AcceptResult> {
    const question = await this.survey.nextRegistrationQuestion(childId);
    if (question) return { needsSurvey: true, question, status: RegStatus.IP_OFFER };
    await this.children.updateStatus(childId, RegStatus.PEND_REGISTER);
    await this.children.setExpiration(childId, addDays(today(), this.config.paperworkExpirationDays));
    return { needsSurvey: false, status: RegStatus.PEND_REGISTER };
  }

  /** declineOffer.pl -> cleanup_and_coalesce. */
  async declineOffer(parentId: number, childId: number): Promise<{ status: RegStatus }> {
    const child = await this.owned(parentId, childId);
    if (child.regStatus === RegStatus.INITIAL || /DECL/.test(child.regStatus)) {
      throw new OfferError('This student cannot be declined in its current state.');
    }
    const all = (await this.children.all()).map(toDomain);
    const res = declineChild(all, childId);
    if (!res.ok || !res.to) throw new OfferError(res.error ?? 'Decline failed');
    await this.children.updateStatus(childId, res.to, null);
    for (const c of res.coalesced) await this.children.setPosition(c.childId, c.position);
    if (res.clearLanguagePreference) await this.children.setLanguagePreference(childId, null);
    if (res.clearChildExtra) await this.survey.clearRegistrationAnswers(childId);
    return { status: res.to };
  }

  /** reenrollChild.pl: grades 1 & 6 pick a language preference -> ACPT_REENROLL. */
  async setLanguagePreference(parentId: number, childId: number, first: number, second: number) {
    const child = await this.owned(parentId, childId);
    if (child.regStatus !== RegStatus.IP_REENROLL) throw new OfferError('Not awaiting a language preference.');
    const r = buildLanguagePreference(first, second);
    if (!r.ok) {
      throw new OfferError(
        r.reason === 'same_choice' ? 'Your first and second choices must differ.' : 'Invalid language choice.',
      );
    }
    await this.children.setLanguagePreference(childId, r.code);
    await this.children.updateStatus(childId, RegStatus.ACPT_REENROLL);
    const match = await this.currentStudents.findMatch(child.firstName, child.lastName, child.dob);
    if (match) await this.currentStudents.setStatus(match.childId, RegStatus.ACPT_REENROLL);
    return { status: RegStatus.ACPT_REENROLL, languagePreference: r.code };
  }

  /** deleteChild.pl gated by enroll.pl: lottery_open && (!post_lottery || INITIAL). */
  async deleteChild(parentId: number, childId: number): Promise<void> {
    const child = await this.owned(parentId, childId);
    const allowed = this.config.lotteryOpen && (!this.config.postLottery || child.regStatus === RegStatus.INITIAL);
    if (!allowed) throw new OfferError('This student cannot be deleted at this time.');
    await this.children.delete(childId);
  }
}
