/**
 * A tiny ANSI colouriser standing in for chalk.
 *
 * chalk 5+ is ESM-only. This package compiles to CommonJS, so `import chalk from
 * 'chalk'` fails to typecheck (TS2307) and `require('chalk')` only works on Node
 * versions with require(esm) — it broke on Node 20. The surface actually used here
 * is seven colours plus `.bold` chaining, which is not worth a dependency.
 */

const ESC = String.fromCharCode(27);

const CODES = {
  reset: 0,
  bold: 1,
  red: 31,
  green: 32,
  yellow: 33,
  cyan: 36,
  gray: 90,
  underline: 4,
} as const;

type StyleName = keyof typeof CODES;

/** A callable style that can also be chained, e.g. `c.red.bold('x')`. */
export type Style = ((text: string) => string) & {
  bold: (text: string) => string;
};

export interface Colors {
  red: Style;
  green: Style;
  yellow: Style;
  cyan: Style;
  gray: Style;
  bold: Style;
  underline: Style;
}

function wrap(enabled: boolean, codes: number[]): (text: string) => string {
  if (!enabled || codes.length === 0) return (text: string) => text;
  const open = codes.map((c) => `${ESC}[${c}m`).join('');
  const close = `${ESC}[${CODES.reset}m`;
  return (text: string) => open + text + close;
}

function style(enabled: boolean, name: StyleName): Style {
  const base = wrap(enabled, [CODES[name]]) as Style;
  base.bold = wrap(enabled, [CODES[name], CODES.bold]);
  return base;
}

/**
 * `level` mirrors chalk's: 0 disables colour, anything higher enables it.
 * When omitted, colour is auto-detected the way chalk does — a TTY on stdout,
 * unless NO_COLOR is set or the terminal is `dumb`.
 */
export function createColors(level?: number): Colors {
  const enabled =
    level === undefined ? autoDetect() : level > 0;

  return {
    red: style(enabled, 'red'),
    green: style(enabled, 'green'),
    yellow: style(enabled, 'yellow'),
    cyan: style(enabled, 'cyan'),
    gray: style(enabled, 'gray'),
    bold: style(enabled, 'bold'),
    underline: style(enabled, 'underline'),
  };
}

function autoDetect(): boolean {
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== '') return false;
  if (process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== '0') return true;
  if (process.env.TERM === 'dumb') return false;
  return Boolean(process.stdout && process.stdout.isTTY);
}
