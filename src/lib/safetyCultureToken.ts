/** Normalize pasted SafetyCulture API tokens before save/invoke. */
export function normalizeSafetyCultureToken(raw: string): string {
  let token = raw.trim();
  if (
    (token.startsWith('"') && token.endsWith('"')) ||
    (token.startsWith("'") && token.endsWith("'"))
  ) {
    token = token.slice(1, -1).trim();
  }
  if (token.toLowerCase().startsWith('bearer ')) {
    token = token.slice(7).trim();
  }
  return token;
}

export function formatSafetyCultureError(message: string): string {
  if (!/401|token rejected/i.test(message)) return message;
  return (
    'SafetyCulture rejected the API token (401). Click Disconnect, generate a new token in ' +
    'SafetyCulture → My Profile → Settings → API tokens (tokens start with scapi_), ' +
    'then paste the full token and Connect again.'
  );
}
