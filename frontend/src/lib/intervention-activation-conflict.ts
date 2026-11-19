export const describeActivationConflict = (message: string) => {
  if (/artifact|model version|V3 scorer|model bundle/i.test(message)) {
    return {
      stale: false,
      message: `Prediction service unavailable. ${message}`,
    };
  }
  if (/improved|at least 85/i.test(message)) {
    return {
      stale: true,
      message: "The current prediction improved. This candidate can no longer be approved. Refresh the list to see its current state.",
    };
  }
  if (/evidence|ready|unavailable|invalid/i.test(message)) {
    return {
      stale: true,
      message: "Current prediction evidence is insufficient or unavailable. Approval was not completed.",
    };
  }
  return { stale: true, message: `Candidate state changed: ${message}` };
};
