function normalizeBody(req) {
  if (req.body === undefined || req.body === null) return '';
  if (typeof req.body === 'string') return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  return JSON.stringify(req.body);
}

function normalizeQuery(query = {}) {
  return Object.fromEntries(
    Object.entries(query).map(([key, value]) => {
      const lastValue = Array.isArray(value) ? value[value.length - 1] : value;
      // Vercel dev may leave '+' undecoded in query values (e.g. "modified+desc").
      // In application/x-www-form-urlencoded '+' is a space, so decode it here.
      return [key, typeof lastValue === 'string' ? lastValue.replace(/\+/g, ' ') : lastValue];
    })
  );
}

function setHeaders(res, headers = {}) {
  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined && value !== null) {
      res.setHeader(key, value);
    }
  }
}

export function toFunctionEvent(req) {
  return {
    httpMethod: req.method,
    headers: req.headers || {},
    queryStringParameters: normalizeQuery(req.query),
    body: normalizeBody(req),
    url: req.url || '',
  };
}

export function sendFunctionResult(res, result) {
  const statusCode = result?.statusCode || 200;
  setHeaders(res, result?.headers);
  res.status(statusCode).send(result?.body ?? '');
}

export function wrapFunctionHandler(functionHandler) {
  return async function vercelHandler(req, res) {
    const result = await functionHandler(toFunctionEvent(req));
    sendFunctionResult(res, result);
  };
}
