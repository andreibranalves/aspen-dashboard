// Matchers de rota puros (sem JSX) - testáveis em node:test sem transform de TSX.

export function routePath(route: string): string {
  return route.split('?')[0] || '/';
}

export function matchSegments(pattern: string, route: string): Record<string, string> | null {
  const parts = pattern.split('/');
  const actual = routePath(route).split('/');
  const params: Record<string, string> = {};
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i];
    if (seg.startsWith(':')) {
      if (seg.endsWith('*')) {
        params[seg.slice(1, -1)] = actual.slice(i).join('/');
        return params;
      }
      if (i >= actual.length) return null;
      params[seg.slice(1)] = actual[i];
    } else if (i >= actual.length || seg !== actual[i]) {
      return null;
    }
  }
  return actual.length === parts.length ? params : null;
}

export function prefix(prefixPath: string): (route: string) => Record<string, string> | null {
  return (route: string) => {
    const path = routePath(route);
    return path.startsWith(prefixPath) ? { id: path.slice(prefixPath.length) } : null;
  };
}
