// Server log lines that must reach Vercel's runtime logs.
//
// next.config.js sets `compiler.removeConsole` for production builds, which deletes every
// console.* call, so a console line from a route handler never runs on Vercel. These write to the
// process streams instead, which the compiler leaves alone. Server code only (route handlers and
// the modules they import): the browser has no process.stdout.

export function serverLog(line: string): void {
  process.stdout.write(`${line}\n`);
}

export function serverError(line: string): void {
  process.stderr.write(`${line}\n`);
}
