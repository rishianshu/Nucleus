#!/usr/bin/env node
const { URL } = require('node:url');

function resolve() {
  if (process.env.METADATA_DATABASE_URL) {
    return process.env.METADATA_DATABASE_URL;
  }
  const base = process.env.DATABASE_URL;
  if (!base) {
    throw new Error('DATABASE_URL is not defined');
  }
  const url = new URL(base);
  url.searchParams.set('schema', 'metadata');
  return url.toString();
}

process.stdout.write(resolve());
