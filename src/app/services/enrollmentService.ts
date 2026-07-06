/**
 * EnrollmentService — add a child to the lottery, including the re-enrollment
 * (returning-student) path (addChild.pl, RULES_SPEC §5).
 *
 * Deviations enforced here: explicit returning-grade guard 1..9 (B9), and the
 * re-enrollment match keeps legacy semantics (First + Last + DOB).
 */
import { z } from 'zod';
import { RegStatus } from '../../domain/regStatus.js';
import {
  buildDob,
  considerationsBitmask,
  isValidGender,
  isValidGrade,
  isValidReturningGrade,
} from '../../domain/enrollmentRules.js';
import type { AppConfig } from '../config.js';
import type { ChildRepo, CurrentStudentRepo } from '../ports/repositories.js';

export const addChildSchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  middleName: z.string().optional(),
  lastName: z.string().min(1, 'Last name is required'),
  gender: z.string().refine(isValidGender, 'Gender is invalid'),
  dobYear: z.coerce.number().int(),
  dobMonth: z.coerce.number().int(),
  dobDay: z.coerce.number().int(),
  // Optional: required for NEW students; for re-enrollment it comes from the roster.
  gradeNextYear: z.coerce.number().int().optional(),
  current: z.boolean().default(false),
  sibling: z.boolean().default(false),
  preference: z.boolean().default(false),
  notes: z.string().optional(),
});
export type AddChildInput = z.infer<typeof addChildSchema>;

export class EnrollmentError extends Error {}

export interface AddChildResult {
  childId: number;
  status: RegStatus;
  /** IP_REENROLL: returning grades 1 & 6 must pick a language preference next. */
  needsLanguagePreference: boolean;
}

const PLACEHOLDER_NOTE = "Please describe the ideal educational situation for your child's unique needs";

export class EnrollmentService {
  constructor(
    private children: ChildRepo,
    private currentStudents: CurrentStudentRepo,
    private config: AppConfig,
  ) {}

  async addChild(parentId: number, raw: unknown): Promise<AddChildResult> {
    if (!this.config.lotteryOpen) throw new EnrollmentError('The lottery is not currently open.');
    const input = addChildSchema.parse(raw);

    const dob = buildDob(input.dobYear, input.dobMonth, input.dobDay, this.config.yearBegin);
    if (!dob.ok) {
      throw new EnrollmentError(
        dob.reason === 'too_young_for_k'
          ? 'This child does not turn 5 before the deadline to enroll in kindergarten.'
          : 'Date of Birth is invalid.',
      );
    }

    const mask = considerationsBitmask(input);
    let gradeNextYear: number;
    let status: RegStatus;

    if (input.current) {
      // Re-enrollment: match the current-student roster on First + Last + DOB.
      const match = await this.currentStudents.findMatch(input.firstName, input.lastName, dob.dob);
      if (!match) {
        throw new EnrollmentError(
          `Could not find a record for ${input.firstName} ${input.lastName} in the current student database.`,
        );
      }
      if (match.regStatus !== RegStatus.PEND_REENROLL) {
        throw new EnrollmentError('This student has already been re-enrolled.');
      }
      gradeNextYear = match.grade; // grade comes from the roster, not parent input
      // B9: returning grade must be 1..9 (no returning Kindergartners; current
      // 9th graders graduate out). Legacy lacked this guard.
      if (!isValidReturningGrade(gradeNextYear)) {
        throw new EnrollmentError(
          `Re-enrollment grade ${gradeNextYear} is out of range (must be 1–9). Please contact the enrollment office.`,
        );
      }
      status = gradeNextYear === 1 || gradeNextYear === 6 ? RegStatus.IP_REENROLL : RegStatus.ACPT_REENROLL;
    } else {
      if (input.gradeNextYear === undefined || !isValidGrade(input.gradeNextYear)) {
        throw new EnrollmentError('Grade for next year is invalid.');
      }
      gradeNextYear = input.gradeNextYear;
      status = RegStatus.INITIAL;
    }

    const notes = input.notes && input.notes !== PLACEHOLDER_NOTE ? input.notes : '';

    if (await this.children.existsByIdentity(input.firstName, input.middleName ?? '', input.lastName, dob.dob)) {
      throw new EnrollmentError('Sorry, this child is already in the lottery.');
    }

    const childId = await this.children.create({
      parentId,
      lastName: input.lastName,
      firstName: input.firstName,
      middleName: input.middleName ?? null,
      gender: input.gender,
      dob: dob.dob,
      gradeNextYear,
      regStatus: status,
      languagePreference: null,
      lotteryConsiderations: mask,
      position: null,
      expiration: null,
      parentNotes: notes,
    });

    if (input.current) {
      const match = await this.currentStudents.findMatch(input.firstName, input.lastName, dob.dob);
      if (match) await this.currentStudents.setStatus(match.childId, status);
    }

    return { childId, status, needsLanguagePreference: status === RegStatus.IP_REENROLL };
  }

  async listForParent(parentId: number) {
    return this.children.findByParent(parentId);
  }

  /**
   * editChild.pl: edit an INITIAL child, but only fields the policy permits.
   * Legacy `%ChildPermissions` is all-zero (locked); `config.childEditableFields`
   * is the modern, admin-configurable equivalent and defaults to locked.
   */
  async editChild(parentId: number, childId: number, raw: unknown): Promise<{ changed: string[] }> {
    const child = await this.children.findById(childId);
    if (!child || child.parentId !== parentId) throw new EnrollmentError('Invalid Child_ID');
    if (child.regStatus !== RegStatus.INITIAL) throw new EnrollmentError('Only students awaiting the lottery can be edited.');

    const allowed = new Set(this.config.childEditableFields);
    const input = addChildSchema.partial().parse(raw);
    const changed: string[] = [];

    const updates: Partial<{ firstName: string; middleName: string; lastName: string; gender: string; gradeNextYear: number }> = {};
    if (allowed.has('firstName') && input.firstName && input.firstName !== child.firstName) updates.firstName = input.firstName;
    if (allowed.has('middleName') && input.middleName !== undefined && input.middleName !== child.middleName) updates.middleName = input.middleName;
    if (allowed.has('lastName') && input.lastName && input.lastName !== child.lastName) updates.lastName = input.lastName;
    if (allowed.has('gender') && input.gender && input.gender !== child.gender) {
      if (!isValidGender(input.gender)) throw new EnrollmentError('Gender is invalid.');
      updates.gender = input.gender;
    }
    if (allowed.has('gradeNextYear') && input.gradeNextYear !== undefined && input.gradeNextYear !== child.gradeNextYear) {
      if (!isValidGrade(input.gradeNextYear)) throw new EnrollmentError('Grade is invalid.');
      updates.gradeNextYear = input.gradeNextYear;
    }

    for (const k of Object.keys(updates)) changed.push(k);
    if (changed.length > 0) await this.children.updateFields(childId, updates);
    return { changed };
  }
}
