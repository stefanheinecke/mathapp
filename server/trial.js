// Kostenlose Testphase: 3 Tage ab Kontoerstellung, danach ist ein Abo noetig.
export const TRIAL_DAYS = 3;

export function getTrialEndsAt(createdAt) {
  const end = new Date(createdAt);
  end.setDate(end.getDate() + TRIAL_DAYS);
  return end;
}

export function isTrialActive(createdAt, now = new Date()) {
  return now < getTrialEndsAt(createdAt);
}
