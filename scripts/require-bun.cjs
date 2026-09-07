// npm/yarn ignore Bun's patchedDependencies, leaving incompatible or unsafe packages.
if (!process.env.npm_config_user_agent?.startsWith('bun/')) {
  console.error('Install with Bun: bun install --frozen-lockfile (packageManager pins the supported version).');
  process.exitCode = 1;
}
