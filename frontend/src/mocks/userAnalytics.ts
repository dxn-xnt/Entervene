import type { UserAnalytics, UserRole } from "../lib/api";

type MockAnalytics = Omit<UserAnalytics, "summary" | "lms_behavior"> & {
  summary: Record<string, number | string | null>;
  lms_behavior: Record<string, number | string | null>;
};

export const userAnalyticsMocks: Record<UserRole, MockAnalytics> = {
  teacher: {
    summary: {
      classesHandled: 4,
      subjectsHandled: 2,
      classPerformance: 95,
    },
    quarterly_performance: [
      { quarter: "T1", score: 76 },
      { quarter: "T2", score: 82 },
      { quarter: "T3", score: 88.4 },
    ],
    subject_breakdown: [
      { subject: "Science 9", value: 43 },
      { subject: "Science 8", value: 43 },
    ],
    activity_feed: [
      { title: "New lesson added for Science 9 - Chapter 7: Genetics", timestamp: "Today 9:14 AM" },
      { title: "New lesson added for Science 8 - Chapter 7: Genetics", timestamp: "Today 9:14 AM" },
    ],
    subject_mastery: [],
    score_trend: [],
    historical_performance: [],
    classwork: [],
    lms_behavior: {},
  },
  student: {
    summary: {
      writtenWorksAverage: 52,
      performanceAverage: 48,
      completionRate: 44,
      failureRisk: "Likely to Fail",
      modelConfidence: "81%",
    },
    lms_behavior: {
      totalLogins: 8,
      averageSession: "6 min",
      missedActivities: 11,
      onTimeSubmissions: "38%",
    },
    subject_mastery: [
      { subject: "Computer Programming", value: 96 },
      { subject: "Science", value: 80 },
      { subject: "Filipino", value: 54 },
      { subject: "Math", value: 88 },
      { subject: "English", value: 88 },
    ],
    score_trend: [
      { month: "Jan", score: 68 },
      { month: "Feb", score: 62 },
      { month: "Mar", score: 55 },
      { month: "Apr", score: 34 },
    ],
    classwork: [
      { name: "Python Quiz 1", type: "Quiz", subject: "Computer Programming", status: "On time", score: "26/30" },
      { name: "Unang Gawain", type: "Activity", subject: "Filipino", status: "Missing", score: "Missing" },
      { name: "Science Worksheet", type: "Activity", subject: "Science", status: "Late", score: "18/25" },
    ],
    quarterly_performance: [],
    subject_breakdown: [],
    historical_performance: [],
    activity_feed: [],
  },
  admin: {
    summary: {
      classesMade: 23,
      subjectLoadsAssigned: 213,
      subjectsAdded: 4,
      usersManaged: 41,
    },
    subject_breakdown: [
      { subject: "Science 9", value: 43 },
      { subject: "Science 8", value: 43 },
    ],
    activity_feed: [
      { title: "New lesson added for Science 9 - Chapter 7: Genetics", timestamp: "Today 9:14 AM" },
      { title: "New lesson added for Science 8 - Chapter 7: Genetics", timestamp: "Today 9:14 AM" },
    ],
    subject_mastery: [],
    score_trend: [],
    historical_performance: [],
    quarterly_performance: [],
    classwork: [],
    lms_behavior: {},
  },
};

export function mergeAnalytics(role: UserRole, analytics?: UserAnalytics | null): MockAnalytics {
  const fallback = userAnalyticsMocks[role];

  if (!analytics) return fallback;

  return {
    ...fallback,
    ...analytics,
    summary: analytics.summary && Object.keys(analytics.summary).length > 0 ? analytics.summary : fallback.summary,
    lms_behavior:
      analytics.lms_behavior && Object.keys(analytics.lms_behavior).length > 0
        ? analytics.lms_behavior
        : fallback.lms_behavior,
    subject_mastery: analytics.subject_mastery.length > 0 ? analytics.subject_mastery : fallback.subject_mastery,
    score_trend: analytics.score_trend.length > 0 ? analytics.score_trend : fallback.score_trend,
    historical_performance:
      analytics.historical_performance.length > 0 ? analytics.historical_performance : fallback.historical_performance,
    quarterly_performance:
      analytics.quarterly_performance.length > 0 ? analytics.quarterly_performance : fallback.quarterly_performance,
    subject_breakdown:
      analytics.subject_breakdown.length > 0 ? analytics.subject_breakdown : fallback.subject_breakdown,
    activity_feed: analytics.activity_feed.length > 0 ? analytics.activity_feed : fallback.activity_feed,
    classwork: analytics.classwork.length > 0 ? analytics.classwork : fallback.classwork,
  };
}
