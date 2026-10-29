// VPS app mode serves the workspace at /; combined mode retains local /app/.
export function resolveSiteMode(origin, requestedMode) {
  const mode = requestedMode || (new URL(origin).hostname === 'app.rillvane.trade' ? 'app' : 'combined');
  if (!['app', 'combined'].includes(mode)) throw new Error('SITE_MODE must be app or combined.');
  return mode;
}

export function resolveStaticRoute(pathname, search = '', mode = 'combined') {
  if (mode === 'app') {
    if (pathname === '/') return {pathname: '/app/index.html'};
    if (['/index.html', '/app', '/app/', '/app/index.html'].includes(pathname)) {
      return {redirect: '/' + search};
    }
  } else if (pathname === '/app') {
    return {redirect: '/app/' + search};
  }
  return {pathname};
}
