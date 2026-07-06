/**
 * HTTP layer (Fastify). Thin routes over the application services. Sessions use
 * a non-IP-pinned httpOnly cookie (deviation S4). Composition is injected so
 * tests can build the server over in-memory repositories.
 */
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { RegStatus, HUMANIFY, gradeLabel } from '../../domain/regStatus.js';
import type { AppConfig } from '../config.js';
import type { Database } from '../ports/database.js';
import type { Mailer } from '../ports/mailer.js';
import type { EmailProvider } from '../ports/email.js';
import { ConsoleEmailProvider } from '../adapters/email/providers.js';
import { OutboxMailer } from '../services/outboxMailer.js';
import { EmailWorker } from '../services/emailWorker.js';
import { NotifyService } from '../services/notifyService.js';
import { AuthError, AuthService } from '../services/authService.js';
import { EnrollmentError, EnrollmentService } from '../services/enrollmentService.js';
import { SurveyService } from '../services/surveyService.js';
import { OfferError, OfferService } from '../services/offerService.js';
import { AdminAuthError, AdminAuthService } from '../services/adminAuthService.js';
import { AdminError, AdminService } from '../services/adminService.js';
import { LotteryService } from '../services/lotteryService.js';
import { RollYearError, RollYearService } from '../services/rollYearService.js';
import { AdminSurveyError, AdminSurveyService } from '../services/adminSurveyService.js';

declare module 'fastify' {
  interface FastifyRequest {
    userId?: number;
    adminId?: number;
  }
}

export interface ServerDeps {
  config: AppConfig;
  db: Database;
  mailer?: Mailer;
  emailProvider?: EmailProvider;
}

const COOKIE = 'sid';

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** print_rank (users.pm): WAIT rank counts SIB_WAIT ahead; SIB_WAIT uses Position. */
function waitlistRank(
  status: RegStatus,
  position: number | null,
  grade: number,
  all: { gradeNextYear: number; regStatus: RegStatus }[],
): number | null {
  if (status === RegStatus.SIB_WAIT) return position;
  if (status === RegStatus.WAIT && position != null) {
    const ahead = all.filter((c) => c.gradeNextYear === grade && c.regStatus === RegStatus.SIB_WAIT).length;
    return position + ahead;
  }
  return null;
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  const { config, db } = deps;
  const repos = db.repos;
  const mailer = deps.mailer ?? new OutboxMailer(repos.outbox);
  const emailProvider = deps.emailProvider ?? new ConsoleEmailProvider();
  // "Dev email" mode = no real delivery (console provider). In this mode only, we
  // surface confirmation/reset tokens in API responses + the UI so you can verify
  // without an inbox. With a real (SMTP) provider these are NEVER exposed.
  const emailDev = emailProvider instanceof ConsoleEmailProvider;
  const emailWorker = new EmailWorker(repos.outbox, emailProvider);
  const notify = new NotifyService(db, config);
  const survey = new SurveyService(repos.children, repos.survey);
  const auth = new AuthService(db, config, undefined, survey, mailer);
  const enrollment = new EnrollmentService(repos.children, repos.currentStudents, config);
  const offers = new OfferService(repos.children, repos.currentStudents, survey, config);
  const adminAuth = new AdminAuthService(repos.admins, repos.adminSessions, config);
  const admin = new AdminService(db, config);
  const lottery = new LotteryService(db, config);
  const rollYear = new RollYearService(db);
  const adminSurvey = new AdminSurveyService(repos.survey);
  const app = Fastify({ logger: false, trustProxy: config.trustProxy });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: 'validation', issues: err.issues.map((i) => i.message) });
    }
    if (err instanceof AdminAuthError) {
      return reply.status(401).send({ error: err.message });
    }
    if (err instanceof AuthError || err instanceof EnrollmentError || err instanceof OfferError || err instanceof AdminError || err instanceof RollYearError || err instanceof AdminSurveyError) {
      return reply.status(400).send({ error: err.message });
    }
    reply.status(500).send({ error: 'Internal error' });
  });

  // Admin IP allowlist (defense-in-depth; nginx is the primary gate). Empty = allow all.
  const ipAllowed = (ip: string): boolean => {
    const list = config.adminIpAllowlist;
    if (list.length === 0) return true;
    return list.some((entry) => ip === entry || ip.startsWith(entry));
  };
  const adminIpGate = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!ipAllowed(req.ip)) return reply.status(403).send({ error: 'Forbidden' });
  };
  const requireAdmin = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!ipAllowed(req.ip)) return reply.status(403).send({ error: 'Forbidden' });
    const token = parseCookies(req.headers.cookie)['asid'];
    const adminId = await adminAuth.adminIdForSession(token);
    if (!adminId) return reply.status(401).send({ error: 'Admin authentication required' });
    req.adminId = adminId;
  };

  const requireAuth = async (req: FastifyRequest, reply: FastifyReply) => {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    const userId = await auth.userIdForSession(token);
    if (!userId) return reply.status(401).send({ error: 'Not authenticated' });
    req.userId = userId;
  };

  const setSession = (reply: FastifyReply, token: string, maxAgeSec: number) => {
    reply.header(
      'set-cookie',
      `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}`,
    );
  };

  app.get('/health', async () => ({ ok: true }));

  // Public display settings for the landing/login/register pages (no auth).
  // The home notice mirrors the legacy login.pl three-state text.
  app.get('/api/settings', async () => {
    const schoolYear = `${config.yearBegin}-${String((config.yearBegin + 1) % 100).padStart(2, '0')}`;
    let homeNotice: string;
    if (!config.lotteryOpen) {
      homeNotice = `We have run our lottery for the ${schoolYear} school year and offers have been extended via email. Please log in to accept your student's offer or to see their waitlist position.`;
    } else if (config.postLottery) {
      homeNotice = `The lottery for ${schoolYear} has already occurred. While it is too late to be entered in the lottery, you may still create an account to add a student onto our waiting list for a position to become available. Create an account and verify your email to complete the process.`;
    } else {
      homeNotice = `Welcome to the Renaissance Academy enrollment lottery for ${schoolYear}. Create an account to enter your student(s) in the lottery — you will verify your email address to complete registration.`;
    }
    return {
      yearBegin: config.yearBegin,
      schoolYear,
      lotteryOpen: config.lotteryOpen,
      postLottery: config.postLottery,
      homeNotice,
      emailDev, // dev-only: the UI may show "continue to confirmation" shortcuts
    };
  });

  app.post('/api/auth/register', async (req, reply) => {
    const { parentId, confirmToken } = await auth.register(req.body);
    // The confirm link is emailed. Only expose the raw token in dev (no real
    // email delivery); with SMTP it must never leave the server.
    return reply.status(201).send(emailDev ? { parentId, confirmToken } : { parentId });
  });

  app.post('/api/auth/confirm', async (req) => {
    const { token } = (req.body ?? {}) as { token?: string };
    const r = await auth.confirm(String(token));
    if (r.confirmed) return { confirmed: true };
    // Non-returning family: walk the lottery (Type B) survey.
    return { confirmed: false, question: await survey.nextLotteryQuestion(r.parentId) };
  });

  app.post('/api/auth/confirm/answer', async (req) => {
    const { token, titleId, answer, answers } = (req.body ?? {}) as {
      token?: string; titleId?: number; answer?: string; answers?: string[];
    };
    const parentId = await auth.parentIdForToken(String(token));
    const values = answers ?? [String(answer ?? '')];
    await survey.answerLottery(parentId, Number(titleId), values);
    const question = await survey.nextLotteryQuestion(parentId);
    if (!question) {
      await auth.markConfirmed(parentId);
      return { confirmed: true };
    }
    return { confirmed: false, question };
  });

  app.post('/api/auth/login', async (req, reply) => {
    const { username, password } = (req.body ?? {}) as { username?: string; password?: string };
    const session = await auth.login(String(username), String(password));
    setSession(reply, session.token, 7 * 24 * 60 * 60);
    return { ok: true };
  });

  app.post('/api/auth/forgot', async (req) => {
    const { username, email } = (req.body ?? {}) as { username?: string; email?: string };
    const r = await auth.requestPasswordReset(String(username), String(email));
    return emailDev ? r : {}; // reset token exposed in dev only
  });

  app.post('/api/auth/reset', async (req) => {
    const { token, password } = (req.body ?? {}) as { token?: string; password?: string };
    await auth.resetPassword(String(token), String(password));
    return { ok: true };
  });

  app.post('/api/auth/resend', async (req) => {
    const { email } = (req.body ?? {}) as { email?: string };
    const r = await auth.resendConfirmation(String(email));
    return emailDev ? r : {}; // confirm token exposed in dev only
  });

  app.post('/api/auth/logout', { preHandler: requireAuth }, async (req, reply) => {
    const token = parseCookies(req.headers.cookie)[COOKIE]!;
    await auth.logout(token);
    setSession(reply, '', 0);
    return { ok: true };
  });

  // Dashboard (enroll.pl): the logged-in parent's children + status display.
  app.get('/api/me', { preHandler: requireAuth }, async (req) => {
    const userId = req.userId!;
    // enroll.pl extend_offers_if_necessary: visiting materializes PEND_OFFER -> OFFER.
    await offers.extendOffers(userId);
    const [parent, children, all] = await Promise.all([
      repos.parents.findById(userId),
      repos.children.findByParent(userId),
      repos.children.all(),
    ]);
    return {
      parentId: userId,
      firstName: parent?.firstName ?? null,
      children: children.map((c) => ({
        childId: c.childId,
        firstName: c.firstName,
        middleName: c.middleName,
        lastName: c.lastName,
        grade: gradeLabel(c.gradeNextYear),
        dob: c.dob,
        status: c.regStatus,
        statusLabel: HUMANIFY[c.regStatus],
        waitlistRank: waitlistRank(c.regStatus, c.position, c.gradeNextYear, all),
      })),
    };
  });

  app.post('/api/children', { preHandler: requireAuth }, async (req, reply) => {
    const result = await enrollment.addChild(req.userId!, req.body);
    return reply.status(201).send(result);
  });

  const childId = (req: FastifyRequest) => Number((req.params as { id: string }).id);

  app.post('/api/children/:id/accept', { preHandler: requireAuth }, async (req) =>
    offers.acceptOffer(req.userId!, childId(req)),
  );

  app.post('/api/children/:id/accept/answer', { preHandler: requireAuth }, async (req) => {
    const { extraId, extraIds } = (req.body ?? {}) as { extraId?: number; extraIds?: number[] };
    const ids = extraIds ?? (extraId != null ? [Number(extraId)] : []);
    return offers.answerAccept(req.userId!, childId(req), ids);
  });

  app.post('/api/children/:id/decline', { preHandler: requireAuth }, async (req) =>
    offers.declineOffer(req.userId!, childId(req)),
  );

  app.post('/api/children/:id/language', { preHandler: requireAuth }, async (req) => {
    const { first, second } = (req.body ?? {}) as { first?: number; second?: number };
    return offers.setLanguagePreference(req.userId!, childId(req), Number(first), Number(second));
  });

  app.patch('/api/children/:id', { preHandler: requireAuth }, async (req) =>
    enrollment.editChild(req.userId!, childId(req), req.body),
  );

  app.delete('/api/children/:id', { preHandler: requireAuth }, async (req) => {
    await offers.deleteChild(req.userId!, childId(req));
    return { ok: true };
  });

  // ---- Admin console (IP-gated + separate admin session) ----
  const ASID = 'asid';

  app.post('/api/admin/login', { preHandler: adminIpGate }, async (req, reply) => {
    const { username, password } = (req.body ?? {}) as { username?: string; password?: string };
    const session = await adminAuth.login(String(username), String(password));
    reply.header('set-cookie', `${ASID}=${session.token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${12 * 60 * 60}`);
    return { ok: true };
  });

  app.post('/api/admin/logout', { preHandler: requireAdmin }, async (req, reply) => {
    await adminAuth.logout(parseCookies(req.headers.cookie)[ASID]!);
    reply.header('set-cookie', `${ASID}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
    return { ok: true };
  });

  app.get('/api/admin/me', { preHandler: requireAdmin }, async (req) => ({ adminId: req.adminId }));

  app.get('/api/admin/search', { preHandler: requireAdmin }, async (req) => {
    const q = (req.query as { q?: string }).q ?? '';
    return { results: await admin.search(q) };
  });

  app.get('/api/admin/family/:parentId', { preHandler: requireAdmin }, async (req) =>
    admin.showFamily(Number((req.params as { parentId: string }).parentId)),
  );

  app.post('/api/admin/children/:id/status', { preHandler: requireAdmin }, async (req) => {
    const { status } = (req.body ?? {}) as { status?: string };
    return admin.changeStatus(childId(req), status as RegStatus);
  });

  app.post('/api/admin/family/:parentId/note', { preHandler: requireAdmin }, async (req) => {
    const { note } = (req.body ?? {}) as { note?: string };
    await admin.addNote(Number((req.params as { parentId: string }).parentId), String(note ?? ''));
    return { ok: true };
  });

  app.get('/api/admin/waitlist', { preHandler: requireAdmin }, async (req) => {
    const g = (req.query as { grade?: string }).grade;
    return { waitlist: await admin.waitlist(g === undefined ? undefined : Number(g)) };
  });

  app.post('/api/admin/lottery/preview', { preHandler: requireAdmin }, async (req) => {
    const { caps } = (req.body ?? {}) as { caps?: number[] };
    return lottery.preview(caps);
  });

  app.post('/api/admin/lottery/commit', { preHandler: requireAdmin }, async (req) => {
    const { caps, seed } = (req.body ?? {}) as { caps?: number[]; seed?: string };
    return lottery.commit(caps, seed);
  });

  app.post('/api/admin/roll-year/validate', { preHandler: requireAdmin }, async (req) => {
    const { csv } = (req.body ?? {}) as { csv?: string };
    return rollYear.validate(String(csv ?? ''));
  });

  app.post('/api/admin/roll-year/commit', { preHandler: requireAdmin }, async (req) => {
    const { yearBegin, csv } = (req.body ?? {}) as { yearBegin?: number; csv?: string };
    return rollYear.commit(Number(yearBegin), String(csv ?? ''));
  });

  // Survey question-manager (B8)
  const titleId = (req: FastifyRequest) => Number((req.params as { titleId: string }).titleId);
  const extraId = (req: FastifyRequest) => Number((req.params as { extraId: string }).extraId);

  app.get('/api/admin/survey', { preHandler: requireAdmin }, async () => ({ questions: await adminSurvey.list() }));

  app.post('/api/admin/survey/questions', { preHandler: requireAdmin }, async (req, reply) => {
    const id = await adminSurvey.createQuestion(req.body as never);
    return reply.status(201).send({ titleId: id });
  });

  app.patch('/api/admin/survey/questions/:titleId', { preHandler: requireAdmin }, async (req) => {
    await adminSurvey.updateQuestion(titleId(req), req.body as never);
    return { ok: true };
  });

  app.post('/api/admin/survey/questions/:titleId/options', { preHandler: requireAdmin }, async (req, reply) => {
    const { value } = (req.body ?? {}) as { value?: string };
    const id = await adminSurvey.addOption(titleId(req), String(value ?? ''));
    return reply.status(201).send({ extraId: id });
  });

  app.patch('/api/admin/survey/options/:extraId', { preHandler: requireAdmin }, async (req) => {
    const { value } = (req.body ?? {}) as { value?: string };
    await adminSurvey.updateOption(extraId(req), String(value ?? ''));
    return { ok: true };
  });

  app.delete('/api/admin/survey/options/:extraId', { preHandler: requireAdmin }, async (req) => {
    await adminSurvey.deleteOption(extraId(req));
    return { ok: true };
  });

  // Notify (replaces the two notify crons) + outbox visibility/flush.
  app.post('/api/admin/notify/offers', { preHandler: requireAdmin }, async () => notify.materializeOffers());
  app.post('/api/admin/notify/reminders', { preHandler: requireAdmin }, async () => notify.sendReminders());
  app.get('/api/admin/notify/status', { preHandler: requireAdmin }, async () => ({ outbox: await repos.outbox.countByState() }));
  app.post('/api/admin/notify/drain', { preHandler: requireAdmin }, async () => emailWorker.drain());

  return app;
}
