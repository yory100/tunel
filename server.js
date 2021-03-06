/*   ___                 /
 *     _-_-  _/\____    / __\\__
 *  _-_-__  / ,-. -|   /  -  ,-.`-.
 *     _-_- `( o )--  /  --( o )-'
 *            `-'    /      `-'
 * tunel (n): RESTful message tunneling over IPC.
 */

/**
 * This is the server part. It typically lives in a node-like
 * environment (for, i.e., electron main thread).
 */

const pathToRegexp = require('path-to-regexp');

const { TOPIC } = require('./constants');

const routes = [];

const addRoute = routeInstance => {
  const clonedRoute = Object.assign({}, routeInstance);

  routes.push(clonedRoute);
};

// TODO: Needs to be configurable!
const DEBUG = true;
const log = DEBUG ? (...stuff) => console.log(...stuff) : () => {};

const resolveRoute = ({ path, method }) => {
  const matchingRoutes = routes.reduce((acc, route) => {
    if (!route) {
      return acc;
    }

    if (!route.path) {
      return acc;
    }

    const pathMatches = pathToRegexp(route.path).test(path);

    if (!pathMatches) {
      return acc;
    }

    const methodMatches =
      (method && typeof method === 'string' ? method : 'get').toLowerCase() ===
      (route.method && typeof route.method === 'string'
        ? route.method
        : 'get'
      ).toLowerCase();

    if (!methodMatches) {
      return acc;
    }

    acc.push(route);

    return acc;
  }, []);

  if (!matchingRoutes.length) {
    return null;
  }

  const { handler: matchingHandler, path: matchingPath } = matchingRoutes.sort(
    (a, b) => (a.length > b.length ? -1 : 1)
  )[0];

  if (!matchingHandler) {
    return { handler: null, keys: null };
  }

  const matchingKeys = [];
  const matchingRegExp = pathToRegexp(matchingPath, matchingKeys);
  const matchResult = matchingRegExp.exec(path);

  return {
    handler: matchingHandler,
    params: matchingKeys.reduce((acc, key, index) => {
      if (!key || !key.name) {
        return acc;
      }
      acc[key.name] = matchResult[index + 1];
      return acc;
    }, {})
  };
};

const tryParseJson = data => {
  if (typeof data !== 'string') {
    return data;
  }

  try {
    return JSON.parse(data);
  } catch (ignore) {
    void ignore;
    return data;
  }
};

const registerChannel = channel => {
  channel.on(TOPIC, async (evt, request) => {
    if (!request) {
      return;
    }

    if (!request.path) {
      return;
    }

    const resolvedRoute = resolveRoute({
      path: request.path,
      method: request.method || 'get'
    });

    if (!resolvedRoute) {
      return;
    }

    const { handler, params } = resolvedRoute;

    if (!handler) {
      return;
    }

    if (!request.correlationId) {
      return;
    }

    try {
      const response = tryParseJson(
        (await handler(
          Object.assign(request, { body: request.data || {} }, { params })
        )) || {}
      );

      if (response.status && response.status >= 300) {
        evt.sender.send(TOPIC, {
          correlationId: request.correlationId,
          status: response.status,
          error: { reason: response.reason, message: response.message }
        });

        return;
      }

      const result = {
        correlationId: request.correlationId,
        data: response
      };

      evt.sender.send(TOPIC, result);
    } catch (ex) {
      if (ex instanceof Error) {
        evt.sender.send(TOPIC, {
          correlationId: request.correlationId,
          status: 500,
          error: { reason: ex.message }
        });

        return;
      }

      evt.sender.send(TOPIC, {
        correlationId: request.correlationId,
        status: 500,
        error: ex
      });
    }
  });
};

const app = {
  get(path, handler, options = {}) {
    const clonedRoute = Object.assign({ path, handler }, options);
    clonedRoute.method = 'GET';

    addRoute(clonedRoute);
  },

  post(path, handler, options = {}) {
    const clonedRoute = Object.assign({ path, handler }, options);
    clonedRoute.method = 'POST';

    addRoute(clonedRoute);
  },

  put(path, handler, options = {}) {
    const clonedRoute = Object.assign({ path, handler }, options);
    clonedRoute.method = 'PUT';

    addRoute(clonedRoute);
  },

  patch(path, handler, options = {}) {
    const clonedRoute = Object.assign({ path, handler }, options);
    clonedRoute.method = 'PATCH';

    addRoute(clonedRoute);
  },

  delete(path, handler, options = {}) {
    const clonedRoute = Object.assign({ path, handler }, options);
    clonedRoute.method = 'DELETE';

    addRoute(clonedRoute);
  }
};

module.exports = {
  registerChannel,
  addRoute,
  app
};
