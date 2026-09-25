import { accounts, billing, content, practice, type Tx } from '@imc/db';
import { productDefaults } from '../config.js';
import { DomainError, notFound } from '../errors.js';
import { addDays, daysBetween, localDateIn, weekStart } from '../time.js';
import { toStudentProfile } from './accounts.js';

export async function getHome(tx: Tx, studentId: string, now = new Date()) {
  const student = await accounts.findStudent(tx, studentId);
  if (!student) throw notFound('Child profile');
  const localDate = localDateIn(student.timezone, now);

  const latestDaily = await practice.latestDailySession(tx, studentId);
  const daily = latestDaily && latestDaily.localDate >= localDate ? latestDaily : null;
  const topics = new Map((await content.listTopics(tx)).map((t) => [t.id, t]));
  const summary = (id: string | null) => {
    const t = id ? topics.get(id) : undefined;
    return t ? { id: t.id, slug: t.slug, displayKey: t.displayKey } : null;
  };

  const active = await practice.listActiveSessions(tx, studentId);
  const recent = await practice.recentCompletedSessions(tx, studentId, 5);
  const weekFrom = weekStart(localDate);
  const completedThisWeek = await practice.countCompletedSessionsBetween(
    tx,
    studentId,
    weekFrom,
    localDate,
  );
  const ent = await billing.activeEntitlement(tx, studentId, 'pro');

  // Suggest the topic with the weakest recent first-attempt accuracy, else an unpractised one.
  const inventory = await content.topicInventory(tx, student.grade, student.locale);
  const withContent = inventory.filter((i) => i.published > 0).map((i) => i.topicId);
  const attempts = await practice.progressAttempts(
    tx,
    studentId,
    addDays(localDate, -30),
    localDate,
  );
  const stats = new Map<string, { n: number; correct: number }>();
  for (const a of attempts.filter((x) => x.isFirstEncounter)) {
    const s = stats.get(a.topicId) ?? { n: 0, correct: 0 };
    s.n++;
    if (a.isCorrect) s.correct++;
    stats.set(a.topicId, s);
  }
  const unpractised = withContent.filter((id) => !stats.has(id)).sort();
  const weakest = [...stats.entries()]
    .filter(([id]) => withContent.includes(id))
    .sort(([a, x], [b, y]) => x.correct / x.n - y.correct / y.n || a.localeCompare(b))[0]?.[0];
  const suggested =
    (weakest && stats.get(weakest)!.correct / stats.get(weakest)!.n < 0.8
      ? weakest
      : (unpractised[0] ?? weakest)) ?? null;

  return {
    student: toStudentProfile(student),
    daily: {
      localDate,
      status: !daily
        ? ('not_started' as const)
        : daily.status === 'completed'
          ? ('completed' as const)
          : ('in_progress' as const),
      sessionId: daily?.id ?? null,
    },
    activeSessions: active.map((s) => ({
      sessionId: s.id,
      mode: s.mode,
      topic: summary(s.topicId),
      answeredCount: s.answeredCount,
      itemCount: s.itemCount,
    })),
    suggestedTopic: summary(suggested),
    recentActivity: recent.map((s) => ({
      sessionId: s.id,
      mode: s.mode,
      completedAt: s.completedAt!,
      correctCount: s.correctCount,
      itemCount: s.itemCount,
    })),
    weeklyGoal: { target: productDefaults.weeklyActivityGoal, completed: completedThisWeek },
    access: { pro: ent !== null, validUntil: ent?.validUntil ?? null },
  };
}

export async function getProgress(
  tx: Tx,
  input: { studentId: string; from: string; to: string },
  now = new Date(),
) {
  const student = await accounts.findStudent(tx, input.studentId);
  if (!student) throw notFound('Child profile');
  if (input.from > input.to)
    throw new DomainError('VALIDATION_FAILED', '"from" must not be after "to".');
  if (daysBetween(input.from, input.to) > productDefaults.maxProgressRangeDays) {
    throw new DomainError('VALIDATION_FAILED', 'Date range is too long.');
  }
  const today = localDateIn(student.timezone, now);
  const pro = (await billing.activeEntitlement(tx, input.studentId, 'pro')) !== null;
  const historyDays = pro ? productDefaults.proHistoryDays : productDefaults.freeHistoryDays;
  const earliest = addDays(today, -historyDays + 1);
  const from = input.from < earliest ? earliest : input.from;
  const to = input.to;
  const historyLimited = from !== input.from;

  const attempts = from <= to ? await practice.progressAttempts(tx, input.studentId, from, to) : [];
  const sessionDates =
    from <= to ? await practice.completedSessionDates(tx, input.studentId, from, to) : [];
  const topics = new Map((await content.listTopics(tx, false)).map((t) => [t.id, t]));

  const first = attempts.filter((a) => a.isFirstEncounter);
  const retries = attempts.filter((a) => !a.isFirstEncounter);
  const perTopic = new Map<
    string,
    { firstAttemptCount: number; firstAttemptCorrect: number; retryCount: number }
  >();
  for (const a of attempts) {
    const t = perTopic.get(a.topicId) ?? {
      firstAttemptCount: 0,
      firstAttemptCorrect: 0,
      retryCount: 0,
    };
    if (a.isFirstEncounter) {
      t.firstAttemptCount++;
      if (a.isCorrect) t.firstAttemptCorrect++;
    } else t.retryCount++;
    perTopic.set(a.topicId, t);
  }
  const weekly = new Map<string, number>();
  for (const d of sessionDates) weekly.set(weekStart(d), (weekly.get(weekStart(d)) ?? 0) + 1);

  return {
    from,
    to,
    completedSessions: sessionDates.length,
    questionsAnswered: attempts.length,
    firstAttempts: { count: first.length, correct: first.filter((a) => a.isCorrect).length },
    retries: { count: retries.length, correct: retries.filter((a) => a.isCorrect).length },
    topics: [...perTopic.entries()]
      .map(([topicId, s]) => {
        const t = topics.get(topicId);
        return {
          id: topicId,
          slug: t?.slug ?? 'unknown',
          displayKey: t?.displayKey ?? 'unknown',
          ...s,
        };
      })
      .sort((a, b) => a.slug.localeCompare(b.slug)),
    weekly: [...weekly.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([weekStartDate, completedSessions]) => ({
        weekStart: weekStartDate,
        completedSessions,
      })),
    sufficientData: first.length >= 5,
    historyLimited,
  };
}

export async function listTopicsForGrade(tx: Tx, grade: number, locale: string) {
  const inventory = new Map(
    (await content.topicInventory(tx, grade, locale)).map((i) => [i.topicId, i.published]),
  );
  return (await content.listTopics(tx)).map((t) => {
    const n = inventory.get(t.id) ?? 0;
    return {
      id: t.id,
      slug: t.slug,
      displayKey: t.displayKey,
      parentId: t.parentId,
      inventory:
        n >= productDefaults.topicQuestionCount * 2
          ? ('ready' as const)
          : n >= productDefaults.topicQuestionCount
            ? ('limited' as const)
            : ('unavailable' as const),
    };
  });
}
