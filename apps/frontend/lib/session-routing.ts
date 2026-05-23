export function isPracticeSessionType(sessionType: string): boolean {
  return sessionType.startsWith('FP')
}

export function getSessionRoute(sessionKey: number, sessionType: string): string {
  return isPracticeSessionType(sessionType)
    ? `/sessions/${sessionKey}/telemetry`
    : `/sessions/${sessionKey}`
}
