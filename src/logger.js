function ts() {
  return new Date().toISOString();
}

function fmt(level, msg, meta) {
  const base = `${ts()} [${level}] ${msg}`;
  if (meta === undefined) return base;
  try {
    return `${base} ${typeof meta === 'string' ? meta : JSON.stringify(meta)}`;
  } catch {
    return base;
  }
}

export const logger = {
  info: (msg, meta) => console.log(fmt('INFO', msg, meta)),
  warn: (msg, meta) => console.warn(fmt('WARN', msg, meta)),
  error: (msg, meta) => console.error(fmt('ERROR', msg, meta)),
  debug: (msg, meta) => {
    if (process.env.DEBUG === 'true') console.log(fmt('DEBUG', msg, meta));
  },
};

export default logger;
