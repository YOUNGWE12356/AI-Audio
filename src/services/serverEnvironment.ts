export function assertNoPublicSecrets(env: NodeJS.ProcessEnv) {
  const names = Object.keys(env).filter(name => /^(VITE_|NEXT_PUBLIC_|REACT_APP_)/.test(name)
    && /(?:KEY|TOKEN|SECRET|PASSWORD)/.test(name) && env[name]);
  if (names.length) throw new Error(`Secrets must use server-only variables: ${names.join(', ')}`);
}

export function assertPrivateEnvironment(env: NodeJS.ProcessEnv) {
  assertNoPublicSecrets(env);
  if (env.SFX_LIBRARY_ADMIN_PASSWORD && env.SFX_LIBRARY_ADMIN_PASSWORD.trim().length < 24) {
    throw new Error('SFX_LIBRARY_ADMIN_PASSWORD must contain at least 24 characters');
  }
}
