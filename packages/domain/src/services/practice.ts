import { randomUUID } from 'node:crypto';
import type { AnsweredItem, SessionMode, UnansweredItem } from '@imc/contracts';
import {
  accounts,
  billing,
  content,
  ops,
  pgConstraint,
  pgErrorCode,
  practice,
  type Pool,
  type SessionRow,
  type Tx,
  withTx,
} from '@imc/db';
import { productDefaults } from '../config.js';
import { DomainError, notFound } from '../errors.js';
import type { StoragePort } from '../ports.js';
import { seededRandom, shuffle } from '../random.js';
import { selectQuestions, type SelectionCandidate } from '../selection.js';
import { localDateIn } from '../time.js';
import { decodeCursor, encodeCursor, requireChild, track } from './common.js';

export async function hasPro(tx: Tx, studentId: string): Promise<boolean> {
  return (await billing.activeEntitlement(tx, studentId, 'pro')) !== null;
}

async function recordAlert(
  pool: Pool,
  kind: string,
  dedupeKey: string,
  details: Record<string, unknown>,
) {
  await withTx(pool, { type: 'system', reason: 'ops-alert' }, (tx) =>
    ops.raiseOpsAlert(tx, { kind, dedupeKey, details }),
  );
}

type StartResult =
  | {
      status: 'ready';
      sessionId: string;
      mode: SessionMode;
      itemCount: number;
      nextItemId: string | null;
      created: boolean;
    }
  | { status: 'empty'; reason: 'NO_MISTAKES' };

async function readyResult(tx: Tx, s: SessionRow, created: boolean): Promise<StartResult> {
  const items = await practice.listSessionItems(tx, s.id);
  return {
    status: 'ready',
    sessionId: s.id,
    mode: s.mode,
    itemCount: items.length,
    nextItemId: items.find((i) => i.state === 'pending')?.itemId ?? null,
    created,
  };
}

/**
 * Starts (or returns) a practice session. Selection, version ids and choice order are persisted
 * at creation so later publications never change an active session.
 */
export async function startSession(
  tx: Tx,
  deps: { pool: Pool },
  input: { mode: SessionMode; topicId?: string | undefined },
  now = new Date(),
): Promise<StartResult> {
  const studentId = requireChild(tx);
  const student = await accounts.findStudent(tx, studentId);
  if (!student || student.status !== 'active') throw notFound('Child profile');

  if (input.mode !== 'daily' && !(await hasPro(tx, studentId))) {
    throw new DomainError('ENTITLEMENT_REQUIRED', 'This practice mode needs an active plan.');
  }
  if (input.mode === 'topic' && !input.topicId) {
    throw new DomainError('VALIDATION_FAILED', 'Choose a topic.');
  }
  const topicId = input.mode === 'topic' ? input.topicId! : null;
  const localDate = localDateIn(student.timezone, now);

  await practice.lockDailySelection(tx, studentId, `${input.mode}:${topicId ?? ''}`);
  if (input.mode === 'daily') {
    const latest = await practice.latestDailySession(tx, studentId);
    // A timezone change must not unlock an extra challenge for an already-issued day.
    if (latest && latest.localDate >= localDate) return readyResult(tx, latest, false);
  } else {
    const active = await practice.findActiveSession(tx, studentId, input.mode, topicId);
    if (active) return readyResult(tx, active, false);
  }

  const flags = await ops.getFlags(tx);
  if (flags.new_sessions === false) {
    throw new DomainError(
      'FEATURE_DISABLED',
      'New practice is paused for maintenance. Please try later.',
    );
  }

  let picks: SelectionCandidate[];
  if (input.mode === 'mistakes') {
    picks = await practice.dueReviewCandidates(tx, {
      studentId,
      locale: student.locale,
      limit: productDefaults.mistakesQuestionCount,
    });
    if (picks.length === 0) return { status: 'empty', reason: 'NO_MISTAKES' };
  } else {
    if (topicId) {
      const topic = await content.findTopic(tx, topicId);
      if (!topic || !topic.active) throw notFound('Topic');
    }
    const count =
      input.mode === 'daily'
        ? productDefaults.dailyQuestionCount
        : productDefaults.topicQuestionCount;
    const result = selectQuestions({
      candidates: await practice.selectionCandidates(tx, {
        grade: student.grade,
        locale: student.locale,
        topicId,
      }),
      recent: await practice.recentQuestionIds(tx, studentId, productDefaults.recentRepeatDays),
      count,
      mix: productDefaults.difficultyMix,
      seed: randomUUID(),
    });
    if (!result.ok) {
      await recordAlert(
        deps.pool,
        'content_shortage',
        `shortage:${student.grade}:${student.locale}:${topicId ?? 'all'}`,
        {
          grade: student.grade,
          locale: student.locale,
          topicId,
          mode: input.mode,
          available: result.available,
          required: count,
        },
      );
      throw new DomainError('CONTENT_UNAVAILABLE', 'Practice is not ready yet.');
    }
    picks = result.picks;
  }

  const sessionId = randomUUID();
  const seed = randomUUID();
  try {
    await tx.query('savepoint start_session');
    await practice.insertSession(tx, {
      id: sessionId,
      studentId,
      mode: input.mode,
      topicId,
      localDate,
      timezone: student.timezone,
      seed,
      itemCount: picks.length,
    });
    let ordinal = 0;
    for (const pick of picks) {
      const loc = await content.findLocalization(tx, pick.versionId, student.locale);
      if (!loc) throw new Error('selected version lacks localization');
      const rand = seededRandom(`${seed}:${pick.versionId}`);
      await practice.insertSessionItem(tx, {
        sessionId,
        ordinal: ++ordinal,
        versionId: pick.versionId,
        locale: student.locale,
        choiceOrder: shuffle(
          loc.options.map((o) => o.id),
          rand,
        ),
      });
    }
    await tx.query('release savepoint start_session');
  } catch (err) {
    // Final guard: a concurrent start that slipped past the lock hits the unique index.
    if (
      pgErrorCode(err) === '23505' &&
      /practice_sessions_(daily_unique|one_active)/.test(pgConstraint(err) ?? '')
    ) {
      await tx.query('rollback to savepoint start_session');
      const existing =
        input.mode === 'daily'
          ? await practice.findDailySession(tx, studentId, localDate)
          : await practice.findActiveSession(tx, studentId, input.mode, topicId);
      if (existing) return readyResult(tx, existing, false);
    }
    throw err;
  }
  await track(tx, 'session_started', studentId, {
    mode: input.mode,
    grade: student.grade,
    questionCount: picks.length,
    topic: topicId,
  });
  const session = (await practice.findSession(tx, sessionId))!;
  return readyResult(tx, session, true);
}

async function completionFor(tx: Tx, s: SessionRow) {
  if (s.status !== 'completed') return null;
  return {
    correctCount: s.correctCount,
    itemCount: s.itemCount,
    rewards: await practice.listRewards(tx, s.id),
  };
}

export async function getSessionState(tx: Tx, sessionId: string) {
  const s = await practice.findSession(tx, sessionId);
  if (!s) throw notFound('Session');
  const items = await practice.listSessionItems(tx, sessionId);
  return {
    sessionId: s.id,
    mode: s.mode,
    topicId: s.topicId,
    status: s.status,
    localDate: s.localDate,
    items: items.map((i) => ({
      itemId: i.itemId,
      ordinal: i.ordinal,
      answered: i.state === 'answered',
      correct: i.isCorrect,
    })),
    nextItemId:
      s.status === 'active' ? (items.find((i) => i.state === 'pending')?.itemId ?? null) : null,
    completion: await completionFor(tx, s),
  };
}

async function signAssets(
  tx: Tx,
  storage: StoragePort,
  versionId: string,
  usage: Array<'stem' | 'solution'>,
) {
  const out: Record<string, { url: string; expiresAt: string }> = {};
  for (const a of await content.listVersionAssets(tx, versionId)) {
    if (!usage.includes(a.usage) || a.status !== 'ready') continue;
    const signed = await storage.signedDownloadUrl(a.objectKey, productDefaults.signedUrlSeconds);
    out[a.assetId] = { url: signed.url, expiresAt: signed.expiresAt.toISOString() };
  }
  return out;
}

/**
 * Builds the item DTO. Field-by-field construction (never row serialization): unanswered items
 * carry no key, correctness, explanation or solution asset.
 */
export async function getItem(
  tx: Tx,
  storage: StoragePort,
  sessionId: string,
  itemId: string,
): Promise<UnansweredItem | AnsweredItem> {
  const session = await practice.findSession(tx, sessionId);
  if (!session) throw notFound('Question');
  const item = await practice.findItem(tx, sessionId, itemId);
  if (!item) throw notFound('Question');
  const loc = await content.findLocalization(tx, item.versionId, item.locale);
  if (!loc) throw notFound('Question');
  const byId = new Map(loc.options.map((o) => [o.id, o]));
  const options = item.choiceOrder.flatMap((id) => {
    const o = byId.get(id);
    return o ? [o] : [];
  });
  const base = {
    itemId: item.id,
    ordinal: item.ordinal,
    total: session.itemCount,
    stemBlocks: loc.stemBlocks,
    options,
  };
  const attempt = item.state === 'answered' ? await practice.findAttemptForItem(tx, item.id) : null;
  if (!attempt) {
    return {
      ...base,
      assets: await signAssets(tx, storage, item.versionId, ['stem']),
      answered: false,
    };
  }
  const key = await practice.revealedAnswerKey(tx, item.id);
  if (!key) throw notFound('Question');
  return {
    ...base,
    assets: await signAssets(tx, storage, item.versionId, ['stem', 'solution']),
    answered: true,
    selectedOptionId: attempt.selectedOptionId,
    correct: attempt.isCorrect,
    correctOptionId: key,
    explanationBlocks: loc.explanationBlocks,
  };
}

async function answerResult(
  tx: Tx,
  storage: StoragePort,
  input: {
    sessionId: string;
    itemId: string;
    attemptId: string;
    correct: boolean;
    key: string;
    versionId: string;
    locale: string;
  },
) {
  const loc = (await content.findLocalization(tx, input.versionId, input.locale))!;
  const session = (await practice.findSession(tx, input.sessionId))!;
  const items = await practice.listSessionItems(tx, input.sessionId);
  return {
    attemptId: input.attemptId,
    correct: input.correct,
    correctOptionId: input.key,
    explanationBlocks: loc.explanationBlocks,
    assets: await signAssets(tx, storage, input.versionId, ['stem', 'solution']),
    nextItemId:
      session.status === 'active'
        ? (items.find((i) => i.state === 'pending')?.itemId ?? null)
        : null,
    completion: await completionFor(tx, session),
  };
}

/**
 * Atomic answer submission (spec section 10). Locks the item; the same option replays the stored
 * result; a different option after commit is ANSWER_ALREADY_SUBMITTED. Grading reads the
 * protected key through app.grade_item. Completion, rewards and outbox records share the
 * transaction.
 */
export async function submitAnswer(
  tx: Tx,
  storage: StoragePort,
  input: { sessionId: string; itemId: string; optionId: string; responseMs?: number | undefined },
) {
  const studentId = requireChild(tx);
  const flags = await ops.getFlags(tx);
  if (flags.answer_submissions === false) {
    throw new DomainError(
      'SUBMISSIONS_PAUSED',
      'Answers cannot be checked right now. Your progress is safe; please try again later.',
    );
  }
  const session = await practice.findSession(tx, input.sessionId, { forUpdate: true });
  if (!session || session.studentId !== studentId) throw notFound('Question');
  const item = await practice.findItem(tx, input.sessionId, input.itemId, { forUpdate: true });
  if (!item) throw notFound('Question');

  const existing = await practice.findAttemptForItem(tx, item.id);
  if (existing) {
    if (existing.selectedOptionId !== input.optionId) {
      throw new DomainError('ANSWER_ALREADY_SUBMITTED', 'This question was already answered.');
    }
    const key = (await practice.revealedAnswerKey(tx, item.id))!;
    return answerResult(tx, storage, {
      sessionId: session.id,
      itemId: item.id,
      attemptId: existing.id,
      correct: existing.isCorrect,
      key,
      versionId: item.versionId,
      locale: item.locale,
    });
  }
  if (session.status !== 'active')
    throw new DomainError('INVALID_STATE', 'This session has ended.');
  if (!item.choiceOrder.includes(input.optionId)) {
    throw new DomainError('VALIDATION_FAILED', 'That option is not part of this question.');
  }

  const graded = await practice.gradeItem(tx, item.id, input.optionId);
  const isRetry = await practice.hasEarlierAttempt(tx, studentId, item.questionId, item.id);
  const attemptId = await practice.insertAttempt(tx, {
    itemId: item.id,
    studentId,
    questionId: item.questionId,
    optionId: input.optionId,
    isCorrect: graded.isCorrect,
    responseMs: input.responseMs ?? null,
    scoringVersion: productDefaults.scoringVersion,
  });
  await practice.markItemAnswered(tx, item.id);
  if (graded.isCorrect) {
    await practice.resolveReviewItem(tx, studentId, item.questionId);
  } else {
    await practice.upsertReviewItem(tx, {
      studentId,
      questionId: item.questionId,
      versionId: item.versionId,
      dueAt: new Date(),
    });
  }
  await track(tx, 'answer_recorded', studentId, {
    versionId: item.versionId,
    correct: graded.isCorrect,
    encounter: isRetry || session.mode === 'mistakes' ? 'retry' : 'first',
  });

  const items = await practice.listSessionItems(tx, session.id);
  if (items.every((i) => i.state === 'answered')) {
    const correctCount = await practice.countCorrect(tx, session.id);
    await practice.completeSession(tx, session.id, correctCount);
    await practice.insertReward(tx, {
      studentId,
      sessionId: session.id,
      type: 'session_complete',
      value: productDefaults.rewards.sessionComplete,
    });
    if (correctCount === items.length) {
      await practice.insertReward(tx, {
        studentId,
        sessionId: session.id,
        type: 'perfect_session',
        value: productDefaults.rewards.perfectSession,
      });
    }
    await ops.enqueueJob(tx, {
      type: 'progress.refresh',
      dedupeKey: `progress:${session.id}`,
      payload: { studentId, localDate: session.localDate },
    });
    await track(tx, 'session_completed', studentId, {
      mode: session.mode,
      questionCount: items.length,
      topic: session.topicId,
    });
  }
  return answerResult(tx, storage, {
    sessionId: session.id,
    itemId: item.id,
    attemptId,
    correct: graded.isCorrect,
    key: graded.correctOptionId,
    versionId: item.versionId,
    locale: item.locale,
  });
}

export async function listMistakes(
  tx: Tx,
  input: { studentId: string; cursor?: string | undefined; limit: number },
) {
  const student = await accounts.findStudent(tx, input.studentId);
  if (!student) throw notFound('Child profile');
  const cursor = decodeCursor(input.cursor, 2);
  const rows = await practice.listMistakes(tx, {
    studentId: input.studentId,
    cursor: cursor ? { dueAt: cursor[0]!, questionId: cursor[1]! } : undefined,
    limit: input.limit + 1,
  });
  const page = rows.slice(0, input.limit);
  const last = page[page.length - 1];
  return {
    items: page.map((r) => ({
      questionId: r.questionId,
      topic: { id: r.topicId, slug: r.topicSlug, displayKey: r.topicDisplayKey },
      dueAt: new Date(r.dueAt).toISOString(),
      lastFailedAt: new Date(r.lastFailedAt).toISOString(),
    })),
    nextCursor:
      rows.length > input.limit && last
        ? encodeCursor([new Date(last.dueAt).toISOString(), last.questionId])
        : null,
  };
}
