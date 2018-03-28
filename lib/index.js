'use strict';

const OpenTracing = require('opentracing');
const Package = require('../package.json');


exports.register = (server, options) => {
  const tracer = options.tracer || new OpenTracing.Tracer();

  server.decorate('server', 'tracer', tracer);
  server.ext('onRequest', onRequest);
  server.ext('onPreAuth', onPreAuth);
  server.ext('onPostAuth', onPostAuth);
  server.ext('onPreHandler', onPreHandler);
  server.ext('onPreResponse', onPreResponse);
  server.events.on('log', onLog(tracer));
  server.events.on('response', onResponse);
};

exports.pkg = Package;

function onRequest (request, h) {
  const span = request.server.tracer.startSpan('hapi_request');
  span.log({ event: 'onRequest', headers: request.headers, path: request.path, method: request.method, info: request.info }, Date.now());
  request.server.decorate('request', 'spans', { request: span });

  return h.continue;
}

function onPreAuth (request, h) {
  const span = request.server.tracer.startSpan('hapi_auth', { childOf: request.spans.request.context() });
  span.log({ event: 'onPreAuth' }, Date.now());
  request.spans.auth = span;

  return h.continue;
}

function onPostAuth (request, h) {
  request.spans.auth.finish(Date.now());
  return h.continue;
}

function onPreHandler (request, h) {
  const span = request.server.tracer.startSpan('hapi_handler', { childOf: request.spans.request.context() });
  span.log({ event: 'onPreHandler', route: request.route.options }, Date.now());
  request.spans.handler = span;

  return h.continue;
}

function onPreResponse (request, h) {
  const now = Date.now();

  request.spans.handler.finish(now);
  const span = request.server.tracer.startSpan('hapi_response', { childOf: request.spans.request.context() });
  request.spans.response = span;
  span.log({ event: 'onPreResponse' }, now);

  const response = request.response;
  if (response.isBoom) {
    span.log({ event: 'error', output: response.output, stack: response.stack }, now);
    return h.continue;
  }

  response.events.once('finish', () => {
    span.finish(now);
  });

  return h.continue;
}

function onResponse (request) {
  const now = Date.now();
  request.spans.response.finish(now);
  request.spans.request.finish(now);
}

function onLog (tracer) {
  return (event, tags) => {
    const span = tracer.startSpan('hapi_log');
    span.log({ event, tags }, Date.now());
    span.finish();
  };
}